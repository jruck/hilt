import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { parseLoopArtifact } from "@/lib/loops/artifacts";
import { latestArtifactPath } from "@/lib/loops/registry";
import { readVerdicts } from "@/lib/loops/stores";
import type { LoopItem, RegistryLoop, Verdict } from "@/lib/loops/types";
import { errorMessage, loadLoopRegistryContext, loopBase, loopStoreHome, type LoopApiError } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LoopEscalationSummary {
  id: string;
  phase: RegistryLoop["phase"];
  artifact_date: string;
}

type EscalatedLoopItem = LoopItem & {
  loop_phase: RegistryLoop["phase"];
  artifact_date: string;
  verdict?: Verdict;
};

function isAsk(item: LoopItem): boolean {
  return item.kind === "action" || item.kind === "proposal";
}

export async function GET() {
  const errors: LoopApiError[] = [];

  try {
    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) {
      return NextResponse.json({
        loops: [] as LoopEscalationSummary[],
        items: [] as EscalatedLoopItem[],
        errors: error ? [{ message: error }] : [],
      });
    }

    const loops: LoopEscalationSummary[] = [];
    const items: EscalatedLoopItem[] = [];

    for (const loop of registry.loops) {
      if (!loop.enabled) continue;

      const base = loopBase(vaultPath, loop);
      const artifactPath = latestArtifactPath(base, loop);
      if (!artifactPath) {
        errors.push({
          loop: loop.id,
          phase: loop.phase,
          message: `No loop artifact found under ${path.join(base, "meta", "loops", loop.domain, "reports")}`,
        });
        continue;
      }

      const artifactDate = path.basename(artifactPath, ".md");
      let parsed: ReturnType<typeof parseLoopArtifact>;
      try {
        parsed = parseLoopArtifact(fs.readFileSync(artifactPath, "utf-8"));
      } catch (parseError) {
        errors.push({
          loop: loop.id,
          phase: loop.phase,
          message: `Failed to parse ${artifactDate}: ${errorMessage(parseError)}`,
        });
        continue;
      }

      loops.push({ id: loop.id, phase: loop.phase, artifact_date: artifactDate });

      const verdictByItem = new Map<string, Verdict>();
      try {
        for (const record of readVerdicts(loopStoreHome(vaultPath, loop))) {
          if (record.verdict === "restore") verdictByItem.delete(record.item_id);
          else verdictByItem.set(record.item_id, record.verdict);
        }
      } catch (verdictError) {
        errors.push({
          loop: loop.id,
          phase: loop.phase,
          message: `Failed to read verdicts: ${errorMessage(verdictError)}`,
        });
      }

      for (const item of parsed.frontmatter.items) {
        if (!item.escalated) continue;
        const verdict = isAsk(item) ? verdictByItem.get(item.id) : undefined;
        items.push({
          ...item,
          loop_phase: loop.phase,
          artifact_date: artifactDate,
          ...(verdict ? { verdict } : {}),
        });
      }
    }

    return NextResponse.json({ loops, items, errors });
  } catch (error) {
    console.error("[loops/escalations] failed:", error);
    return NextResponse.json({
      loops: [] as LoopEscalationSummary[],
      items: [] as EscalatedLoopItem[],
      errors: [{ message: errorMessage(error) }],
    });
  }
}

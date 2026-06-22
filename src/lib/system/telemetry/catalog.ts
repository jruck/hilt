import { COMPUTE_PALETTE, type MachineMeta } from "./types";

// Title-cased short label from a machine_id (tailscale_dns), matching peers.ts
// machineLabel(): first DNS segment, "-v" suffix trimmed. e.g.
// "mercury-v.tailc0acaa.ts.net" -> "Mercury", "hestia.tailc0acaa.ts.net" -> "Hestia".
export function labelFromMachineId(id: string): string {
  const seg = id.replace(/\.$/, "").split(".")[0].replace(/-v$/i, "");
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : id;
}

// Build the series catalog with deterministic, stable colors. `preferredFirst`
// (the collector/self machine) sorts to index 0 so it keeps its hue regardless of
// which other machines are present — preserving Mercury=violet, Hestia=magenta.
export function buildMachineCatalog(machineIds: string[], preferredFirst?: string | null): MachineMeta[] {
  const unique = [...new Set(machineIds)];
  unique.sort((a, b) => {
    if (preferredFirst) {
      if (a === preferredFirst) return -1;
      if (b === preferredFirst) return 1;
    }
    return a.localeCompare(b);
  });
  return unique.map((id, i) => ({ id, label: labelFromMachineId(id), color: COMPUTE_PALETTE[i % COMPUTE_PALETTE.length] }));
}

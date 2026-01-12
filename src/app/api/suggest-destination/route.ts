import { NextRequest, NextResponse } from "next/server";
import { getPinnedFolders } from "@/lib/db";
import * as fs from "fs/promises";
import * as path from "path";

// Common stopwords to filter out
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "been",
  "will", "would", "could", "should", "about", "into", "more", "some",
  "than", "then", "when", "what", "where", "which", "while", "also",
  "just", "like", "make", "want", "need", "todo", "add", "fix", "update",
  "create", "implement", "use", "new", "get", "set"
]);

interface Suggestion {
  path: string;
  name: string;
  emoji?: string;
  confidence: number;
  reason: string;
}

/**
 * Extract keywords from text for matching
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^a-z0-9]/g, ""))
    .filter(word => word.length > 3 && !STOPWORDS.has(word));
}

/**
 * Read first N characters of a file, returns empty string if file doesn't exist
 */
async function readFileHead(filePath: string, maxChars: number = 500): Promise<string> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.slice(0, maxChars).toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Compute match score between task text and a folder
 */
async function computeMatchScore(
  taskKeywords: string[],
  folderPath: string,
  folderName: string
): Promise<{ score: number; reason: string }> {
  if (taskKeywords.length === 0) {
    return { score: 0, reason: "" };
  }

  let score = 0;
  let reason = "";
  const folderNameLower = folderName.toLowerCase();

  // Check folder name match (highest weight)
  const folderNameWords = folderNameLower.split(/[-_\s]+/);
  for (const keyword of taskKeywords) {
    if (folderNameWords.some(word => word.includes(keyword) || keyword.includes(word))) {
      score += 0.5;
      reason = `Matches folder name "${folderName}"`;
      break;
    }
  }

  // Check CLAUDE.md content
  const claudeMdContent = await readFileHead(path.join(folderPath, "CLAUDE.md"));
  if (claudeMdContent) {
    const matches = taskKeywords.filter(kw => claudeMdContent.includes(kw));
    if (matches.length > 0) {
      const matchBonus = Math.min(0.3, matches.length * 0.1);
      score += matchBonus;
      if (!reason) {
        reason = `Matches CLAUDE.md content`;
      }
    }
  }

  // Check README.md content
  const readmePaths = [
    path.join(folderPath, "README.md"),
    path.join(folderPath, "readme.md"),
    path.join(folderPath, "docs", "README.md"),
  ];

  for (const readmePath of readmePaths) {
    const readmeContent = await readFileHead(readmePath);
    if (readmeContent) {
      const matches = taskKeywords.filter(kw => readmeContent.includes(kw));
      if (matches.length > 0) {
        const matchBonus = Math.min(0.2, matches.length * 0.05);
        score += matchBonus;
        if (!reason) {
          reason = `Matches README content`;
        }
      }
      break;
    }
  }

  return { score, reason };
}

/**
 * GET /api/suggest-destination?text=<task text>
 * Returns top 2-3 suggested folders based on content matching
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const text = searchParams.get("text");

    if (!text) {
      return NextResponse.json({ suggestions: [] });
    }

    const folders = await getPinnedFolders();
    if (folders.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    const taskKeywords = extractKeywords(text);
    if (taskKeywords.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Compute scores for all folders with a timeout
    const timeoutPromise = new Promise<Suggestion[]>((resolve) => {
      setTimeout(() => resolve([]), 500);
    });

    const scoringPromise = (async () => {
      const scored: Suggestion[] = [];

      for (const folder of folders) {
        const { score, reason } = await computeMatchScore(
          taskKeywords,
          folder.path,
          folder.name
        );

        if (score >= 0.3) {
          scored.push({
            path: folder.path,
            name: folder.name,
            emoji: folder.emoji,
            confidence: score,
            reason,
          });
        }
      }

      return scored;
    })();

    const suggestions = await Promise.race([scoringPromise, timeoutPromise]);

    // Sort by confidence and take top 3
    const topSuggestions = suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    return NextResponse.json({ suggestions: topSuggestions });
  } catch (error) {
    console.error("Error computing suggestions:", error);
    return NextResponse.json({ suggestions: [] });
  }
}

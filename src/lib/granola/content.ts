import type { GranolaDocument, GranolaTranscriptEntry } from "./types";

interface ProseMirrorNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
}

export function buildGranolaNoteBody(doc: GranolaDocument, options: { includePrivateNotes?: boolean } = {}): string | null {
  const enhanced = contentToMarkdown(doc.panelContent);
  const privateNotes = options.includePrivateNotes ? doc.privateNotesMarkdown?.trim() : "";
  if (!enhanced.trim() && !privateNotes) return null;

  const chunks: string[] = [];
  if (privateNotes) {
    chunks.push("## Private Notes\n\n" + privateNotes.trim());
    chunks.push("## Enhanced Notes\n\n" + enhanced.trim());
  } else {
    chunks.push(enhanced.trim());
  }
  return chunks.filter(Boolean).join("\n\n").trim() + "\n";
}

export function formatTranscriptMarkdown(entries: GranolaTranscriptEntry[], title: string): string {
  const body = formatTranscriptBody(entries);
  return `# Transcript for: ${title}\n\n${body}`.trimEnd() + "\n";
}

export function formatTranscriptBody(entries: GranolaTranscriptEntry[]): string {
  let currentSpeaker: string | null = null;
  let currentStart: string | null = null;
  let currentText: string[] = [];
  const blocks: string[] = [];

  const flush = () => {
    if (!currentSpeaker) return;
    blocks.push(`### ${currentSpeaker} (${currentStart || ""})\n\n${currentText.join(" ").trim()}`);
  };

  for (const entry of entries) {
    const speaker = entry.speaker || (entry.source === "microphone" ? "You" : "Guest");
    if (!currentSpeaker) {
      currentSpeaker = speaker;
      currentStart = entry.startTimestamp;
      currentText = [entry.text];
    } else if (speaker === currentSpeaker) {
      currentText.push(entry.text);
    } else {
      flush();
      currentSpeaker = speaker;
      currentStart = entry.startTimestamp;
      currentText = [entry.text];
    }
  }

  flush();
  return blocks.join("\n\n") + (blocks.length ? "\n\n" : "");
}

export function contentToMarkdown(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return htmlishToMarkdown(content);
  if (typeof content === "object" && !Array.isArray(content)) {
    const node = content as ProseMirrorNode;
    if (node.type === "doc" && Array.isArray(node.content)) {
      return node.content.map((child) => renderNode(child, 0, true)).join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    }
  }
  return "";
}

function renderNode(node: ProseMirrorNode, indentLevel: number, topLevel: boolean): string {
  if (!node || typeof node !== "object") return "";
  const children = Array.isArray(node.content) ? node.content : [];
  const textContent = node.text ?? children.map((child) => renderNode(child, indentLevel, false)).join("");

  switch (node.type) {
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      return `${"#".repeat(Math.max(1, Math.min(6, level)))} ${textContent.trim()}${topLevel ? "\n\n" : "\n"}`;
    }
    case "paragraph":
      return textContent + (topLevel ? "\n\n" : "");
    case "bulletList":
    case "orderedList":
      return renderList(node, indentLevel, node.type === "orderedList") + (topLevel ? "\n\n" : "");
    case "listItem":
      return children.map((child) => renderNode(child, indentLevel, false)).join("");
    case "hardBreak":
      return "\n";
    case "text":
      return node.text || "";
    default:
      return textContent;
  }
}

function renderList(node: ProseMirrorNode, indentLevel: number, ordered: boolean): string {
  const items = Array.isArray(node.content) ? node.content : [];
  const start = ordered && typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return items.map((item, index) => {
    const children = Array.isArray(item.content) ? item.content : [];
    const childContent = children.map((child) => {
      if (child.type === "bulletList" || child.type === "orderedList") return "\n" + renderNode(child, indentLevel + 1, false);
      return renderNode(child, indentLevel, false);
    });
    const first = childContent.find((value) => !value.startsWith("\n")) || "";
    const rest = childContent.filter((value) => value.startsWith("\n")).join("");
    const indent = "\t".repeat(Math.max(0, indentLevel));
    const marker = ordered ? `${start + index}.` : "-";
    return `${indent}${marker} ${first.trim()}${rest}`;
  }).filter(Boolean).join("\n");
}

function htmlishToMarkdown(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<h([1-6])[^>]*>/gi, (_match, level) => `${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

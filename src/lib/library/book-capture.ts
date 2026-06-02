import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { extractHeading, extractSection, markdownToPlain, relativeVaultPath, stringifyMarkdown } from "./markdown";
import { atomicWriteFile, dateOnly, ensureDir, isoNow, slugify, walkMarkdown } from "./utils";

export interface BookCaptureImportOptions {
  vaultPath: string;
  inputPath: string;
  rawTextJsonPath?: string;
  title?: string;
  author?: string;
  url?: string;
  thumbnail?: string;
  category?: string;
  now?: string;
  force?: boolean;
}

export interface BookCaptureImportPlan {
  title: string;
  slug: string;
  author: string | null;
  url: string;
  capturedAt: string;
  referencePath: string;
  outputDir: string;
  topicsDir: string;
  cacheDir: string;
  cachePath: string;
  sourceFiles: string[];
  topicFiles: Array<{ sourcePath: string; outputPath: string }>;
  markdown: string;
  cacheMarkdown: string;
  wouldOverwrite: boolean;
}

const BOOK_CAPTURE_SOURCE_ID = "book-capture";
const BOOK_CAPTURE_SOURCE_NAME = "Books";
const RAW_CONTENT_INLINE_LIMIT = 50_000;

function frontmatterString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function listMarkdownInputs(inputPath: string): string[] {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return resolved.endsWith(".md") ? [resolved] : [];
  return walkMarkdown(resolved, { includeHidden: false });
}

function choosePrimaryFile(files: string[]): string {
  const hubLike = files.find((file) => {
    const basename = path.basename(file).toLowerCase();
    return !/^\d+[-_]/.test(basename) && basename !== "readme.md" && basename.endsWith(".md");
  });
  return hubLike || files[0];
}

function stripTopHeading(body: string): string {
  return body.replace(/^#\s+.+(?:\r?\n)+/, "").trim();
}

function firstParagraph(body: string, limit = 280): string {
  const cleaned = stripTopHeading(body)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("[[") && !line.startsWith("- [["));
  return markdownToPlain(cleaned.join(" ")).slice(0, limit);
}

function truncateDescription(value: string, limit = 300): string {
  const plain = markdownToPlain(value);
  if (plain.length <= limit) return plain;

  const clipped = plain.slice(0, limit).trimEnd();
  const sentenceBoundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (sentenceBoundary >= 120) return clipped.slice(0, sentenceBoundary + 1);

  const wordBoundary = clipped.replace(/\s+\S*$/, "").trimEnd();
  return `${wordBoundary || clipped}...`;
}

function splitLeadAndSections(body: string): { lead: string; sections: string } {
  const stripped = stripTopHeading(body);
  const match = stripped.match(/\n##\s+/);
  if (!match || match.index === undefined) return { lead: stripped.trim(), sections: "" };
  return {
    lead: stripped.slice(0, match.index).trim(),
    sections: stripped.slice(match.index + 1).trim(),
  };
}

function hasStructuredDigest(body: string): boolean {
  const stripped = stripTopHeading(body);
  return /^##\s+(Summary|Why It Matters|Key Points|Connections|Case Studies|Operating Principles|Caveats)\b/im.test(stripped);
}

function mediaBlock(title: string, thumbnail?: string): string {
  if (!thumbnail) return "";
  const alt = title.replace(/]/g, "\\]");
  return `## Media

![${alt} cover](${thumbnail})
`;
}

function buildReferenceBody(options: {
  title: string;
  thumbnail?: string;
  primaryBody: string;
  summaryText: string;
  capturedNotes: string;
  topics: string;
  hasTopics: boolean;
  cacheRelPath: string;
  fullCapture: string;
}): string {
  const media = mediaBlock(options.title, options.thumbnail);
  const rawContent = `## Raw Content

${rawContentBlock(options.cacheRelPath, options.fullCapture)}
`;

  if (hasStructuredDigest(options.primaryBody)) {
    const summarySection = extractSection(options.primaryBody, "Summary");
    if (summarySection) {
      const bodySections = stripTopHeading(options.primaryBody);
      const topics = options.hasTopics && !extractSection(options.primaryBody, "Topics")
        ? `\n\n## Topics\n\n${options.topics}`
        : "";
      return `# ${options.title}

${media ? `${media}\n` : ""}${bodySections}${topics}

${rawContent}`;
    }

    const { lead, sections } = splitLeadAndSections(options.primaryBody);
    const topics = options.hasTopics && !extractSection(options.primaryBody, "Topics")
      ? `\n\n## Topics\n\n${options.topics}`
      : "";
    return `# ${options.title}

${media ? `${media}\n` : ""}## Summary

${lead || options.summaryText}

${sections}${topics}

${rawContent}`;
  }

  const topics = options.hasTopics
    ? `## Topics

${options.topics}

`
    : "";

  return `# ${options.title}

${media ? `${media}\n` : ""}## Summary

${options.summaryText}

## Captured Notes

${options.capturedNotes || "No generated hub notes were present in the capture."}

${topics}## Raw Content

${rawContentBlock(options.cacheRelPath, options.fullCapture)}
`;
}

function titleFromInput(inputPath: string): string {
  return path.basename(inputPath, path.extname(inputPath)).replace(/[-_]+/g, " ").trim() || "Untitled Book";
}

function urlForBook(slug: string, explicitUrl?: string): string {
  return explicitUrl?.trim() || `book-capture://${slug}`;
}

function relativeFromInputRoot(inputPath: string, filePath: string): string {
  const root = fs.statSync(inputPath).isDirectory() ? path.resolve(inputPath) : path.dirname(path.resolve(filePath));
  const rel = path.relative(root, filePath).split(path.sep).join("/");
  return rel && !rel.startsWith("..") ? rel : path.basename(filePath);
}

function topicOutputPath(topicsDir: string, inputPath: string, filePath: string): string {
  const rel = relativeFromInputRoot(inputPath, filePath);
  return path.join(topicsDir, rel);
}

function rawTextJsonToMarkdown(filePath: string): string {
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
    pages?: Array<{ page: number; text: string; confidence?: number; method?: string }>;
    stats?: Record<string, unknown>;
  };
  const pages = (data.pages || []).slice().sort((a, b) => a.page - b.page);
  const stats = data.stats ? `\n\n## OCR Stats\n\n\`\`\`json\n${JSON.stringify(data.stats, null, 2)}\n\`\`\`\n` : "";
  const body = pages.map((page) => `## Page ${page.page}\n\n${String(page.text || "").trim()}`).join("\n\n");
  return `# OCR Capture\n${stats}\n\n${body}`.trim() + "\n";
}

function buildFullCapture(files: string[], rawTextJsonPath?: string): string {
  const markdownFiles = files.map((file) => {
    const parsed = matter(fs.readFileSync(file, "utf-8"));
    const title = extractHeading(parsed.content, path.basename(file, ".md"));
    return `# ${title}\n\n${stripTopHeading(parsed.content) || parsed.content.trim()}`;
  });
  const captures = rawTextJsonPath ? [...markdownFiles, rawTextJsonToMarkdown(rawTextJsonPath)] : markdownFiles;
  return captures.join("\n\n---\n\n").trim() + "\n";
}

function topicLinks(topicFiles: BookCaptureImportPlan["topicFiles"], primaryFile: string, outputDir: string): string {
  const links = topicFiles
    .filter((item) => path.resolve(item.sourcePath) !== path.resolve(primaryFile))
    .map((item) => {
      const rel = path.relative(outputDir, item.outputPath)
        .split(path.sep)
        .join("/");
      const label = path.basename(item.outputPath, ".md").replace(/^\d+[-_]/, "").replace(/[-_]+/g, " ");
      return `- [${label}](${rel})`;
    });
  return links.length ? links.join("\n") : "- No separate topic files were present in this capture.";
}

function rawContentBlock(cacheRelPath: string, fullCapture: string): string {
  if (fullCapture.length <= RAW_CONTENT_INLINE_LIMIT) {
    return `<details>
<summary>Captured book markdown</summary>

${fullCapture.trim()}

</details>`;
  }

  const excerpt = fullCapture.slice(0, 8_000).trim();
  return `<details>
<summary>Captured book markdown excerpt</summary>

Full capture cache: \`${cacheRelPath}\`

${excerpt}

</details>`;
}

export function buildBookCaptureImportPlan(options: BookCaptureImportOptions): BookCaptureImportPlan {
  const inputPath = path.resolve(options.inputPath);
  const files = listMarkdownInputs(inputPath);
  if (!files.length) throw new Error(`No markdown files found in book capture input: ${inputPath}`);

  const primaryFile = choosePrimaryFile(files);
  const primary = matter(fs.readFileSync(primaryFile, "utf-8"));
  const primaryBody = primary.content.trim();
  const inferredTitle = options.title
    || frontmatterString(primary.data as Record<string, unknown>, ["title", "Title"])
    || extractHeading(primaryBody, titleFromInput(primaryFile));
  const title = inferredTitle.trim();
  const slug = slugify(title);
  const author = options.author
    || frontmatterString(primary.data as Record<string, unknown>, ["author", "Author"])
    || null;
  const explicitUrl = options.url
    || frontmatterString(primary.data as Record<string, unknown>, ["url", "URL", "source", "Source"]);
  const url = urlForBook(slug, explicitUrl || undefined);
  const thumbnail = options.thumbnail
    || frontmatterString(primary.data as Record<string, unknown>, ["thumbnail", "cover", "image"]);
  const capturedAt = options.now || isoNow();
  const captured = dateOnly(capturedAt);
  const outputDir = path.join(options.vaultPath, "references", "books", slug);
  const topicsDir = path.join(outputDir, "topics");
  const referencePath = path.join(outputDir, "index.md");
  const cacheDir = path.join(options.vaultPath, "references", ".cache", "book-captures", slug);
  const cachePath = path.join(cacheDir, "capture.md");
  const topicFiles = files
    .filter((file) => path.resolve(file) !== path.resolve(primaryFile))
    .map((file) => ({
      sourcePath: file,
      outputPath: topicOutputPath(topicsDir, inputPath, file),
    }));
  const fullCapture = buildFullCapture(files, options.rawTextJsonPath);
  const cacheRelPath = relativeVaultPath(options.vaultPath, cachePath);
  const { lead } = splitLeadAndSections(primaryBody);
  const summaryText = extractSection(primaryBody, "Summary")
    || frontmatterString(primary.data as Record<string, unknown>, ["description", "summary", "Summary"])
    || lead
    || firstParagraph(primaryBody, 1_200)
    || `Book capture for ${title}.`;
  const description = truncateDescription(summaryText);
  const capturedNotes = stripTopHeading(primaryBody);
  const topicsSection = extractSection(primaryBody, "Topics");
  const topics = topicsSection || topicLinks(topicFiles, primaryFile, outputDir);
  const hasTopics = Boolean(topicsSection || topicFiles.length);
  const category = options.category || frontmatterString(primary.data as Record<string, unknown>, ["category", "Category"]);
  const tags = Array.from(new Set(["book", "reading", ...(category ? [slugify(category)] : [])]));

  const frontmatter: Record<string, unknown> = {
    type: "reference",
    title,
    description,
    url,
    format: "book",
    author: author || undefined,
    captured,
    captured_at: capturedAt,
    channel: "manual",
    source_id: BOOK_CAPTURE_SOURCE_ID,
    source_name: BOOK_CAPTURE_SOURCE_NAME,
    digestion_status: "hot",
    digested_with: "book-capture",
    digested_at: capturedAt,
    cached_source_chars: fullCapture.length,
    cached_source_extractor: "book-capture",
    book_capture_cache: cacheRelPath,
    book_capture_source_path: inputPath,
    thumbnail: thumbnail || undefined,
    tags,
  };

  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }

  const body = buildReferenceBody({
    title,
    thumbnail: thumbnail || undefined,
    primaryBody,
    summaryText,
    capturedNotes,
    topics,
    hasTopics,
    cacheRelPath,
    fullCapture,
  });

  return {
    title,
    slug,
    author,
    url,
    capturedAt,
    referencePath,
    outputDir,
    topicsDir,
    cacheDir,
    cachePath,
    sourceFiles: files,
    topicFiles,
    markdown: stringifyMarkdown(frontmatter, body),
    cacheMarkdown: fullCapture,
    wouldOverwrite: fs.existsSync(referencePath),
  };
}

export function writeBookCaptureImport(plan: BookCaptureImportPlan, options: { force?: boolean } = {}): BookCaptureImportPlan {
  if (plan.wouldOverwrite && !options.force) {
    throw new Error(`Book reference already exists: ${plan.referencePath}. Re-run with --force to overwrite.`);
  }

  ensureDir(plan.outputDir);
  ensureDir(plan.topicsDir);
  ensureDir(plan.cacheDir);
  atomicWriteFile(plan.referencePath, plan.markdown);
  atomicWriteFile(plan.cachePath, plan.cacheMarkdown);

  for (const item of plan.topicFiles) {
    ensureDir(path.dirname(item.outputPath));
    fs.copyFileSync(item.sourcePath, item.outputPath);
  }

  return { ...plan, wouldOverwrite: false };
}

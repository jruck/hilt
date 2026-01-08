import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { DocsFileResponse, DocsSaveResponse } from "@/lib/types";

// Extensions that are viewable in the editor
const VIEWABLE_EXTENSIONS = new Set([
  // Markdown
  "md",
  "markdown",
  "mdx",
  // Plain text
  "txt",
  "text",
  // Config files
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "conf",
  "config",
  // Code files
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "swift",
  "kt",
  "scala",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  // Web
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "svg",
  "xml",
  // Data
  "csv",
  "tsv",
  "sql",
  "graphql",
  "gql",
  // Docs
  "rst",
  "tex",
  "adoc",
  "asciidoc",
  // No extension often means text
  "",
]);

// MIME types by extension
const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/mdx",
  txt: "text/plain",
  json: "application/json",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "text/toml",
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  jsx: "text/javascript",
  py: "text/x-python",
  html: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

// Max file size for text content (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

// Check if file is binary by looking for null bytes
function isBinaryFile(buffer: Buffer): boolean {
  // Check first 8KB for null bytes
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

// Validate path is within scope (prevent directory traversal)
function isPathWithinScope(filePath: string, scope: string): boolean {
  const normalizedPath = path.resolve(filePath);
  const normalizedScope = path.resolve(scope);
  return normalizedPath.startsWith(normalizedScope + path.sep) || normalizedPath === normalizedScope;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");
  const scope = searchParams.get("scope");

  if (!filePath) {
    return NextResponse.json(
      { error: "path parameter is required" },
      { status: 400 }
    );
  }

  if (!scope) {
    return NextResponse.json(
      { error: "scope parameter is required" },
      { status: 400 }
    );
  }

  // Security: validate path is within scope
  if (!isPathWithinScope(filePath, scope)) {
    return NextResponse.json(
      { error: "path must be within scope" },
      { status: 403 }
    );
  }

  try {
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      return NextResponse.json(
        { error: "path must be a file, not a directory" },
        { status: 400 }
      );
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const isViewable = VIEWABLE_EXTENSIONS.has(ext);
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    // For very large files, don't attempt to read content
    if (stats.size > MAX_FILE_SIZE) {
      const response: DocsFileResponse = {
        path: filePath,
        content: null,
        isBinary: true, // Treat large files as binary
        isViewable: false,
        mimeType,
        size: stats.size,
        modTime: stats.mtimeMs,
      };
      return NextResponse.json(response);
    }

    // Read file content
    const buffer = fs.readFileSync(filePath);
    const isBinary = isBinaryFile(buffer);

    const response: DocsFileResponse = {
      path: filePath,
      content: isBinary ? null : buffer.toString("utf-8"),
      isBinary,
      isViewable: isViewable && !isBinary,
      mimeType,
      size: stats.size,
      modTime: stats.mtimeMs,
    };

    return NextResponse.json(response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: filePath, content, scope } = body;

    if (!filePath || content === undefined || !scope) {
      return NextResponse.json(
        { error: "path, content, and scope are required" },
        { status: 400 }
      );
    }

    // Security: validate path is within scope
    if (!isPathWithinScope(filePath, scope)) {
      return NextResponse.json(
        { error: "path must be within scope" },
        { status: 403 }
      );
    }

    // Only allow saving viewable file types
    const ext = path.extname(filePath).slice(1).toLowerCase();
    if (!VIEWABLE_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: "Cannot save binary file types" },
        { status: 400 }
      );
    }

    // Write the file
    fs.writeFileSync(filePath, content, "utf-8");

    // Get new mod time
    const stats = fs.statSync(filePath);

    const response: DocsSaveResponse = {
      success: true,
      modTime: stats.mtimeMs,
    };

    return NextResponse.json(response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied", success: false, modTime: 0 },
        { status: 403 }
      );
    }
    console.error("Error saving file:", error);
    return NextResponse.json(
      { error: "Failed to save file", success: false, modTime: 0 },
      { status: 500 }
    );
  }
}

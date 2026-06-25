import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * PDF text extraction for the reference library. A PDF (Raindrop file upload, or a bookmarked `.pdf`
 * URL anywhere) is binary — reading its bytes as text dumps unreadable garbage AND corrupts ~40% of
 * the bytes via UTF-8 decode (the Loop-Engineering-IEEE.pdf failure, 2026-06-25). Detect PDFs and run
 * `pdftotext` (poppler) on the BYTES instead, so the normal summarize + reweave pipeline gets clean
 * prose. PURE except for `extractPdfText`, which shells out (mirrors the `summarize` CLI dependency).
 */

let warnedMissingPdftotext = false;

/** PDF by content-type or the `%PDF-` magic bytes. */
export function looksLikePdf(contentType?: string | null, bytes?: Buffer | null): boolean {
  if (contentType && /application\/pdf/i.test(contentType)) return true;
  if (bytes && bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return true;
  return false;
}

/** A URL whose target is a PDF by extension (query-string tolerant). */
export function isPdfUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(?:[?#]|$)/i.test(url);
  }
}

/**
 * Extract readable text from PDF bytes via `pdftotext` (poppler; override with `PDFTOTEXT_BIN`). Returns
 * null when the binary is missing, extraction fails, or the result is too short to be real content —
 * callers treat null as "no usable cache" so the item routes to recovery rather than landing as garbage.
 */
export async function extractPdfText(bytes: Buffer, maxCharacters = 200_000): Promise<string | null> {
  if (!bytes || bytes.length < 5) return null;
  const bin = process.env.PDFTOTEXT_BIN || "pdftotext";
  const tmp = path.join(os.tmpdir(), `hilt-pdf-${process.pid}-${Date.now()}-${bytes.length}.pdf`);
  try {
    await fs.promises.writeFile(tmp, bytes);
    const { stdout } = await execFileAsync(bin, ["-q", "-nopgbrk", "-enc", "UTF-8", tmp, "-"], {
      maxBuffer: 1024 * 1024 * 64,
      timeout: 60_000,
    });
    const text = stdout.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxCharacters);
    return text.length >= 80 ? text : null;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT" && !warnedMissingPdftotext) {
      warnedMissingPdftotext = true;
      console.warn("[library] pdftotext not found — PDFs cannot be extracted. `brew install poppler` or set PDFTOTEXT_BIN.");
    }
    return null;
  } finally {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}

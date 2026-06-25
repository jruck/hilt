import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfText, isPdfUrl, looksLikePdf } from "./pdf";
import { looksLikeBinaryGarbage } from "./capture-health";

// A minimal valid single-page PDF whose only text is "Hilt PDF extraction smoke test".
const MINI_PDF_B64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxNTQgPj4Kc3RyZWFtCkJUIC9GMSAxNCBUZiA3MiA3MDAgVGQgKEhpbHQgUERGIGV4dHJhY3Rpb24gc21va2UgdGVzdCAtIHRoaXMgc2VudGVuY2UgaXMgZGVsaWJlcmF0ZWx5IGxvbmcgZW5vdWdoIHRvIGNsZWFyIHRoZSBlaWdodHkgY2hhcmFjdGVyIG1pbmltdW0gdGhyZXNob2xkLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA0NDYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MTYKJSVFT0Y=";
const MINI_PDF = Buffer.from(MINI_PDF_B64, "base64");

test("looksLikePdf detects content-type and the %PDF magic", () => {
  assert.equal(looksLikePdf("application/pdf"), true);
  assert.equal(looksLikePdf("application/pdf; charset=binary"), true);
  assert.equal(looksLikePdf(null, MINI_PDF), true);
  assert.equal(looksLikePdf("text/html"), false);
  assert.equal(looksLikePdf(null, Buffer.from("<!doctype html>")), false);
});

test("isPdfUrl matches .pdf paths but not html or query-only hints", () => {
  assert.equal(isPdfUrl("https://example.com/papers/loop.pdf"), true);
  assert.equal(isPdfUrl("https://example.com/loop.pdf?dl=1"), true);
  assert.equal(isPdfUrl("https://example.com/article"), false);
  // The Raindrop file endpoint is NOT a .pdf path (it 404s to an HTML viewer) — must be handled via cache.
  assert.equal(isPdfUrl("https://api.raindrop.io/v2/raindrop/1/file?type=application/pdf"), false);
});

test("extractPdfText pulls real prose out of PDF bytes", async () => {
  const text = await extractPdfText(MINI_PDF);
  assert.ok(text, "expected extracted text");
  assert.match(text!, /Hilt PDF extraction smoke test/);
  assert.equal(looksLikeBinaryGarbage(text!), false);
});

test("looksLikeBinaryGarbage flags binary bytes read as text, not real prose", () => {
  // Real PDFs carry FlateDecode (compressed) binary streams; decoded as UTF-8 (the bug) they're dense
  // with U+FFFD + control bytes. Simulate with a spread of raw byte values.
  const binary = Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + 13) % 256)).toString("utf-8");
  assert.equal(looksLikeBinaryGarbage(binary), true);
  assert.equal(
    looksLikeBinaryGarbage("This is an ordinary paragraph of readable prose that should never be flagged as binary, with plenty of words to clear the sample size."),
    false,
  );
});

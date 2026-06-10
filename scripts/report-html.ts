import fs from "fs";
import os from "os";
import path from "path";
import MarkdownIt from "markdown-it";

/**
 * Render a markdown report into a standalone, phone-friendly HTML page for tailnet hosting
 * (tailscale serve). Default: the Library v2 implementation report → ~/.hilt/reports/library-v2/.
 *
 *   npx tsx scripts/report-html.ts [--md <file>] [--out <file>] [--title <title>]
 */

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const mdPath = argValue("--md", path.resolve("docs/plans/library-v2-implementation-report.md"));
const outPath = argValue("--out", path.join(os.homedir(), ".hilt", "reports", "library-v2", "index.html"));
const title = argValue("--title", "Library v2 — Implementation Report");

const markdown = fs.readFileSync(mdPath, "utf-8");
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const body = md.render(markdown);
const generatedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
    --accent: #2563eb; --surface: #f8fafc; --ok: #047857; --warn: #b45309;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1115; --fg: #e5e7eb; --muted: #9ca3af; --border: #272b33; --accent: #60a5fa; --surface: #161a21; --ok: #34d399; --warn: #fbbf24; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 20px 80px; }
  .stamp { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  h1 { font-size: 1.7em; line-height: 1.25; margin: 0 0 8px; }
  h2 { font-size: 1.25em; margin-top: 2em; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 1.05em; margin-top: 1.6em; }
  a { color: var(--accent); }
  code { background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 0.86em; word-break: break-word; }
  pre { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; }
  pre code { border: 0; background: none; padding: 0; }
  blockquote { margin: 0; padding: 2px 16px; border-left: 3px solid var(--border); color: var(--muted); }
  .tablewrap { overflow-x: auto; margin: 1em 0; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; font-size: 14px; min-width: 100%; }
  th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: var(--surface); }
  tr:nth-child(even) td { background: color-mix(in srgb, var(--surface) 55%, transparent); }
  li { margin: 4px 0; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
  strong { font-weight: 650; }
</style>
</head>
<body>
<main>
<p class="stamp">Rendered ${generatedAt} · served via Tailscale (tailnet only)</p>
${body.replace(/<table>/g, '<div class="tablewrap"><table>').replace(/<\/table>/g, "</table></div>")}
</main>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, "utf-8");
console.log(JSON.stringify({ out: outPath, bytes: html.length, source: mdPath }));

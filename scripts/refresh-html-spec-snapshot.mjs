#!/usr/bin/env node
// Refresh the local HTML Living Standard snapshot under
// docs/Reference/html-spec/. Reproducible, so the vendored corpus is never a
// mystery blob: re-run this to re-fetch the authoring-subset pages from the
// WHATWG Developer Edition and re-apply the exact same cleaning.
//
//   node scripts/refresh-html-spec-snapshot.mjs
//
// What it does:
//   - fetches the authoring-relevant dev-edition pages (document semantics +
//     the authoring elements + syntax) — NOT the JS/networking API chapters,
//     which are irrelevant to authoring HTML documents/artifacts.
//   - strips ONLY site chrome (<head>, page <script>s, the <header id=head>
//     banner, the <ol class=toc> sidebar). Spec prose, element definitions,
//     and ALL examples are preserved unchanged.
//   - stamps each file with provenance (source URL, spec "Last Updated" date,
//     retrieval date, license).
//
// License of the fetched content: text CC BY 4.0; code/IDL snippets BSD
// 3-Clause (WHATWG IPR policy). (c) WHATWG. See ../docs/Reference/html-living-standard.md.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "Reference", "html-spec");
const BASE = "https://html.spec.whatwg.org/dev";

// dev-edition page -> spec section. Authoring subset only.
const SECTIONS = {
  "dom": "§3 Semantics, structure, and APIs of HTML documents",
  "sections": "§4.3 Sections",
  "grouping-content": "§4.4 Grouping content",
  "text-level-semantics": "§4.5 Text-level semantics",
  "embedded-content": "§4.8 Embedded content",
  "tables": "§4.9 Tabular data",
  "syntax": "§13 The HTML syntax",
};

// Remove a balanced element (e.g. nested <ol>/<div>) starting at the first
// occurrence of `startMarker`. `tag` is the element name to balance.
function stripBalanced(html, startMarker, tag) {
  const start = html.indexOf(startMarker);
  if (start === -1) return null;
  let depth = 0, end = start;
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "gi");
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].toLowerCase().startsWith(`</${tag}`)) { depth--; if (depth === 0) { end = re.lastIndex; break; } }
    else depth++;
  }
  if (end === start) return null; // unbalanced — leave it
  return html.slice(0, start) + html.slice(end);
}

// Remove <script>…</script> blocks with plain string scanning (no regex).
// Regex-based tag filtering is fragile and is exactly what CodeQL's
// bad-tag-filter / incomplete-sanitization rules warn about; index scanning
// removes each well-formed block and leaves anything without a close tag
// (e.g. a "<script>" appearing inside a title="…" attribute) untouched.
function stripScripts(html) {
  const lo = html.toLowerCase();
  let out = "", i = 0;
  for (;;) {
    const s = lo.indexOf("<script", i);
    if (s === -1) { out += html.slice(i); break; }
    const after = lo[s + 7]; // char following "<script"
    const isTag = after === undefined || " \t\r\n>/".includes(after);
    if (!isTag) { out += html.slice(i, s + 7); i = s + 7; continue; } // e.g. "<scripted"
    const close = lo.indexOf("</script", s);
    const gt = close === -1 ? -1 : lo.indexOf(">", close);
    if (gt === -1) { out += html.slice(i); break; } // no closing tag — keep as-is
    out += html.slice(i, s);
    i = gt + 1;
  }
  return out;
}

function clean(raw) {
  let body = raw.slice(raw.indexOf("<body>") + "<body>".length);
  body = stripScripts(body);
  body = body.replace(/<header id=head\b[^>]*>[\s\S]*?<\/header>/i, "");
  // TOC sidebar (one per page).
  const noToc = stripBalanced(body, "<ol class=toc>", "ol");
  if (noToc) body = noToc;
  // MDN browser-support annotation widgets the dev edition injects
  // (<div class="mdn-anno ...">…</div>). Chrome, not WHATWG normative text.
  for (let next; (next = stripBalanced(body, '<div class="mdn-anno', "div")); ) body = next;
  return body.trim();
}

const today = new Date().toISOString().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const [name, section] of Object.entries(SECTIONS)) {
  const url = `${BASE}/${name}.html`;
  // Defence-in-depth: only ever fetch the hardcoded trusted upstream host.
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "html.spec.whatwg.org") {
    throw new Error(`refusing to fetch untrusted URL: ${url}`);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const raw = await res.text();
  const pub = (raw.match(/<span class=pubdate>([^<]+)<\/span>/) || [, "unknown"])[1];
  const body = clean(raw);
  const out = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>HTML Standard (${section}) — DPF local snapshot</title></head>
<body>
<!--
  DPF local reference snapshot of the WHATWG HTML Standard (Developer Edition).
  Section: ${section}
  Source : ${url}
  Spec "Last Updated": ${pub}  |  Retrieved: ${today}
  License: text CC BY 4.0; code/IDL snippets BSD 3-Clause. (c) WHATWG.
  Cleaned: stripped <head>, page <script>s, the site <header id=head> banner,
           and the <ol class=toc> sidebar. Spec prose, element definitions,
           and ALL examples (including <nav>/<header>/<section> demos) are
           preserved unchanged. Point-in-time snapshot for offline/local-LLM
           use; the source URL is always authoritative.
  Regenerate: node scripts/refresh-html-spec-snapshot.mjs
-->
${body}
</body>
</html>
`;
  writeFileSync(join(OUT_DIR, `${name}.html`), out);
  const bytes = Buffer.byteLength(out);
  total += bytes;
  console.log(`${String(bytes).padStart(8)}  ${name}.html  (${section}, spec ${pub})`);
}
console.log(`${String(total).padStart(8)}  TOTAL (${(total / 1024 / 1024).toFixed(2)} MB) -> ${OUT_DIR}`);

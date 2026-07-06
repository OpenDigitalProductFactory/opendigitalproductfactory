#!/usr/bin/env node
/**
 * BI-FE7C543C — Static guard: no in-app dialog helper inside a React transition.
 *
 * `confirmDialog` / `alertDialog` / `promptDialog` (from `@/components/ui/Dialog`)
 * dispatch a `DialogHost` state update (`setQueue`) to render the dialog. When
 * that update is deferred inside a React transition — i.e. called from within a
 * `startTransition(...)` callback (bare, `React.startTransition`, or the fn from
 * `useTransition()`) — it never renders INTERACTIVELY. The dialog silently never
 * appears and the triggering button wedges forever in its `isPending`/disabled
 * state, with no error and no way to complete the action.
 *
 * This bit EP-LABOR-ECONOMICS Phase 4 LIVE: the "Create draft invoice" button on
 * the customer Billable Time section raised `confirmDialog` inside
 * `startTransition` and never showed the dialog (fixed in PR #2649,
 * apps/web/components/customer/BillableTimeSection.tsx).
 *
 * The correct pattern is to `await` the dialog FIRST, OUTSIDE the transition,
 * then run the work inside `startTransition` — see the canonical shape in
 * apps/web/components/storefront-admin/ItemsManager.tsx `handleDelete`:
 *
 *     async function handleGenerate() {
 *       const ok = await confirmDialog({ title, message });   // outside
 *       if (!ok) return;
 *       startTransition(async () => {                         // work inside
 *         const r = await doThing();
 *         ...
 *       });
 *     }
 *
 * This guard catches a reintroduced call in SECONDS, before it ships and silently
 * wedges a button on a live surface.
 *
 * Detection is brace/paren-aware: it strips comments and string/template contents
 * (so a `{`, `)`, or the word "confirmDialog" inside a string or a doc comment
 * can't skew the scan), finds each `startTransition(...)` call, matches its
 * closing paren, and flags any `confirmDialog`/`alertDialog`/`promptDialog(` call
 * that lands inside that span.
 *
 * The transition function is matched by name: the global `startTransition`
 * (React import / `React.startTransition`) PLUS whatever each file names the fn it
 * destructures from `useTransition()` (e.g. `const [saving, startSave] = ...` →
 * `startSave(...)` is also scanned), so a renamed transition fn is not a blind
 * spot.
 *
 * Known limitation (documented, not a bug): only the INLINE callback is followed.
 * `startTransition(handler)` where `handler` is a separately-defined function that
 * calls a dialog helper is not caught — the fix pattern above keeps the dialog at
 * the call site, so the inline form is where the mistake actually happens.
 *
 * Run: node scripts/check-no-dialog-in-transition.mjs
 * Exit 0 = clean; exit 1 = violations (with a clear, actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
  join(ROOT, "apps", "web", "hooks"),
];

// Files allowed to match (none expected today; kept for parity with the sibling
// Native Dialog Guard so an intentional exception is explicit, not silent).
const ALLOW = new Set([]);

// Captures the transition fn name from `const [pending, <name>] = useTransition(`.
const TRANSITION_DECL = /\[\s*[^,\]]*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useTransition\s*\(/g;
const DIALOG_RE = /\b(confirmDialog|alertDialog|promptDialog)\s*\(/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Return a same-length copy of `src` with the CONTENTS of line/block comments and
 * string/template literals blanked to spaces (newlines preserved so line numbers
 * stay accurate). Code inside a `${...}` template interpolation is KEPT — it is
 * real code and its braces must stay balanced for paren matching. Delimiter chars
 * (quotes, backticks) are kept as-is; only the enclosed text is blanked.
 */
function sanitize(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (idx) => {
    if (out[idx] !== "\n" && out[idx] !== "\r") out[idx] = " ";
  };
  // Mode stack. `code` frames carry a braceDepth ONLY when they were opened by a
  // `${` interpolation, so the matching `}` returns us to template mode.
  const stack = [{ type: "code" }];
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const c2 = src[i + 1];
    if (top.type === "code") {
      if (c === "/" && c2 === "/") {
        while (i < n && src[i] !== "\n") { blank(i); i++; }
        continue;
      }
      if (c === "/" && c2 === "*") {
        blank(i); blank(i + 1); i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { blank(i); i++; }
        if (i < n) { blank(i); blank(i + 1); i += 2; }
        continue;
      }
      if (c === "'") { stack.push({ type: "sq" }); i++; continue; }
      if (c === '"') { stack.push({ type: "dq" }); i++; continue; }
      if (c === "`") { stack.push({ type: "tpl" }); i++; continue; }
      if (c === "{") { if (top.braceDepth !== undefined) top.braceDepth++; i++; continue; }
      if (c === "}") {
        if (top.braceDepth !== undefined) {
          if (top.braceDepth === 0) { stack.pop(); i++; continue; } // closes a ${...}
          top.braceDepth--;
        }
        i++; continue;
      }
      i++; continue;
    }
    if (top.type === "sq" || top.type === "dq") {
      const q = top.type === "sq" ? "'" : '"';
      if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
      if (c === q) { stack.pop(); i++; continue; }
      blank(i); i++; continue;
    }
    // template literal
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if (c === "`") { stack.pop(); i++; continue; }
    if (c === "$" && c2 === "{") { i += 2; stack.push({ type: "code", braceDepth: 0 }); continue; }
    blank(i); i++; continue;
  }
  return out.join("");
}

/** Index of the `)` that closes the `(` at `openIdx`, or -1 if unbalanced. */
function matchParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (["node_modules", ".next", "__snapshots__", "dist", "public", "coverage"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      if (/\.(test|spec)\.[cm]?tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

const violations = [];

for (const baseDir of SCAN_DIRS) {
  for (const file of walk(baseDir)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (ALLOW.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Cheap fast-path: no transition and no dialog helper => nothing to check.
    const hasTransition = body.includes("startTransition(") || body.includes("useTransition");
    if (!hasTransition || !/(confirm|alert|prompt)Dialog\s*\(/.test(body)) continue;

    const san = sanitize(body);

    // Transition fn names to scan: the global startTransition plus every name a
    // useTransition() destructure binds in this file (startSave, startApplying…).
    const names = new Set(["startTransition"]);
    TRANSITION_DECL.lastIndex = 0;
    let decl;
    while ((decl = TRANSITION_DECL.exec(san))) names.add(decl[1]);
    const START_RE = new RegExp(`\\b(?:${[...names].map(escapeRe).join("|")})\\s*\\(`, "g");
    const lineStarts = [0];
    for (let i = 0; i < san.length; i++) if (san[i] === "\n") lineStarts.push(i + 1);
    const lineOf = (idx) => {
      // binary search the last lineStart <= idx
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
      }
      return lo; // 0-based line index
    };
    const rawLines = body.split(/\r?\n/);

    START_RE.lastIndex = 0;
    let m;
    while ((m = START_RE.exec(san))) {
      const parenIdx = m.index + m[0].length - 1; // position of the opening '('
      const close = matchParen(san, parenIdx);
      const spanEnd = close === -1 ? san.length : close;
      DIALOG_RE.lastIndex = parenIdx + 1;
      let d;
      while ((d = DIALOG_RE.exec(san)) && d.index < spanEnd) {
        const dl = lineOf(d.index);
        violations.push({
          rel,
          name: d[1],
          transitionFn: m[0].replace(/\s*\($/, ""),
          dialogLine: dl + 1,
          transitionLine: lineOf(m.index) + 1,
          snippet: (rawLines[dl] || "").trim().slice(0, 100),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("");
  console.error("ERROR: BI-FE7C543C — in-app dialog helper called INSIDE a React transition.");
  console.error("");
  console.error("confirmDialog/alertDialog/promptDialog dispatch a DialogHost state update to");
  console.error("render. Deferred inside startTransition it never renders interactively — the");
  console.error("dialog silently never appears and the button wedges in its pending/disabled");
  console.error("state (bit EP-LABOR-ECONOMICS Phase 4 live, fixed in PR #2649).");
  console.error("");
  console.error("Await the dialog FIRST, OUTSIDE the transition, then run the work inside it");
  console.error("(canonical shape: apps/web/components/storefront-admin/ItemsManager.tsx handleDelete):");
  console.error("");
  console.error("    const ok = await confirmDialog({ title, message });");
  console.error("    if (!ok) return;");
  console.error("    startTransition(async () => { /* work */ });");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.dialogLine}  ${v.name}(...) inside ${v.transitionFn}( at line ${v.transitionLine} )`);
    console.error(`      ${v.snippet}`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ No in-app dialog helper is called inside a startTransition callback.");

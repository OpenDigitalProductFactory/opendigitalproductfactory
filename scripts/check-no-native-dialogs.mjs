#!/usr/bin/env node
/**
 * BI-B0E4F3F1 — Static guard: no native browser dialogs in portal code.
 *
 * The browser's native `window.confirm()`, `window.alert()`, and
 * `window.prompt()` are a dead end for agent automation: Claude-in-Chrome / CDP
 * `Input.dispatchMouseEvent` TIMES OUT while a native dialog is open, and the
 * action only commits when a HUMAN clicks OK (proven live — an operator had to
 * click OK twice to abandon two builds, see BI-297863B2). They also block the JS
 * thread, ignore the platform theme, and can't be tested.
 *
 * The platform premise is that agents drive Build Studio (and every other
 * surface) end-to-end. A flow gated behind a native dialog cannot be completed
 * by an agent. So native dialogs are banned in apps/web app/component/client
 * code; use the in-app primitives instead:
 *
 *     import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/Dialog";
 *
 * Those render real DOM (role="dialog", stable data-dialog-action refs) an agent
 * can find and click. This guard catches a reintroduced native call in SECONDS,
 * before it ships and silently breaks automation.
 *
 * Run: node scripts/check-no-native-dialogs.mjs
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

// A bare (or `window.`-prefixed) call to confirm/alert/prompt followed by `(`.
// The negative lookbehind `(?<![.\w])` skips:
//   - method calls on objects: `foo.confirm(`, `dialog.alert(`
//   - our own helpers:        `confirmDialog(`, `alertDialog(`, `promptDialog(`
//     (the global name is followed by "Dialog", never by `(`)
// The `window.` form is matched explicitly so `window.confirm(` is still caught.
// The paren must IMMEDIATELY follow the identifier — a real invocation is
// `confirm(`, never `confirm (` with a space. That keeps prose like
// "requires confirm (double-publish risk)" from tripping the guard.
const NATIVE_DIALOG =
  /(?<![.\w])(?:window\s*\.\s*)?(confirm|alert|prompt)\(/;

// Files allowed to mention the banned tokens (the primitive that REPLACES them,
// and this guard itself which documents the pattern). Keep this list tiny.
const ALLOW = new Set([
  "apps/web/components/ui/Dialog.tsx",
  "scripts/check-no-native-dialogs.mjs",
]);

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
      // Tests legitimately reference the strings (mock fns, XSS payload fixtures).
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
    const lines = body.split(/\r?\n/);
    lines.forEach((line, i) => {
      // Cheap noise filter: skip obvious comment-only lines so a doc reference
      // to "confirm(...)" doesn't trip the guard. Real calls are statements.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
      if (NATIVE_DIALOG.test(line)) {
        violations.push(`${rel}:${i + 1}  ${trimmed.slice(0, 100)}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("");
  console.error("ERROR: BI-B0E4F3F1 — native browser dialog found in portal code.");
  console.error("");
  console.error("window.confirm/alert/prompt block ALL browser automation (CDP times out");
  console.error("while the dialog is open) — an agent literally cannot complete the flow; it");
  console.error("strictly requires a human hand on the dialog. Use the in-app primitives:");
  console.error("");
  console.error('    import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/Dialog";');
  console.error("");
  console.error("    if (!(await confirmDialog({ title, message, tone: \"danger\" }))) return;");
  console.error("    await alertDialog(message);");
  console.error("    const value = await promptDialog({ title, message });");
  console.error("");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Fix at the source above. These render real DOM with stable");
  console.error("data-dialog-action refs an agent can find and click.");
  console.error("");
  process.exit(1);
}

console.log("✓ No native browser dialogs: confirm/alert/prompt are routed through the in-app primitive.");

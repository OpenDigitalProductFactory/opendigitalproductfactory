#!/usr/bin/env node
/**
 * check-no-suitability-object-shorthand — CI ratchet for BI-573A8EB3.
 *
 * Turbopack's production minifier inlines the small helpers in
 * apps/web/lib/routing/provider-suitability/ into their `.map(param => …)`
 * callers, renames the parameters, but then FAILS to rewrite an object-property
 * SHORTHAND `{ x }` whose value was one of those renamed parameters — emitting a
 * bare `{ x }` that binds to nothing. At runtime that is
 * `ReferenceError: <name> is not defined` on EVERY routed Build Studio phase
 * (plan / design-review / plan-review), which strands builds in `plan` and feeds
 * the deliberation flood (BI-8C44DB49).
 *
 * It bites one property at a time — the error throws on the FIRST dangling
 * reference — so a partial fix (rename only the property that happens to throw)
 * passes a narrow bundle grep but re-breaks on the NEXT shorthand after deploy.
 * That is exactly what happened: `workloadClass` was fixed, then
 * `classificationKnown` surfaced live. The only safe rule is: NO shorthand in the
 * object literals passed to `deriveAiWorkloadDataProfile(...)` in this directory.
 *
 * WHY A GUARD AND NOT A UNIT TEST: the bug exists ONLY in the minified production
 * bundle — source, tsc, and vitest are all clean, because they run the correct TS
 * source. Nothing but a built-bundle check or this source-level ban catches it.
 * This runs in the Repo Guard Loop (a required check), the surface-agnostic
 * chokepoint that actually blocks a merge.
 *
 *   node scripts/check-no-suitability-object-shorthand.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "apps", "web", "lib", "routing", "provider-suitability");
const CALL = "deriveAiWorkloadDataProfile(";

/**
 * Extract the balanced `{ … }` that is the first argument of each
 * `deriveAiWorkloadDataProfile(` call, and return the shorthand property names in
 * it. A shorthand property is a top-level (brace-depth 1) bare identifier that is
 * NOT followed by `:` and is not a spread. Pure + string-based (the guards here
 * do not carry an AST parser), scoped tightly enough that heavier syntax does not
 * reach it.
 */
export function findShorthandProps(source) {
  const findings = [];
  let from = 0;
  for (;;) {
    const call = source.indexOf(CALL, from);
    if (call === -1) break;
    from = call + CALL.length;
    const open = source.indexOf("{", call);
    if (open === -1 || open > source.indexOf(")", call) + 1) continue;
    // Walk the object literal with brace matching (good enough: the suitability
    // objects contain no braces inside strings/regex today, and the guard only
    // needs to see the TOP level).
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    const body = source.slice(open + 1, end);
    // Split top-level (depth-0) properties on commas.
    let d = 0;
    let cur = "";
    const props = [];
    for (const ch of body) {
      if (ch === "{" || ch === "[" || ch === "(") d += 1;
      else if (ch === "}" || ch === "]" || ch === ")") d -= 1;
      if (ch === "," && d === 0) { props.push(cur); cur = ""; continue; }
      cur += ch;
    }
    props.push(cur);
    for (const raw of props) {
      const p = raw.trim();
      if (!p || p.startsWith("...")) continue;
      // Explicit `key: value` or a method/computed key → fine. Shorthand is a
      // bare identifier that stands alone.
      if (/^[A-Za-z_$][\w$]*$/.test(p)) findings.push(p);
    }
  }
  return findings;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  const offenders = [];
  for (const file of walk(SCAN_DIR)) {
    const shorthand = findShorthandProps(readFileSync(file, "utf8"));
    for (const name of shorthand) {
      offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")} → deriveAiWorkloadDataProfile({ ${name} })`);
    }
  }
  if (offenders.length > 0) {
    console.error("check-no-suitability-object-shorthand: object SHORTHAND passed to deriveAiWorkloadDataProfile.");
    console.error("Turbopack's minifier drops inlined shorthand, producing a runtime ReferenceError that");
    console.error("breaks every routed Build Studio phase (BI-573A8EB3). Write it explicit: { workloadClass: x }.");
    console.error("");
    for (const o of offenders) console.error(`  ${o}`);
    console.error("");
    process.exit(1);
  }
  console.log("check-no-suitability-object-shorthand: OK — no inlined shorthand in the suitability path.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main();
}

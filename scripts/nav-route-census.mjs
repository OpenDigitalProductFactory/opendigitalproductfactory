// Throwaway structural census (EP-NAV-COHERENCE): cross-reference every App Router
// page route against the canonical portal-navigation-model. Not shipped — analysis only.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = "apps/web/app";
const MODEL = "apps/web/lib/navigation/portal-navigation-model.ts";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name === "page.tsx" || name === "page.ts") out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

function routePath(file) {
  let rel = file.slice(APP.length).replace(/\/page\.tsx?$/, "");
  const segs = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}
function routeGroup(file) {
  const m = file.slice(APP.length).match(/^\/(\([^)]+\))\//);
  return m ? m[1] : "(root)";
}
const isDynamic = (rp) => /\[.*\]/.test(rp);

// Canonical model paths
const modelSrc = readFileSync(MODEL, "utf8");
const modelPaths = new Set([...modelSrc.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]));
const redirectKinds = new Set(
  [...modelSrc.matchAll(/destinationKind:\s*"legacy-redirect"[\s\S]*?path:\s*"([^"]+)"/g)].map((m) => m[1]),
);

const files = walk(APP);
const buckets = { inModel: [], dynamic: [], redirectShim: [], orphan: [] };
const byGroup = {};
const shellOrphansByDomain = {};

for (const f of files) {
  const rp = routePath(f);
  const grp = routeGroup(f);
  byGroup[grp] = (byGroup[grp] || 0) + 1;
  const body = readFileSync(f, "utf8");
  const isRedirect = /\b(permanentRedirect|redirect)\s*\(/.test(body) && body.length < 4000;

  if (isDynamic(rp)) buckets.dynamic.push(rp);
  else if (modelPaths.has(rp)) buckets.inModel.push(rp);
  else if (isRedirect) buckets.redirectShim.push(rp);
  else {
    buckets.orphan.push({ rp, grp });
    if (grp === "(shell)") {
      const dom = rp.split("/")[1] || "(root)";
      (shellOrphansByDomain[dom] ||= []).push(rp);
    }
  }
}

// Reverse: model entries (non-dynamic, non-redirect) with no page file
const allRoutePaths = new Set(files.map(routePath));
const deadModel = [...modelPaths].filter(
  (p) => !allRoutePaths.has(p) && !isDynamic(p) && !redirectKinds.has(p),
);

console.log("=== TOTALS ===");
console.log("page routes:", files.length);
console.log("by route group:", byGroup);
console.log("model path entries:", modelPaths.size, "| model legacy-redirect entries:", redirectKinds.size);
console.log("\n=== CLASSIFICATION (all page routes) ===");
console.log("in canonical model :", buckets.inModel.length);
console.log("dynamic/detail     :", buckets.dynamic.length);
console.log("redirect shims     :", buckets.redirectShim.length);
console.log("ORPHANS (static, not in model, not redirect):", buckets.orphan.length);

const shellOrphans = buckets.orphan.filter((o) => o.grp === "(shell)");
console.log("\n=== (shell) ORPHANS by domain (reachable by URL, invisible to canonical nav/breadcrumb) ===");
for (const [dom, list] of Object.entries(shellOrphansByDomain).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n/${dom}  (${list.length})`);
  for (const rp of list.sort()) console.log("   ", rp);
}

console.log("\n=== ORPHANS in other route groups (separate shells — expected, for reference) ===");
const otherOrphans = buckets.orphan.filter((o) => o.grp !== "(shell)");
const otherByGroup = {};
for (const o of otherOrphans) (otherByGroup[o.grp] ||= []).push(o.rp);
for (const [g, l] of Object.entries(otherByGroup)) console.log(`${g}: ${l.length}`);

console.log("\n=== DEAD model entries (path in model, no page file, not dynamic/redirect) ===");
console.log(deadModel.length ? deadModel : "(none)");

console.log("\n=== redirect shims (legacy routes that redirect) ===");
console.log(buckets.redirectShim.sort());

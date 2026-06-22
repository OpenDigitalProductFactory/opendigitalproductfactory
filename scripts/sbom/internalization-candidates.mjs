#!/usr/bin/env node
// scripts/sbom/internalization-candidates.mjs
//
// "Use what's out there, but harden the validation" — the default is to rent
// (keep external + the controls). This ranks the minority of DIRECT dependencies
// that are better OWNED (vendored/rewritten into the portal), so the codescape
// optimization is data-backed, not gut.
//
// Owning a dep trades supply-chain-compromise risk for: you inherit all patching
// AND the code leaves the SBOM/OSV match (the scanner goes blind to it). So this
// is reserved for SMALL, STABLE, LOW-SECURITY, lightly-used utilities — and
// security-sensitive / framework / native packages are auto-excluded (KEEP).
//
// Signals (per direct dep): transitive weight (deps it drags, from the lockfile
// graph), package size + last-publish age (npm packument), runtime reach (does
// it ship in a deployed image), and a security/criticality name heuristic.
// The per-candidate "own it?" decision still goes through WWMD (principle_decide:
// operational_independence + vendor_lock_in vs long_term_maintainability +
// blast_radius). This only produces the shortlist.
//
// Usage: node scripts/sbom/internalization-candidates.mjs   (alias: pnpm candidates)

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph, collectProdRoots, closureFromKeys, baseKey, DEPLOYED_WORKSPACES } from "./runtime-surface.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/$/, "");

// Never own these: security-sensitive, parsers of untrusted input, framework /
// runtime cores, native bindings, build toolchain. Upstream's security response
// is the shield here, or the surface is too large/complex to safely reimplement.
const KEEP_EXTERNAL = /(crypt|cipher|jsonwebtoken|jwt|passport|bcrypt|argon|oauth|saml|webauthn|tls|^ws$|sanitiz|dompurify|xss|csrf|helmet|yaml|xml|parse5|html|node-forge|jose|secp|ed25519|hash|pbkdf|scrypt|^pg$|postgres|prisma|drizzle|sql|^auth|next|^react|expo|react-native|@babel|typescript|esbuild|vite|webpack|rollup|metro|sharp|jsdom|playwright|puppeteer|undici|hono|zod|node-gyp)/i;

async function getJson(url, { tries = 3, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let a = 0; a < tries; a++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 400 * (a + 1))); }
  }
  throw lastErr;
}
async function mapPool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

function main() {
  const { importers, snapshots, totalExternal } = loadGraph(ROOT);
  const runtimeBase = new Set([...closureFromKeys(snapshots, collectProdRoots(importers, DEPLOYED_WORKSPACES))].map(baseKey));

  // direct deps across all workspaces, deduped by name (prefer a runtime variant)
  const direct = new Map();
  for (const imp of Object.values(importers)) {
    for (const kind of ["prod", "dev"]) {
      for (const d of imp[kind]) {
        if (d.value.startsWith("link:") || d.value.startsWith("workspace:")) continue;
        const full = `${d.name}@${d.value}`;
        const rec = direct.get(d.name) || { name: d.name, full, kinds: new Set() };
        rec.kinds.add(kind);
        if (!direct.has(d.name) || (runtimeBase.has(baseKey(full)) && !runtimeBase.has(baseKey(rec.full)))) rec.full = full;
        direct.set(d.name, rec);
      }
    }
  }
  return { snapshots, runtimeBase, direct };
}

async function run() {
  const { snapshots, runtimeBase, direct } = main();
  const now = Date.now();

  const rows = await mapPool([...direct.values()], 8, async (rec) => {
    const bk = baseKey(rec.full);
    const version = bk.slice(rec.name.length + 1);
    const closure = new Set([...closureFromKeys(snapshots, [rec.full])].map(baseKey));
    const transitiveWeight = Math.max(0, closure.size - 1);
    const reach = runtimeBase.has(bk);
    const sensitive = KEEP_EXTERNAL.test(rec.name);

    let sizeKB = null, lastPublish = null, provenance = null;
    try {
      const pack = await getJson(`${REGISTRY}/${encodeURIComponent(rec.name)}`);
      const v = pack?.versions?.[version];
      if (v?.dist?.unpackedSize) sizeKB = Math.round(v.dist.unpackedSize / 1024);
      provenance = v?.dist?.attestations?.provenance?.predicateType ? "yes" : (v?.dist?.attestations ? "attested" : null);
      lastPublish = pack?.time?.[version] || pack?.time?.modified || null;
    } catch { /* offline-tolerant */ }

    const ageYears = lastPublish ? (now - Date.parse(lastPublish)) / (365 * 864e5) : null;

    // Ownable = SMALL + SELF-CONTAINED (few/no transitives) + STABLE + low-security.
    // High transitive weight is a COMPLEXITY signal (jest/mermaid-cli drag huge
    // trees because the tool itself is huge) → keep, don't reimplement.
    let verdict, score;
    if (rec.name.startsWith("@types/")) { verdict = "skip (type-only, no runtime code)"; score = -1; }
    else if (sensitive) { verdict = "keep (security/core/native)"; score = -1; }
    else if ((sizeKB != null && sizeKB > 500) || transitiveWeight > 20) { verdict = "keep (large/entangled)"; score = 0; }
    else {
      const sizePts = sizeKB == null ? 1 : sizeKB <= 30 ? 3 : sizeKB <= 100 ? 2 : sizeKB <= 200 ? 1 : 0;
      const closurePts = transitiveWeight === 0 ? 2 : transitiveWeight <= 3 ? 1 : 0; // self-contained = ownable
      const stablePts = ageYears != null && ageYears >= 2 ? 1 : 0; // settled domain, low churn to track
      const reachPts = reach ? 1 : 0; // runs in prod → higher security payoff from owning
      score = sizePts + closurePts + stablePts + reachPts;
      verdict = score >= 4 && transitiveWeight <= 5 && (sizeKB == null || sizeKB <= 150) ? "OWN-CANDIDATE" : "review";
    }
    return { name: rec.name, version, kinds: [...rec.kinds].join("/"), reach, transitiveWeight, sizeKB, lastPublish, provenance, sensitive, verdict, score };
  });

  rows.sort((a, b) => b.score - a.score || b.transitiveWeight - a.transitiveWeight || a.name.localeCompare(b.name));
  const own = rows.filter((r) => r.verdict === "OWN-CANDIDATE");
  const keep = rows.filter((r) => r.verdict.startsWith("keep"));
  const review = rows.filter((r) => r.verdict === "review");

  const fmtDate = (d) => (d ? d.slice(0, 7) : "—");
  const L = [];
  L.push("# DPF Dependency Internalization Candidates");
  L.push("");
  L.push(`_Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} direct deps scored · source ${REGISTRY}._`);
  L.push("");
  L.push("> Default = rent (keep external + controls). This is the minority worth OWNING.");
  L.push("> Owning removes a package from SBOM/OSV matching and transfers all patching,");
  L.push("> so security-sensitive / framework / native packages are auto-excluded. The");
  L.push("> per-candidate decision goes through WWMD (`principle_decide`).");
  L.push("");
  L.push(`**${own.length} own-candidate(s) · ${review.length} review · ${keep.length} keep-external.**`);
  L.push("");
  L.push("## Own-candidates (small · self-contained · low-security · stable)");
  L.push("");
  L.push("| Score | Package | Version | Runtime? | Transitives | Size KB | Last publish | Provenance |");
  L.push("| ---: | --- | --- | :---: | ---: | ---: | --- | --- |");
  for (const r of own) L.push(`| ${r.score} | \`${r.name}\` | ${r.version} | ${r.reach ? "yes" : "no"} | ${r.transitiveWeight} | ${r.sizeKB ?? "?"} | ${fmtDate(r.lastPublish)} | ${r.provenance || "—"} |`);
  if (!own.length) L.push("| — | _(none cleared the bar)_ | | | | | | |");
  L.push("");
  L.push("## Review (small + low-security, but weak payoff — usually just keep)");
  L.push("");
  L.push("| Package | Version | Drags | Size KB | Last publish |");
  L.push("| --- | --- | ---: | ---: | --- |");
  for (const r of review.slice(0, 30)) L.push(`| \`${r.name}\` | ${r.version} | ${r.transitiveWeight} | ${r.sizeKB ?? "?"} | ${fmtDate(r.lastPublish)} |`);
  L.push("");
  L.push(`## Keep external (${keep.length}) — security-sensitive, framework, native, or large`);
  L.push("");
  L.push("_Upstream's maintenance + security response is the shield; do not reimplement._");
  L.push("");

  mkdirSync(join(ROOT, "sbom"), { recursive: true });
  writeFileSync(join(ROOT, "sbom", "internalization-candidates.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  writeFileSync(join(ROOT, "sbom", "internalization-candidates.md"), L.join("\n"));

  process.stdout.write(
    [
      `Internalization candidacy: ${rows.length} direct deps scored.`,
      `  OWN-CANDIDATE: ${own.length}` + (own.length ? ` -> ${own.slice(0, 8).map((r) => r.name).join(", ")}` : ""),
      `  review: ${review.length}  |  keep-external: ${keep.length}`,
      `Report: ${join(ROOT, "sbom", "internalization-candidates.md")}`,
      "",
    ].join("\n"),
  );
}

run().catch((e) => { process.stderr.write(`::error::internalization-candidates failed: ${e?.stack || e}\n`); process.exit(2); });

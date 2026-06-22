#!/usr/bin/env node
// scripts/sbom/audit-provenance.mjs
//
// Provenance + postinstall-script audit — layer #2 of the package-acquisition
// hardening program (principle_decide 2026-06-20, composite 7.66). Reports two
// supply-chain signals that the OSV scan and the New Dependency Gate don't:
//
//   1. INSTALL SCRIPTS — which packages want to run code at install
//      (`hasInstallScript`). pnpm only RUNS them for the `allowBuilds` allowlist;
//      this surfaces who wants to, and flags any allowlisted package that runs
//      code, so the allowlist stays a reviewed decision rather than drift.
//   2. PROVENANCE — whether a package was published with a signed SLSA build
//      attestation (`dist.attestations.provenance`). Provenance ties the
//      published tarball to the source commit + CI that built it.
//
// Report-only (most of the ecosystem hasn't adopted provenance yet, so this is
// visibility, not a gate). Scope: the packages we deliberately acquire (direct
// deps) plus everything permitted to run install scripts (allowBuilds) — the
// security-relevant set for "what we bake in". Data: the npm registry packument
// (NPM_REGISTRY_URL to point at a mirror). Graceful when offline.
//
// Usage: node scripts/sbom/audit-provenance.mjs   (alias: pnpm audit:provenance)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listDirectDependencies, generatePlatformSbom } from "./generate-platform-sbom.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/$/, "");
const OUT = join(ROOT, "sbom");

function parseAllowBuilds(workspaceYaml) {
  const lines = workspaceYaml.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("allowBuilds:");
  if (start < 0) return new Set();
  const out = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    const m = lines[i].match(/^ {2}'?([^':]+)'?:\s*true/);
    if (m) out.add(m[1].trim());
  }
  return out;
}

async function getJson(url, { tries = 3, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

function main() {
  const allowBuilds = parseAllowBuilds(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"));
  const direct = listDirectDependencies(ROOT); // Map<name,{versions:Set,...}>
  const { cyclonedx } = generatePlatformSbom({ root: ROOT, gitRef: "audit", generatedAt: new Date(0) });

  // resolved versions for every npm component, for allowBuilds names that aren't direct
  const versionsByName = new Map();
  for (const c of cyclonedx.components) {
    if (typeof c.purl === "string" && c.purl.startsWith("pkg:npm/") && c.version) {
      if (!versionsByName.has(c.name)) versionsByName.set(c.name, new Set());
      versionsByName.get(c.name).add(c.version);
    }
  }

  // audit set: direct deps + allowBuilds packages
  const names = new Set([...direct.keys(), ...allowBuilds]);
  return { allowBuilds, direct, versionsByName, names };
}

async function run() {
  const { allowBuilds, direct, versionsByName, names } = main();

  let packuments;
  try {
    packuments = new Map(
      await mapPool([...names], 8, async (name) => {
        const enc = encodeURIComponent(name);
        try {
          return [name, await getJson(`${REGISTRY}/${enc}`)];
        } catch {
          return [name, null];
        }
      }),
    );
  } catch (err) {
    process.stdout.write(`SKIPPED: npm registry unreachable (${err?.message || err}). Set NPM_REGISTRY_URL to a mirror.\n`);
    process.exit(0);
  }

  const rows = [];
  for (const name of [...names].sort()) {
    const versions = direct.get(name)?.versions?.size ? [...direct.get(name).versions] : [...(versionsByName.get(name) || ["*"])];
    const pack = packuments.get(name);
    for (const version of versions) {
      const v = pack?.versions?.[version] || {};
      const att = v.dist?.attestations;
      rows.push({
        name,
        version,
        direct: direct.has(name),
        allowlistedBuild: allowBuilds.has(name),
        hasInstallScript: Boolean(v.hasInstallScript),
        provenance: att?.provenance?.predicateType || (att ? "attested" : null),
        resolved: Boolean(pack?.versions?.[version]),
      });
    }
  }

  // risk ordering: packages that RUN code at install (allowlisted + install script) first
  const runsCode = rows.filter((r) => r.allowlistedBuild && r.hasInstallScript);
  const wantsButBlocked = rows.filter((r) => r.hasInstallScript && !r.allowlistedBuild);
  const withProvenance = rows.filter((r) => r.provenance).length;

  const L = [];
  L.push("# DPF Dependency Provenance & Install-Script Audit");
  L.push("");
  L.push(`_Generated ${new Date().toISOString().slice(0, 10)} · ${rows.length} packages audited (direct deps + allowBuilds) · source ${REGISTRY}._`);
  L.push("");
  L.push("> Layer #2 of the acquisition-hardening program. Reports who runs code at");
  L.push("> install and who ships signed build provenance — the supply-chain signals");
  L.push("> the OSV scan and New Dependency Gate don't cover. Report-only.");
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`- **${runsCode.length}** package(s) RUN install scripts (in \`allowBuilds\` AND declare a script) — the code-execution set, keep this minimal + provenanced.`);
  L.push(`- **${wantsButBlocked.length}** package(s) declare an install script but are NOT allowlisted → pnpm blocks them (safe; listed for awareness).`);
  L.push(`- **${withProvenance}/${rows.length}** audited packages publish SLSA build provenance.`);
  L.push("");
  if (runsCode.length) {
    L.push("## Runs code at install (allowBuilds + install script)");
    L.push("");
    L.push("| Package | Version | Provenance |");
    L.push("| --- | --- | --- |");
    for (const r of runsCode) L.push(`| \`${r.name}\` | ${r.version} | ${r.provenance ? "✅ " + r.provenance : "⚠️ none"} |`);
    L.push("");
  }
  if (wantsButBlocked.length) {
    L.push("## Declares an install script but blocked by pnpm (not allowlisted)");
    L.push("");
    L.push("| Package | Version |");
    L.push("| --- | --- |");
    for (const r of wantsButBlocked.slice(0, 40)) L.push(`| \`${r.name}\` | ${r.version} |`);
    L.push("");
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "provenance-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), registry: REGISTRY, rows }, null, 2));
  writeFileSync(join(OUT, "provenance-audit.md"), L.join("\n"));

  process.stdout.write(
    [
      `Provenance/install-script audit: ${rows.length} packages.`,
      `  run code at install (allowlisted): ${runsCode.length}`,
      `  want script but pnpm-blocked: ${wantsButBlocked.length}`,
      `  publish SLSA provenance: ${withProvenance}/${rows.length}`,
      `Report: ${join(OUT, "provenance-audit.md")}`,
      "",
    ].join("\n"),
  );
}

run().catch((err) => {
  process.stderr.write(`::error::audit-provenance failed: ${err?.stack || err}\n`);
  process.exit(2);
});

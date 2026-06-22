#!/usr/bin/env node
// scripts/sbom/scan-dependencies.mjs
//
// Local, GitHub-free vulnerability scanner — the Dependabot-equivalent for
// DPF installs running on local / self-hosted git, where GitHub's Dependabot
// (security alerts + version-update PRs) simply does not exist.
//
// It reads the platform SBOM (scripts/sbom/generate-platform-sbom.mjs — same
// pnpm-lock source, no install needed) and checks every resolved component
// against the **OSV.dev** database. OSV aggregates the GitHub Advisory Database
// (GHSA) among others, so this surfaces the same advisories Dependabot would —
// just without depending on GitHub.
//
// Sovereignty note: the only data sent off-box is `{ecosystem, name, version}`
// per package (all public OSS identifiers) to api.osv.dev — the same exposure
// Dependabot has when it reads your manifest. For air-gapped installs the DB
// source is swappable: OSV publishes the full DB for offline mirroring
// (gs://osv-vulnerabilities) — wire OSV_BASE_URL at a local mirror.
//
// Demarcation: this is the SECURITY / vulnerability / lifecycle axis. The
// REDUCTION / efficiency axis lives in check-sbom-drift.mjs. Together they make
// up for what Dependabot does automatically on GitHub.
//
// Usage:
//   node scripts/sbom/scan-dependencies.mjs                 # report-only (CLI)
//   node scripts/sbom/scan-dependencies.mjs --fail-on high  # gate (CI)
//   node scripts/sbom/scan-dependencies.mjs --write-baseline # accept current set
//
// Env: OSV_BASE_URL (default https://api.osv.dev) — point at an offline mirror.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlatformSbom } from "./generate-platform-sbom.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OSV_BASE = process.env.OSV_BASE_URL ?? "https://api.osv.dev";
const BASELINE_PATH = join(ROOT, "sbom", "vuln-baseline.json");

const SEV_RANK = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, unknown: 0 };

function parseArgs(argv) {
  const out = { failOn: "none", writeBaseline: false, requireOnline: false, out: join(ROOT, "sbom") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fail-on") out.failOn = (argv[++i] ?? "none").toLowerCase();
    else if (argv[i] === "--write-baseline") out.writeBaseline = true;
    else if (argv[i] === "--require-online") out.requireOnline = true;
    else if (argv[i] === "--out") out.out = resolve(argv[++i]);
  }
  return out;
}

async function postJson(url, body, { tries = 3, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
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

// run async mapper with bounded concurrency
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function severityOf(vuln) {
  const db = vuln.database_specific?.severity;
  if (typeof db === "string" && SEV_RANK[db.toLowerCase()] != null) return db.toLowerCase();
  // CVSS vector → coarse band
  const cvss = (vuln.severity || []).find((s) => String(s.type || "").startsWith("CVSS"));
  if (cvss?.score && /CVSS:/.test(cvss.score)) {
    // We don't fully parse the vector; GHSA almost always sets database_specific.
    return "unknown";
  }
  return "unknown";
}

function fixedVersionsFor(vuln, name) {
  const out = new Set();
  for (const aff of vuln.affected || []) {
    if (aff.package?.ecosystem !== "npm" || aff.package?.name !== name) continue;
    for (const r of aff.ranges || []) for (const e of r.events || []) if (e.fixed) out.add(e.fixed);
  }
  return [...out].sort();
}

function aliasesOf(vuln) {
  const ids = [vuln.id, ...(vuln.aliases || [])];
  const cve = ids.filter((x) => /^CVE-/.test(x));
  const ghsa = ids.filter((x) => /^GHSA-/.test(x));
  return { cve, ghsa };
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return { accepted: [] };
  }
}

function renderMarkdown({ findings, counts, generatedAt, scanned, gitRef, acceptedCount }) {
  const L = [];
  L.push("# DPF Dependency Vulnerability Scan");
  L.push("");
  L.push(`_Generated ${generatedAt.slice(0, 10)} · ${scanned} components scanned · source OSV.dev (gitRef \`${gitRef}\`) via \`scripts/sbom/scan-dependencies.mjs\`._`);
  L.push("");
  L.push("> The local, GitHub-free equivalent of Dependabot's security alerts. OSV");
  L.push("> aggregates the GitHub Advisory Database, so these are the same advisories");
  L.push("> Dependabot would surface — without depending on GitHub.");
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push("| Severity | Count |");
  L.push("| --- | ---: |");
  for (const s of ["critical", "high", "moderate", "low", "unknown"]) L.push(`| ${s} | ${counts[s] || 0} |`);
  L.push(`| **accepted (baselined)** | ${acceptedCount} |`);
  L.push("");
  if (!findings.length) {
    L.push("**No active (non-accepted) vulnerabilities found.** ✅");
    L.push("");
    return L.join("\n");
  }
  L.push("## Findings");
  L.push("");
  L.push("| Severity | Package | Installed | Fixed in | Advisory | Summary |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  for (const f of findings) {
    const ids = [...f.cve, ...f.ghsa].join(" ");
    const fixed = f.fixedVersions.length ? f.fixedVersions.join(", ") : "—";
    const summary = (f.summary || "").replace(/\|/g, "\\|").slice(0, 90);
    L.push(`| ${f.severity} | \`${f.name}\` | ${f.version} | ${fixed} | ${ids} | ${summary} |`);
  }
  L.push("");
  return L.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gitRef = process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "unknown";
  const { cyclonedx } = generatePlatformSbom({ root: ROOT, gitRef, generatedAt: new Date(0) });
  const components = cyclonedx.components
    .filter((c) => typeof c.purl === "string" && c.purl.startsWith("pkg:npm/") && c.version)
    .map((c) => ({ name: c.name, version: c.version }));

  let results;
  try {
    results = [];
    for (const part of chunk(components, 1000)) {
      const body = { queries: part.map((c) => ({ package: { ecosystem: "npm", name: c.name }, version: c.version })) };
      const j = await postJson(`${OSV_BASE}/v1/querybatch`, body);
      results.push(...(j.results || []));
    }
  } catch (err) {
    const msg = `OSV database unreachable (${err?.message || err}). Set OSV_BASE_URL to a mirror for air-gapped installs.`;
    if (args.requireOnline) {
      process.stderr.write(`::error::${msg}\n`);
      process.exit(2);
    }
    process.stdout.write(`SKIPPED: ${msg}\n`);
    process.exit(0);
  }

  // affected (component, vulnId) pairs + unique ids to detail-fetch
  const affected = [];
  const idSet = new Set();
  results.forEach((res, idx) => {
    for (const v of res?.vulns || []) {
      affected.push({ comp: components[idx], id: v.id });
      idSet.add(v.id);
    }
  });

  const idList = [...idSet];
  const details = await mapPool(idList, 10, async (id) => {
    try {
      return await getJson(`${OSV_BASE}/v1/vulns/${encodeURIComponent(id)}`);
    } catch {
      return { id }; // tolerate a single failed detail fetch
    }
  });
  const detailById = new Map(idList.map((id, i) => [id, details[i]]));

  const baseline = loadBaseline();
  // Accepted entries expire: an `expires` date in the past re-surfaces the
  // finding, forcing periodic re-review (a real vuln-management discipline).
  const today = new Date().toISOString().slice(0, 10);
  const expired = (baseline.accepted || []).filter((a) => a.expires && a.expires < today);
  const activeAccepts = (baseline.accepted || []).filter((a) => !a.expires || a.expires >= today);
  if (expired.length) {
    process.stderr.write(`::warning::${expired.length} accepted vuln(s) past their expiry — re-review: ${expired.map((a) => a.id).join(", ")}\n`);
  }
  const acceptedIds = new Set(activeAccepts.flatMap((a) => [a.id, ...(a.aliases || [])]).filter(Boolean));

  let acceptedCount = 0;
  const findings = [];
  for (const a of affected) {
    const v = detailById.get(a.id) || { id: a.id };
    const { cve, ghsa } = aliasesOf(v);
    const isAccepted = acceptedIds.has(a.id) || cve.some((x) => acceptedIds.has(x)) || ghsa.some((x) => acceptedIds.has(x));
    if (isAccepted) { acceptedCount++; continue; }
    findings.push({
      name: a.comp.name,
      version: a.comp.version,
      id: a.id,
      cve,
      ghsa,
      severity: severityOf(v),
      fixedVersions: fixedVersionsFor(v, a.comp.name),
      summary: v.summary || v.details?.split("\n")[0] || "",
    });
  }
  findings.sort((x, y) => (SEV_RANK[y.severity] - SEV_RANK[x.severity]) || x.name.localeCompare(y.name));

  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const generatedAt = new Date().toISOString();
  const report = { generatedAt, gitRef, scanned: components.length, source: OSV_BASE, counts, acceptedCount, findings };

  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, "dependency-scan.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(args.out, "dependency-scan.md"), renderMarkdown({ findings, counts, generatedAt, scanned: components.length, gitRef, acceptedCount }));

  if (args.writeBaseline) {
    const accepted = findings.map((f) => ({
      id: f.ghsa[0] || f.cve[0] || f.id,
      aliases: [...f.ghsa, ...f.cve].filter((x) => x !== (f.ghsa[0] || f.cve[0] || f.id)),
      package: `${f.name}@${f.version}`,
      severity: f.severity,
      reason: "BOOTSTRAP — review and either remediate or justify acceptance",
    }));
    writeFileSync(BASELINE_PATH, JSON.stringify({ note: "Accepted vulnerability advisories for scripts/sbom/scan-dependencies.mjs. Each entry needs a real `reason` (and ideally an `expires`). The gate fails on any non-accepted finding at/above --fail-on. See docs/architecture/dependency-reduction-routine.md.", accepted }, null, 2) + "\n");
    process.stdout.write(`Baseline written: ${BASELINE_PATH} (${accepted.length} accepted) — REVIEW the reasons.\n`);
  }

  const order = ["critical", "high", "moderate", "low", "unknown"];
  process.stdout.write(
    [
      `Dependency vuln scan: ${components.length} components, ${affected.length} advisories (${acceptedCount} accepted).`,
      ...order.map((s) => `  ${s}: ${counts[s] || 0}`),
      `Report: ${join(args.out, "dependency-scan.md")}`,
      "",
    ].join("\n"),
  );

  const threshold = SEV_RANK[args.failOn];
  if (threshold != null && threshold > 0) {
    const blocking = findings.filter((f) => SEV_RANK[f.severity] >= threshold);
    if (blocking.length) {
      process.stderr.write(`::error::${blocking.length} unaccepted vulnerabilit${blocking.length === 1 ? "y" : "ies"} at or above '${args.failOn}'. Remediate (bump to the fixed version) or accept with justification in sbom/vuln-baseline.json.\n`);
      for (const f of blocking.slice(0, 25)) {
        process.stderr.write(`  - [${f.severity}] ${f.name}@${f.version} ${[...f.ghsa, ...f.cve].join(" ")} → fix: ${f.fixedVersions.join(", ") || "none available"}\n`);
      }
      process.exit(1);
    }
  }
  process.stdout.write("OK — no blocking vulnerabilities.\n");
}

main().catch((err) => {
  process.stderr.write(`::error::scan-dependencies failed: ${err?.stack || err}\n`);
  process.exit(2);
});

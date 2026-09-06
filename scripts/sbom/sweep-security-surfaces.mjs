#!/usr/bin/env node
// scripts/sbom/sweep-security-surfaces.mjs
//
// The standing security-findings sweep for Workroom WC-42C558DD.
//
// WHY THIS EXISTS: the GitHub Security tab aggregates THREE independent
// surfaces — Dependabot alerts, Code Scanning (CodeQL), and Secret Scanning.
// Querying only Dependabot under-reports, which is exactly how a high-severity
// `js/redos` code-scanning alert sat unnoticed while we reported "2 open" to an
// operator who could see 3. This sweeps all three in one pass and prints ONE
// reconciled posture, so no surface can be silently missed again.
//
// It is REPORT-ONLY and never fails the build. The blocking gate is the OSV
// scan (scripts/sbom/scan-dependencies.mjs --fail-on high); this is the
// visibility layer on top of it.
//
//   node scripts/sbom/sweep-security-surfaces.mjs                 # human-readable
//   node scripts/sbom/sweep-security-surfaces.mjs --json out.json # machine-readable
//   node scripts/sbom/sweep-security-surfaces.mjs --md out.md     # markdown report
//
// Needs a token with `security-events: read` in GITHUB_TOKEN (or GH_TOKEN).
// Offline / no token → prints a clear SKIPPED notice and exits 0, so a local
// run or an air-gapped install degrades loudly rather than reporting a false
// all-clear.

import { writeFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY ?? "OpenDigitalProductFactory/opendigitalproductfactory";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

/**
 * Fetch every page of an alerts endpoint. Returns {ok, alerts, reason}.
 *
 * Pagination follows the `Link: rel="next"` header rather than incrementing a
 * `page` param: the Dependabot alerts endpoint is CURSOR-paginated (before/after)
 * and returns HTTP 400 for `page=`, while code/secret scanning are page-based.
 * Link-following is the one form that is correct for all three.
 */
async function fetchAlerts(surface) {
  if (!TOKEN) return { ok: false, alerts: [], reason: "no GITHUB_TOKEN/GH_TOKEN in the environment" };
  const alerts = [];
  let url = `${API}/repos/${REPO}/${surface}/alerts?state=open&per_page=100`;
  for (let hop = 0; hop < 20 && url; hop++) {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      });
    } catch (err) {
      return { ok: false, alerts: [], reason: `network error: ${err.message}` };
    }
    // 404 here means the feature is disabled for the repo, not that it is clean —
    // report it as unknown rather than folding it into a zero.
    if (res.status === 404) return { ok: false, alerts: [], reason: "surface not enabled or not visible to this token (404)" };
    // The default GITHUB_TOKEN reads Code Scanning but 403s on Dependabot and
    // Secret Scanning even with `security-events: read`. Name the remedy here —
    // a bare "403" reads like a transient outage and gets ignored.
    if (res.status === 403) {
      return {
        ok: false,
        alerts: [],
        reason: "403 — the default GITHUB_TOKEN cannot read this surface; set the SECURITY_SWEEP_APP_ID + SECURITY_SWEEP_APP_PRIVATE_KEY secrets (GitHub App) or DEPENDABOT_ALERTS_TOKEN (fine-grained PAT) — see BI-3E6AFF04",
      };
    }
    if (!res.ok) return { ok: false, alerts: [], reason: `HTTP ${res.status}` };
    const batch = await res.json();
    if (!Array.isArray(batch)) return { ok: false, alerts: [], reason: "unexpected non-array response" };
    alerts.push(...batch);
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return { ok: true, alerts, reason: null };
}

const sevOf = (a) =>
  a.security_advisory?.severity ?? a.rule?.security_severity_level ?? a.rule?.severity ?? "unknown";

function normalize(surface, a) {
  if (surface === "dependabot") {
    return {
      number: a.number,
      severity: sevOf(a),
      label: a.dependency?.package?.name ?? "unknown",
      detail: a.security_advisory?.ghsa_id ?? "",
      hasFix: Boolean(a.security_vulnerability?.first_patched_version?.identifier),
      url: a.html_url,
    };
  }
  if (surface === "code-scanning") {
    return {
      number: a.number,
      severity: sevOf(a),
      label: a.rule?.id ?? "unknown",
      detail: a.most_recent_instance?.location?.path ?? "",
      url: a.html_url,
    };
  }
  return { number: a.number, severity: "unknown", label: a.secret_type ?? "secret", detail: "", url: a.html_url };
}

const SURFACES = [
  ["dependabot", "Dependabot"],
  ["code-scanning", "Code scanning"],
  ["secret-scanning", "Secret scanning"],
];

const report = { repo: REPO, surfaces: {}, totals: { open: 0, unreadable: 0 } };

for (const [surface, title] of SURFACES) {
  const { ok, alerts, reason } = await fetchAlerts(surface);
  report.surfaces[surface] = ok
    ? { title, readable: true, open: alerts.length, alerts: alerts.map((a) => normalize(surface, a)) }
    : { title, readable: false, open: null, reason, alerts: [] };
  if (ok) report.totals.open += alerts.length;
  else report.totals.unreadable += 1;
}

// ---- output ----------------------------------------------------------------

const lines = [];
lines.push(`# Security findings sweep — ${REPO}`);
lines.push("");
if (report.totals.unreadable > 0) {
  lines.push(
    `> **${report.totals.unreadable} of 3 surfaces could not be read.** A surface that cannot be read is NOT a clean surface — treat this sweep as incomplete.`,
  );
  lines.push("");
}
lines.push("| Surface | Open |");
lines.push("| --- | --- |");
for (const [surface, title] of SURFACES) {
  const s = report.surfaces[surface];
  lines.push(`| ${title} | ${s.readable ? s.open : `⚠️ unreadable — ${s.reason}`} |`);
}
lines.push("");

for (const [surface, title] of SURFACES) {
  const s = report.surfaces[surface];
  if (!s.readable || s.open === 0) continue;
  lines.push(`## ${title} (${s.open})`);
  lines.push("");
  lines.push("| # | Severity | What | Where |");
  lines.push("| --- | --- | --- | --- |");
  for (const a of s.alerts) {
    const where = surface === "dependabot" && a.hasFix === false ? `${a.detail} · **no patched release**` : a.detail;
    lines.push(`| [${a.number}](${a.url}) | ${a.severity} | \`${a.label}\` | ${where || "—"} |`);
  }
  lines.push("");
}

lines.push("---");
lines.push("");
lines.push("**A row here is not automatically an unfixed risk.** A finding can stay open because a");
lines.push("`pnpm patch` fixed the defect without changing the version string OSV matches on. Reconcile");
lines.push("against `sbom/vuln-baseline.json` and the decision history in Workroom **WC-42C558DD**");
lines.push("before concluding anything. The authority on what is actually vulnerable is");
lines.push("`pnpm scan:deps --fail-on high`, not this list.");

const md = lines.join("\n");
const mdOut = argOf("--md");
const jsonOut = argOf("--json");
if (mdOut) writeFileSync(mdOut, `${md}\n`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

console.log(md);

if (report.totals.unreadable === 3) {
  console.log("\nSKIPPED — no surface was readable (offline or no token). Not reporting an all-clear.");
}

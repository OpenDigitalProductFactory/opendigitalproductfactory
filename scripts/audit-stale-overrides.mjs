#!/usr/bin/env node
// scripts/audit-stale-overrides.mjs
//
// Standing stale-override audit (BI-CDB2E8AB) — the periodic guard that keeps the
// `overrides:` control surface legible by construction. A CVE security floor is
// dead weight the moment the direct/parent dependency naturally resolves to a
// patched version on its own; nobody removes floors, so the block only grows
// (spec §7.4). This audit cross-checks each TAGGED floor against the GitHub
// Dependabot alerts API — "is the advisory that justified this floor still open?"
// — and reports the floors whose alert is no longer open as prune CANDIDATES.
//
// It PROPOSES; a human/agent VERIFIES each prune via the §7.1 per-floor prune
// screen (regen against a fresh store) before removing anything — exactly the
// BI-316CCCD7 discipline. It never edits overrides.
//
// Relies on the Override Provenance Guard's tag convention
// (scripts/check-override-comments.mjs): every security floor carries a
// `Dependabot #NN` / `GHSA-…` / `CVE-…` id. Floors without a machine-readable tag
// (grandfathered debt) are reported as UN-AUDITABLE so the tag gets backfilled.
//
// Report-only by default (exit 0). Graceful offline: with no token or an
// unreachable API it emits the parse-only half (tag coverage) and skips the
// cross-check, so a fully-local run still produces useful output.
//
// Usage:
//   node scripts/audit-stale-overrides.mjs                 # report (CI / manual)
//   node scripts/audit-stale-overrides.mjs --require-online # fail if API unreachable (scheduled)
//   node scripts/audit-stale-overrides.mjs --fail-on-candidates # exit 1 if any candidate found
//
// Auth: GITHUB_TOKEN (or GH_TOKEN) with `security_events: read` on the repo.
// Repo: GITHUB_REPOSITORY (owner/name), else parsed from the origin remote is the
// workflow's job — pass --repo owner/name to override.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOverrides } from "./check-override-comments.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "sbom");
const API = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");

// A Dependabot alert is "no longer justifying a floor" when it is not open.
const RESOLVED_STATES = new Set(["fixed", "dismissed", "auto_dismissed"]);

/**
 * Normalize a raw advisory tag string into a lookup key.
 * @param {string} raw e.g. "Dependabot #105", "GHSA-frvp-7c67-39w9", "CVE-2026-33327"
 * @returns {{ type: "dependabot"|"ghsa"|"cve", key: string, label: string } | null}
 */
export function normalizeTag(raw) {
  const dependabot = raw.match(/Dependabot #(\d+)/i);
  if (dependabot) return { type: "dependabot", key: `#${dependabot[1]}`, label: raw.trim() };
  const ghsa = raw.match(/GHSA-[0-9a-z]{4,}-[0-9a-z]{4,}-[0-9a-z]{4,}/i);
  if (ghsa) return { type: "ghsa", key: ghsa[0].toLowerCase(), label: ghsa[0] };
  const cve = raw.match(/CVE-\d{4}-\d{4,}/i);
  if (cve) return { type: "cve", key: cve[0].toLowerCase(), label: cve[0] };
  return null;
}

/**
 * Build a lookup from advisory id → alert state out of the raw Dependabot alerts.
 * Each alert is indexed by its number (#NN), GHSA id, and CVE id so any tag form
 * resolves.
 * @param {Array<{number:number,state:string,security_advisory?:{ghsa_id?:string,cve_id?:string}}>} alerts
 * @returns {Map<string,string>} lookup key → state
 */
export function buildAlertLookup(alerts) {
  const lookup = new Map();
  for (const a of alerts) {
    if (typeof a.number === "number") lookup.set(`#${a.number}`, a.state);
    const ghsa = a.security_advisory?.ghsa_id;
    if (ghsa) lookup.set(ghsa.toLowerCase(), a.state);
    const cve = a.security_advisory?.cve_id;
    if (cve) lookup.set(cve.toLowerCase(), a.state);
  }
  return lookup;
}

/**
 * Classify every override floor against the alert lookup. Pure.
 * @param {Array<{key:string,tags:string[],classification:string}>} entries from parseOverrides
 * @param {Map<string,string>|null} lookup null = cross-check unavailable (offline)
 * @returns {{ loadBearing: object[], candidates: object[], unauditable: object[], unknown: object[] }}
 */
export function classifyFloors(entries, lookup) {
  const loadBearing = [];
  const candidates = [];
  const unauditable = [];
  const unknown = [];

  for (const e of entries) {
    // Only security floors are auditable. Dedup/compat/pattern pins are not CVE
    // floors — they never go "redundant" on advisory grounds, so skip them.
    if (e.classification === "dedup-exempt" || e.classification === "pattern-exempt") continue;

    // A security floor with no machine-readable tag can't be cross-checked.
    if (e.tags.length === 0) {
      unauditable.push({ key: e.key, reason: e.classification });
      continue;
    }

    if (!lookup) continue; // offline: reported separately as "cross-check skipped"

    const resolutions = e.tags
      .map((t) => normalizeTag(t))
      .filter(Boolean)
      .map((n) => ({ ...n, state: lookup.get(n.key) ?? "not-found" }));

    const anyOpen = resolutions.some((r) => r.state === "open");
    const anyFound = resolutions.some((r) => r.state !== "not-found");
    const allResolved = anyFound && resolutions.every((r) => RESOLVED_STATES.has(r.state));

    const row = { key: e.key, tags: resolutions };
    if (anyOpen) loadBearing.push(row);
    else if (allResolved) candidates.push(row);
    else unknown.push(row); // some tags not found & none open — can't confirm either way
  }

  return { loadBearing, candidates, unauditable, unknown };
}

// ---- I/O layer (network; not exercised by unit tests) --------------------

// The Dependabot alerts endpoint is CURSOR-paginated (before/after) and rejects
// `page=` outright: HTTP 400 "Pagination using the `page` parameter is not
// supported." This loop used to pass `page`, so EVERY cross-check threw on the
// first request and the audit silently degraded to tag-coverage-only — reporting
// "cross-check SKIPPED" as if it were merely offline. Follow the `Link: rel=next`
// header instead, which is the correct form for this endpoint.
async function fetchAllDependabotAlerts({ repo, token }) {
  const alerts = [];
  let url = `${API}/repos/${repo}/dependabot/alerts?per_page=100&state=all`;
  for (let hop = 0; hop < 20 && url; hop++) {
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    // 403 here is the default GITHUB_TOKEN, which cannot read Dependabot alerts —
    // name it explicitly so the remedy (set DEPENDABOT_ALERTS_TOKEN) is obvious
    // rather than looking like a generic outage.
    if (res.status === 403) {
      throw new Error(
        "GitHub API 403 reading Dependabot alerts — the default GITHUB_TOKEN cannot read this surface. " +
          "Set the SECURITY_SWEEP_APP_ID + SECURITY_SWEEP_APP_PRIVATE_KEY repository secrets (GitHub App with Dependabot alerts: read and Secret scanning alerts: read), or DEPENDABOT_ALERTS_TOKEN (fine-grained PAT with the same permissions).",
      );
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("GitHub API returned a non-array alert payload");
    alerts.push(...batch);
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return alerts;
}

function renderReport({ result, lookup, repo, scanned }) {
  const L = [];
  L.push("# DPF Stale-Override Audit");
  L.push("");
  L.push(
    `_Generated ${new Date().toISOString().slice(0, 10)} · ${scanned} overrides scanned` +
      `${repo ? ` · repo ${repo}` : ""} · ${lookup ? "cross-checked against Dependabot alerts" : "cross-check SKIPPED (offline / no token)"}._`,
  );
  L.push("");
  L.push("> Reports override floors whose justifying advisory is no longer open —");
  L.push("> prune CANDIDATES. Proposes only; verify each via the §7.1 prune screen");
  L.push("> (`pnpm regen:lockfile`) before removing. Never auto-edits overrides.");
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`- **${result.candidates.length}** prune candidate(s) — advisory resolved; re-run the prune screen.`);
  L.push(`- **${result.loadBearing.length}** load-bearing — advisory still open; keep.`);
  L.push(`- **${result.unknown.length}** indeterminate — advisory not found in alerts; needs review.`);
  L.push(`- **${result.unauditable.length}** un-auditable — security floor with no machine-readable tag; backfill the tag.`);
  L.push("");

  if (result.candidates.length) {
    L.push("## Prune candidates (advisory resolved)");
    L.push("");
    L.push("| Override | Advisory state |");
    L.push("| --- | --- |");
    for (const r of result.candidates) {
      L.push(`| \`${r.key}\` | ${r.tags.map((t) => `${t.label}: ${t.state}`).join("; ")} |`);
    }
    L.push("");
  }
  if (result.unauditable.length) {
    L.push("## Un-auditable (backfill the advisory tag)");
    L.push("");
    L.push("| Override | Kind |");
    L.push("| --- | --- |");
    for (const r of result.unauditable) L.push(`| \`${r.key}\` | ${r.reason} |`);
    L.push("");
  }
  if (result.unknown.length) {
    L.push("## Indeterminate (advisory id not found among alerts)");
    L.push("");
    L.push("| Override | Tags |");
    L.push("| --- | --- |");
    for (const r of result.unknown) {
      L.push(`| \`${r.key}\` | ${r.tags.map((t) => `${t.label}: ${t.state}`).join("; ")} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

async function run() {
  const argv = process.argv.slice(2);
  const requireOnline = argv.includes("--require-online");
  const failOnCandidates = argv.includes("--fail-on-candidates");
  const repoArg = argv.find((a) => a.startsWith("--repo="));
  const repo = repoArg ? repoArg.slice("--repo=".length) : process.env.GITHUB_REPOSITORY || "";
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

  const text = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const { entries, scanned } = parseOverrides(text);

  let lookup = null;
  if (repo && token) {
    try {
      const alerts = await fetchAllDependabotAlerts({ repo, token });
      lookup = buildAlertLookup(alerts);
    } catch (err) {
      const msg = `stale-override audit: Dependabot alerts unreachable (${err?.message || err}).`;
      if (requireOnline) {
        process.stderr.write(`::error::${msg}\n`);
        process.exit(2);
      }
      process.stdout.write(`SKIPPED cross-check: ${msg} Set GITHUB_REPOSITORY + GITHUB_TOKEN (security_events: read).\n`);
    }
  } else if (requireOnline) {
    process.stderr.write("::error::stale-override audit: --require-online set but GITHUB_REPOSITORY / GITHUB_TOKEN missing.\n");
    process.exit(2);
  } else {
    process.stdout.write("Cross-check skipped: no GITHUB_REPOSITORY + GITHUB_TOKEN. Reporting tag coverage only.\n");
  }

  const result = classifyFloors(entries, lookup);
  const report = renderReport({ result, lookup, repo, scanned });

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "stale-override-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), repo, crossChecked: Boolean(lookup), scanned, ...result }, null, 2));
  writeFileSync(join(OUT, "stale-override-audit.md"), report);

  process.stdout.write(
    [
      `Stale-override audit: ${scanned} overrides scanned.`,
      `  prune candidates: ${result.candidates.length}`,
      `  load-bearing:     ${result.loadBearing.length}`,
      `  indeterminate:    ${result.unknown.length}`,
      `  un-auditable:     ${result.unauditable.length}`,
      `Report: ${join(OUT, "stale-override-audit.md")}`,
      "",
    ].join("\n"),
  );

  if (failOnCandidates && result.candidates.length > 0) {
    process.stderr.write(`::error::${result.candidates.length} stale override floor(s) — advisory resolved, prune-screen them.\n`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  run().catch((err) => {
    process.stderr.write(`::error::audit-stale-overrides failed: ${err?.stack || err}\n`);
    process.exit(2);
  });
}

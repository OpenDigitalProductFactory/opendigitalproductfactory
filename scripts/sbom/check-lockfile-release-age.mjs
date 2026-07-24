#!/usr/bin/env node
// scripts/sbom/check-lockfile-release-age.mjs
//
// Lockfile release-age gate (BI-B175621A) — the executable half of the
// `minimumReleaseAge` policy declared in pnpm-workspace.yaml.
//
// Why a separate gate is needed
// -----------------------------
// pnpm's `minimumReleaseAge` gates RESOLUTION, not installation. Verified
// against pnpm 10.33: a `--frozen-lockfile` install prints "Lockfile is up to
// date, resolution step is skipped" and never consults the floor. Every CI job,
// Docker build, and worktree bootstrap installs frozen — so nothing downstream
// re-checks what a lockfile actually contains.
//
// That leaves one hole: a lockfile authored where the floor did not apply (an
// older checkout, a host without the setting, or an explicit
// `--config.minimumReleaseAge=0`) can carry a package published minutes ago into
// main, and every later install would faithfully reproduce it. This gate closes
// that hole by checking the committed lockfile itself.
//
// Scope: only entries NEWLY ADDED relative to the base ref. Re-auditing the whole
// lockfile would fail every PR for as long as any young package sits in it, which
// would train people to ignore the gate.
//
// Policy source: pnpm-workspace.yaml, so the floor has exactly one definition and
// the gate can never drift from what pnpm itself enforces.
//
// Usage:
//   node scripts/sbom/check-lockfile-release-age.mjs [--base origin/main]
//                                                    [--require-online]
//                                                    [--json <path>]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/$/, "");

// ── pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Read the release-age policy from pnpm-workspace.yaml.
 * Returns { minutes, exclude:Set<string> }. minutes === 0 means "no floor".
 */
export function parseReleaseAgePolicy(workspaceYaml) {
  const lines = workspaceYaml.replace(/\r\n/g, "\n").split("\n");
  let minutes = 0;
  const exclude = new Set();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^minimumReleaseAge:\s*(\d+)\s*$/);
    if (m) minutes = Number(m[1]);

    if (/^minimumReleaseAgeExclude:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\S/.test(lines[j])) break; // next top-level key
        const item = lines[j].match(/^\s+-\s*'?([^'\s]+)'?\s*$/);
        if (item) exclude.add(item[1]);
      }
    }
    // inline form: minimumReleaseAgeExclude: ['a', 'b']
    const inline = lines[i].match(/^minimumReleaseAgeExclude:\s*\[(.*)\]\s*$/);
    if (inline) {
      for (const raw of inline[1].split(",")) {
        const name = raw.trim().replace(/^['"]|['"]$/g, "");
        if (name) exclude.add(name);
      }
    }
  }
  return { minutes, exclude };
}

/**
 * Collect `name@version` keys from a pnpm lockfile's top-level `packages:` map.
 * `packages:` holds clean name@version keys; `snapshots:` holds the same
 * packages with peer-suffixed keys, so reading `packages:` alone is both
 * sufficient and unambiguous.
 */
export function parseLockfilePackages(lockYaml) {
  const lines = lockYaml.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("packages:");
  if (start < 0) return new Set();
  const out = new Set();
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // next top-level key
    const m = lines[i].match(/^ {2}'?(.+?)'?:\s*$/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Split `@scope/name@1.2.3` → { name, version }. Null for non-registry specs. */
export function splitNameVersion(key) {
  const at = key.lastIndexOf("@");
  if (at <= 0) return null;
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  if (!name || !version) return null;
  // file:/link:/http: specs and git URLs are not registry releases — the floor
  // does not apply and the registry has no publish time for them.
  if (version.includes(":") || version.includes("/")) return null;
  return { name, version };
}

/** Entries present in head but not in base, as {key,name,version}. */
export function newRegistryEntries(baseKeys, headKeys) {
  const out = [];
  for (const key of headKeys) {
    if (baseKeys.has(key)) continue;
    const nv = splitNameVersion(key);
    if (nv) out.push({ key, ...nv });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Split entries into violations / ok / unknown given publish timestamps.
 * `publishedAt` is a Map<"name@version", ISO string | null>.
 */
export function classifyAges(entries, publishedAt, { minutes, exclude, now }) {
  const violations = [];
  const ok = [];
  const unknown = [];
  const floorMs = minutes * 60_000;

  for (const e of entries) {
    if (exclude.has(e.name)) {
      ok.push({ ...e, reason: "excluded" });
      continue;
    }
    const iso = publishedAt.get(e.key);
    if (!iso) {
      unknown.push(e);
      continue;
    }
    const ageMs = now.getTime() - new Date(iso).getTime();
    const ageMinutes = Math.floor(ageMs / 60_000);
    if (ageMs < floorMs) violations.push({ ...e, publishedAt: iso, ageMinutes });
    else ok.push({ ...e, publishedAt: iso, ageMinutes });
  }
  return { violations, ok, unknown };
}

// ── I/O ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { base: "origin/main", requireOnline: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") out.base = argv[++i];
    else if (argv[i] === "--require-online") out.requireOnline = true;
    else if (argv[i] === "--json") out.json = argv[++i];
  }
  return out;
}

function baseLockfile(baseRef) {
  try {
    return execFileSync("git", ["show", `${baseRef}:pnpm-lock.yaml`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
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
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function fetchPublishTimes(entries) {
  const byName = new Map();
  for (const e of entries) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
  }
  const publishedAt = new Map();
  let online = false;

  await mapPool([...byName.keys()], 8, async (name) => {
    try {
      const doc = await getJson(`${REGISTRY}/${name.replace(/\//g, "%2f")}`);
      online = true;
      for (const e of byName.get(name)) {
        publishedAt.set(e.key, doc?.time?.[e.version] ?? null);
      }
    } catch {
      for (const e of byName.get(name)) publishedAt.set(e.key, null);
    }
  });

  return { publishedAt, online };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceYaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const { minutes, exclude } = parseReleaseAgePolicy(workspaceYaml);

  if (minutes <= 0) {
    // A gate that silently passes when its policy is missing is worse than no
    // gate — it reports "safe" while enforcing nothing.
    process.stderr.write(
      "::error::minimumReleaseAge is not set in pnpm-workspace.yaml — the release-age policy is missing, so this gate cannot enforce anything.\n",
    );
    process.exit(1);
  }

  const headKeys = parseLockfilePackages(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"));
  const baseYaml = baseLockfile(args.base);
  if (baseYaml === null) {
    process.stdout.write(
      `Release-age gate: base ref '${args.base}' unavailable (shallow clone or first commit) — nothing to diff, skipping.\n`,
    );
    process.exit(0);
  }

  const entries = newRegistryEntries(parseLockfilePackages(baseYaml), headKeys);
  if (entries.length === 0) {
    process.stdout.write(`Release-age gate: no new lockfile entries vs ${args.base}. Floor ${minutes} min.\n`);
    process.exit(0);
  }

  const { publishedAt, online } = await fetchPublishTimes(entries);
  if (!online) {
    const msg = `Release-age gate: registry unreachable; could not verify ${entries.length} new entries.`;
    if (args.requireOnline) {
      process.stderr.write(`::error::${msg} (--require-online)\n`);
      process.exit(1);
    }
    process.stdout.write(`${msg} Tolerating (no --require-online).\n`);
    process.exit(0);
  }

  const { violations, ok, unknown } = classifyAges(entries, publishedAt, {
    minutes,
    exclude,
    now: new Date(),
  });

  if (args.json) {
    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(
      args.json,
      JSON.stringify({ base: args.base, floorMinutes: minutes, violations, ok, unknown }, null, 2),
    );
  }

  for (const u of unknown) {
    process.stdout.write(`  ? ${u.key} — no publish time from registry (unpublished or mirror gap)\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `::error::${violations.length} new lockfile entr${violations.length === 1 ? "y is" : "ies are"} younger than the ${minutes}-minute release-age floor:\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  - ${v.key} published ${v.ageMinutes} min ago (${v.publishedAt})\n`);
    }
    process.stderr.write(
      "\nWait for the floor to elapse and regenerate the lockfile, or — if this is an embargoed\n" +
        "security fix that must land now — add the package to minimumReleaseAgeExclude in\n" +
        "pnpm-workspace.yaml with a comment saying why.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `Release-age gate: ${ok.length} new entr${ok.length === 1 ? "y" : "ies"} all older than the ${minutes}-minute floor` +
      `${unknown.length ? `, ${unknown.length} unverifiable` : ""}.\n`,
  );
}

// Only run when invoked directly, so the pure helpers stay importable in tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((err) => {
    process.stderr.write(`::error::check-lockfile-release-age failed: ${err?.stack || err}\n`);
    process.exit(2);
  });
}

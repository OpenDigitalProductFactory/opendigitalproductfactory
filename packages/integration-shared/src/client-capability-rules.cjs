"use strict";
// BI-64795FD0. Pure rules over the client capability profile
// (packages/dpf-skill-pack/client-capabilities.json). Dependency-free CommonJS
// so the profile generator (plain node) and the TypeScript policy share one
// rule. Types live in client-capability-rules.d.cts.
//
// The profile is passed in, never read here: the generator passes the JSON it
// is generating from, and the policy passes the generated copy.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True only for a capability the profile states as present and not unproven. */
function capabilityPresent(field) {
  return Boolean(field) && field.value === true && field.status !== "unproven";
}

/** The profile row whose credential-policy key is `policyClient`, or null. */
function rowForPolicyClient(profile, policyClient) {
  for (const row of Object.values(profile.clients)) {
    if (row.policyClient === policyClient) return row;
  }
  return null;
}

/**
 * Whether a client config for `endpoint` must carry the bearer-header fallback.
 * OAuth is used only where the profile states the client can complete it on
 * that transport. Anything else, including an unknown client, keeps the bearer.
 */
function bearerHeaderRequiredFor(profile, endpoint, policyClient, authMode) {
  if (authMode === "legacy") return true;
  const row = rowForPolicyClient(profile, policyClient);
  if (!row) return true;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return true;
  }
  if (parsed.username || parsed.password) return true;
  if (parsed.protocol === "https:") return !capabilityPresent(row.capabilities.oauthHttps);
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return !capabilityPresent(row.capabilities.oauthLoopbackHttp);
  }
  return true;
}

const VERSION_RE = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const numA = /^\d+$/.test(a[index]) ? Number(a[index]) : null;
    const numB = /^\d+$/.test(b[index]) ? Number(b[index]) : null;
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    } else if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two client version strings (semver-like, any number of numeric parts,
 * an optional pre-release). Negative, zero or positive; null when either is not
 * a version, because an unreadable string is neither newer nor older.
 */
function compareClientVersions(left, right) {
  const a = VERSION_RE.exec(String(left ?? "").trim());
  const b = VERSION_RE.exec(String(right ?? "").trim());
  if (!a || !b) return null;
  const partsA = a[1].split(".").map(Number);
  const partsB = b[1].split(".").map(Number);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return comparePrerelease(a[2] ?? null, b[2] ?? null);
}

/**
 * True when `version` is newer than what the row was verified on, or the row
 * was never verified on any version. An unreadable version is not flagged.
 */
function clientVersionUnverified(row, version) {
  if (!row || typeof version !== "string" || !version.trim()) return false;
  if (!row.verifiedVersion) return VERSION_RE.test(version.trim());
  const order = compareClientVersions(version, row.verifiedVersion);
  return order !== null && order > 0;
}

const VERSION_TOKEN_RE = /\bv?(\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?)/;

/**
 * The version inside a CLI's `--version` line, e.g. "2.1.295" from
 * "2.1.295 (Claude Code)" or "0.142.5" from "codex-cli 0.142.5"; null when none.
 */
function extractClientVersion(text) {
  if (typeof text !== "string") return null;
  const match = VERSION_TOKEN_RE.exec(text);
  return match ? match[1].replace(/[.-]+$/, "") : null;
}

module.exports = {
  extractClientVersion,
  bearerHeaderRequiredFor,
  capabilityPresent,
  clientVersionUnverified,
  compareClientVersions,
  rowForPolicyClient,
};

// Pure, prisma-free patch-intelligence core.
//
// Shared brain for the two read-only P0 legs of estate patch management:
//   - the version-intelligence feed (resolves "latest safe version" + advisories), and
//   - the assessment projector (writes AssuranceFinding rows).
//
// Everything here is a pure function of its inputs so it is fully unit-testable
// without a database, an Edge Node, or a network call. It mirrors the prisma-free
// pure-logic pattern already used by self-upgrade/windows-eval.ts and auto-window.ts.
//
// Design notes:
//   - Advisory-first classification: a host that is "version current" can still be
//     vulnerable, and a host on an unparseable distro version (e.g. "1:2.30-1ubuntu2")
//     can still carry a CVE. So advisories drive the verdict before version math.
//   - CISA KEV (Known Exploited Vulnerabilities) is a routing/severity multiplier, not
//     a separate finding kind — an exploited CVE is still a vulnerability, just an urgent one.
//   - Version comparison returns "unknown" rather than guessing when a string is not
//     semver-shaped; the verdict then leans on advisories and the native "available" signal.

export type VersionComparison = "behind" | "current" | "ahead" | "unknown";

export type PatchFindingKind = "patch-gap" | "vulnerability" | "end-of-life" | "none";

export type PatchSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ApplyVia =
  | "winget"
  | "wua"
  | "apt"
  | "dnf"
  | "brew"
  | "manual"
  | "vendor-adapter"
  | "unknown";

export type PatchConfidence = "unverified" | "inferred" | "verified" | "vendor-confirmed";

export interface AdvisoryInput {
  /** CVE / GHSA / OSV / vendor-advisory id. */
  id: string;
  /** Source severity if the feed provided one. */
  severity?: PatchSeverity | null;
  /** Lowest version that resolves this advisory, if known. */
  fixedVersion?: string | null;
  /** Whether this CVE is in the CISA Known Exploited Vulnerabilities catalog. */
  cisaKev?: boolean | null;
  /** Source adapter that produced the advisory, e.g. osv or nvd. */
  source?: string | null;
  /** How this advisory should appear in patch posture. Defaults to vulnerability. */
  findingKind?: Extract<PatchFindingKind, "patch-gap" | "vulnerability"> | null;
}

export interface PatchAssessmentInput {
  installedVersion?: string | null;
  /** Latest version on the tracked channel, ignoring vulnerability state. */
  latestStableVersion?: string | null;
  /** Latest version with no known open advisories (preferred patch target). */
  latestSafeVersion?: string | null;
  /** Advisories believed to affect the installed version. */
  advisories?: AdvisoryInput[] | null;
  /** End-of-life / end-of-support date for the installed line. */
  eolDate?: string | Date | null;
  /** Injected for determinism; defaults to current time in app code. */
  now?: Date;
  defaultApplyVia?: ApplyVia | null;
  rebootLikely?: boolean | null;
  /** How trustworthy the catalog identity + version match is. */
  confidence?: PatchConfidence | null;
}

export interface RemediationHint {
  targetVersion: string | null;
  applyVia: ApplyVia;
  rebootLikely: boolean;
  cisaKev: boolean;
  confidence: PatchConfidence;
}

export interface PatchAssessment {
  findingKind: PatchFindingKind;
  policySeverity: PatchSeverity;
  versionComparison: VersionComparison;
  /** Highest-priority advisory id, surfaced as AssuranceFinding.vendorIdentifier. */
  primaryAdvisoryId: string | null;
  /** Source of the primary advisory, surfaced as the patch adapter key. */
  primaryAdvisorySource: string | null;
  /** True if any affecting advisory is in the CISA KEV catalog. */
  cisaKev: boolean;
  remediationHint: RemediationHint;
  /** Plain-language reason, safe to show a non-technical operator. */
  rationale: string;
}

interface ParsedVersion {
  release: number[];
  prerelease: Array<string | number>;
}

const SEVERITY_RANK: Record<PatchSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_BY_RANK: PatchSeverity[] = ["info", "low", "medium", "high", "critical"];

/**
 * Parse a semver-ish version into comparable parts, or return null when the string
 * is not numeric-dotted (common for OS package versions, which we then treat as
 * incomparable rather than guess).
 */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  // Strip a leading "v" (v1.2.3) and any build metadata (1.2.3+build).
  if (v[0] === "v" || v[0] === "V") v = v.slice(1);
  const plus = v.indexOf("+");
  if (plus !== -1) v = v.slice(0, plus);

  const dash = v.indexOf("-");
  const corePart = dash === -1 ? v : v.slice(0, dash);
  const prePart = dash === -1 ? "" : v.slice(dash + 1);

  const coreSegments = corePart.split(".");
  const release: number[] = [];
  for (const seg of coreSegments) {
    if (seg === "" || !/^\d+$/.test(seg)) return null;
    release.push(Number(seg));
  }
  if (release.length === 0) return null;

  const prerelease: Array<string | number> = [];
  if (prePart) {
    for (const id of prePart.split(".")) {
      if (id === "") return null;
      prerelease.push(/^\d+$/.test(id) ? Number(id) : id);
    }
  }
  return { release, prerelease };
}

function compareReleaseArrays(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

function comparePrerelease(a: Array<string | number>, b: Array<string | number>): number {
  // Per semver: a version WITH prerelease has lower precedence than one without.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a is the release, b is a prerelease -> a is higher
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1; // shorter set of identifiers is lower
    if (bv === undefined) return 1;
    const aNum = typeof av === "number";
    const bNum = typeof bv === "number";
    if (aNum && bNum) {
      if (av !== bv) return (av as number) < (bv as number) ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers are lower than alphanumeric
    } else if (av !== bv) {
      return (av as string) < (bv as string) ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare the installed version against an available version.
 * Returns "unknown" when either side is not a parseable semver-ish string.
 */
export function compareVersions(
  installed: string | null | undefined,
  available: string | null | undefined,
): VersionComparison {
  const a = parseVersion(installed);
  const b = parseVersion(available);
  if (!a || !b) return "unknown";
  const rel = compareReleaseArrays(a.release, b.release);
  const cmp = rel !== 0 ? rel : comparePrerelease(a.prerelease, b.prerelease);
  if (cmp === 0) return "current";
  return cmp < 0 ? "behind" : "ahead";
}

function maxSeverity(values: Array<PatchSeverity | null | undefined>): PatchSeverity | null {
  let best = -1;
  for (const v of values) {
    if (v && SEVERITY_RANK[v] > best) best = SEVERITY_RANK[v];
  }
  return best === -1 ? null : SEVERITY_BY_RANK[best];
}

function atLeast(sev: PatchSeverity, floor: PatchSeverity): PatchSeverity {
  return SEVERITY_RANK[sev] >= SEVERITY_RANK[floor] ? sev : floor;
}

function isEol(eolDate: string | Date | null | undefined, now: Date): boolean {
  if (!eolDate) return false;
  const d = eolDate instanceof Date ? eolDate : new Date(eolDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= now.getTime();
}

/**
 * Among advisories that still affect the installed version, pick the one that should
 * drive routing: CISA KEV first, then highest severity, then the one with a known fix.
 * An advisory is "open" if no fixedVersion is given, or the installed version is still
 * below the fix.
 */
function openAdvisories(input: PatchAssessmentInput): AdvisoryInput[] {
  const advisories = input.advisories ?? [];
  return advisories.filter((adv) => {
    if (!adv.fixedVersion) return true; // no known fix -> treat as open
    const cmp = compareVersions(input.installedVersion, adv.fixedVersion);
    // installed is "behind" the fix -> still vulnerable; "unknown" -> keep (be conservative).
    return cmp === "behind" || cmp === "unknown";
  });
}

function pickPrimaryAdvisory(advisories: AdvisoryInput[]): AdvisoryInput | null {
  if (advisories.length === 0) return null;
  return [...advisories].sort((x, y) => {
    const kev = Number(Boolean(y.cisaKev)) - Number(Boolean(x.cisaKev));
    if (kev !== 0) return kev;
    const sev = (y.severity ? SEVERITY_RANK[y.severity] : -1) - (x.severity ? SEVERITY_RANK[x.severity] : -1);
    if (sev !== 0) return sev;
    return Number(Boolean(y.fixedVersion)) - Number(Boolean(x.fixedVersion));
  })[0];
}

/**
 * Classify a single (host, software) pair into a patch verdict. Pure and deterministic.
 *
 * Precedence: open vulnerabilities -> end-of-life -> behind-on-version -> none.
 * CISA KEV membership escalates severity and is always surfaced on the hint.
 */
export function assessPatchState(input: PatchAssessmentInput): PatchAssessment {
  const now = input.now ?? new Date();
  const applyVia: ApplyVia = input.defaultApplyVia ?? "unknown";
  const confidence: PatchConfidence = input.confidence ?? "unverified";
  const rebootLikely = Boolean(input.rebootLikely);

  const versionComparison = compareVersions(
    input.installedVersion,
    input.latestSafeVersion ?? input.latestStableVersion,
  );

  const open = openAdvisories(input);
  const anyKev = open.some((a) => Boolean(a.cisaKev));

  const baseHint = (targetVersion: string | null): RemediationHint => ({
    targetVersion,
    applyVia,
    rebootLikely,
    cisaKev: anyKev,
    confidence,
  });

  // 1) Open vulnerabilities win — even when version math is "current" or "unknown".
  if (open.length > 0) {
    const primary = pickPrimaryAdvisory(open);
    const target =
      primary?.fixedVersion ?? input.latestSafeVersion ?? input.latestStableVersion ?? null;
    let severity = maxSeverity(open.map((a) => a.severity)) ?? "high";
    if (anyKev) severity = atLeast(severity, "high"); // exploited-in-the-wild is never below high
    const findingKind = primary?.findingKind ?? "vulnerability";
    return {
      findingKind,
      policySeverity: severity,
      versionComparison,
      primaryAdvisoryId: primary?.id ?? null,
      primaryAdvisorySource: primary?.source ?? null,
      cisaKev: anyKev,
      remediationHint: baseHint(target),
      rationale: anyKev
        ? `Affected by ${open.length} advisory(ies) including a CISA KEV (actively exploited): ${primary?.id ?? "unknown"}.`
        : `Affected by ${open.length} known advisory(ies); highest severity ${severity}.`,
    };
  }

  // 2) End-of-life software is a standing risk even with no open CVE today.
  if (isEol(input.eolDate, now)) {
    return {
      findingKind: "end-of-life",
      policySeverity: "high",
      versionComparison,
      primaryAdvisoryId: null,
      primaryAdvisorySource: null,
      cisaKev: false,
      remediationHint: baseHint(input.latestStableVersion ?? null),
      rationale: "Installed version is past its end-of-life / end-of-support date.",
    };
  }

  // 3) Behind on version but no known vulnerability -> hygiene gap.
  if (versionComparison === "behind") {
    const behindSafe =
      input.latestSafeVersion != null &&
      compareVersions(input.installedVersion, input.latestSafeVersion) === "behind";
    return {
      findingKind: "patch-gap",
      policySeverity: behindSafe ? "medium" : "low",
      versionComparison,
      primaryAdvisoryId: null,
      primaryAdvisorySource: null,
      cisaKev: false,
      remediationHint: baseHint(input.latestSafeVersion ?? input.latestStableVersion ?? null),
      rationale: `A newer version is available (${input.latestSafeVersion ?? input.latestStableVersion}).`,
    };
  }

  // 4) Nothing to do (current/ahead/unknown with no advisories or EOL).
  return {
    findingKind: "none",
    policySeverity: "info",
    versionComparison,
    primaryAdvisoryId: null,
    primaryAdvisorySource: null,
    cisaKev: false,
    remediationHint: baseHint(null),
    rationale:
      versionComparison === "unknown"
        ? "No advisories known and version could not be compared; no action inferred."
        : "Up to date with no known advisories.",
  };
}

/**
 * Whether an assessment represents real work (a finding the assessment surface should show).
 */
export function isActionable(assessment: PatchAssessment): boolean {
  return assessment.findingKind !== "none";
}

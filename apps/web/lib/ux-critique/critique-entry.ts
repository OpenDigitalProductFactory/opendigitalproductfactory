// UX critique corpus — the typed entry shape and the calibration-eligibility
// rule (EP-UX-SYSTEM L6, BI-3880DA1D).
//
// The corpus is not a new store. A critique entry is a craft-override WikiPage
// under `craft/ux-design/<slug>` (see lib/wiki/craft-override.ts) carrying its
// structured fields in WikiPage.metadata — the same free-form bag the WSID
// variant axes already use. Org-scoped, revisioned, and surfaced on the craft
// surface for free. This module owns the SHAPE and the RULE; persistence stays
// with the existing wiki store.
//
// Why this module exists at all: the corpus method page states that entries are
// founder-authored and that an agent may draft but never attach a verdict. A
// documented contract that nothing enforces is the attestation theater this
// whole program exists to end (spec §2). So the contract is code here, and the
// calibration set is *derived* rather than curated by hand — there is no path
// that returns an agent-authored verdict as calibration data.
//
// Pure: no prisma, no fs, no clock. Importable from tests, MCP tools, and the
// craft surface alike.

/** What the reviewer actually decided about the screen. */
export const CRITIQUE_VERDICTS = [
  /** The finding is real and the screen should change. */
  "change-needed",
  /** Looked at it; it is fine as-is. Negative entries are calibration data too. */
  "no-change-needed",
  /** Real, but deliberately not now — records the judgment without implying a fix. */
  "accepted-debt",
] as const;
export type CritiqueVerdict = (typeof CRITIQUE_VERDICTS)[number];

/**
 * Who attached the verdict. Only `founder` and `designer` are ATTACHING
 * authorities. `agent-proposed` exists so a draft can carry a suggested verdict
 * without that suggestion ever counting as calibration — the distinction the
 * corpus depends on. Basis: six researchers ranking UI preference pairs showed
 * very low agreement with expert designers, so "a careful human looked at it"
 * is not the qualification; being the design authority for this product is.
 */
export const VERDICT_AUTHORITIES = ["founder", "designer", "agent-proposed"] as const;
export type VerdictAuthority = (typeof VERDICT_AUTHORITIES)[number];

const ATTACHING_AUTHORITIES: readonly VerdictAuthority[] = ["founder", "designer"];

/** The lenses a finding can be argued under. Evidence first; the lens explains why. */
export const CRITIQUE_LENSES = [
  "hierarchy",
  "density",
  "hick",
  "fitts",
  "miller",
  "doherty",
] as const;
export type CritiqueLens = (typeof CRITIQUE_LENSES)[number];

export type CritiqueEntry = {
  /** Route the screen was captured from, e.g. "/workspace". */
  route: string;
  /**
   * Reference to the captured image. A critique of a screen nobody can look at
   * again is not reviewable, so this is required for eligibility.
   */
  screenshotRef: string | null;
  /** Viewport width in CSS px at capture (390 = mobile band, 1280 = desktop). */
  viewportWidth: number | null;
  colorScheme: "light" | "dark" | null;
  /**
   * The commit the screen was rendered at. Without it a before/after pair
   * cannot be reconstructed later, which is how the EP-UX-COGLOAD findings
   * became text-only in the first place.
   */
  gitRef: string | null;
  /** What is wrong, specifically. "Feels heavy" is not an entry. */
  finding: string;
  lenses: readonly CritiqueLens[];
  verdict: CritiqueVerdict | null;
  verdictAuthority: VerdictAuthority | null;
  /** Mirrors the WikiPage row status; agent drafts land as "draft". */
  status: "draft" | "published";
};

/**
 * The MediaAttachment role that anchors a critique's screenshot to its
 * WikiPage. The screenshot lives in the shared content-addressed MediaAsset
 * store (durable, deduped — a before/after pair of identical bytes collapses to
 * one blob), and this attachment is both the durability anchor and the scope
 * the authenticated serve route checks. Storage decision: kernel DI-D80467D6B45B.
 */
export const CRITIQUE_SCREENSHOT_ROLE = "critique-screenshot";

/**
 * The retrieval URL a critique's `screenshotRef` points at. Deliberately NOT
 * the public `/api/media/:id` — a critique captures internal product surfaces
 * (/admin, live workspace data) that must not be servable to an unauthenticated
 * party by capability URL, so this route is session-gated and org-scoped.
 */
export function critiqueScreenshotUrl(assetId: string): string {
  return `/api/critique-media/${assetId}`;
}

const MIN_FINDING_CHARS = 24;

export type CritiqueEntryValidation =
  | { ok: true; entry: CritiqueEntry }
  | { ok: false; error: string };

/**
 * Shape validation only. A VALID entry is not necessarily a CALIBRATION-ELIGIBLE
 * one — that is `isCalibrationEligible`, and keeping them separate is deliberate:
 * drafts must be storable so the founder has something to react to, while never
 * being mistakable for calibration data.
 */
export function validateCritiqueEntry(input: Partial<CritiqueEntry>): CritiqueEntryValidation {
  const route = input.route?.trim() ?? "";
  const finding = input.finding?.trim() ?? "";

  if (!route.startsWith("/")) {
    return { ok: false, error: "A critique entry needs the route it was captured from." };
  }
  if (finding.length < MIN_FINDING_CHARS) {
    return {
      ok: false,
      error:
        "Say what is specifically wrong — a measurement or a structural observation, not an impression.",
    };
  }
  if (input.verdict && !CRITIQUE_VERDICTS.includes(input.verdict)) {
    return { ok: false, error: `Unknown verdict "${input.verdict}".` };
  }
  if (input.verdictAuthority && !VERDICT_AUTHORITIES.includes(input.verdictAuthority)) {
    return { ok: false, error: `Unknown verdict authority "${input.verdictAuthority}".` };
  }
  if (input.verdict && !input.verdictAuthority) {
    return { ok: false, error: "A verdict must record who attached it." };
  }
  for (const lens of input.lenses ?? []) {
    if (!CRITIQUE_LENSES.includes(lens)) {
      return { ok: false, error: `Unknown lens "${lens}".` };
    }
  }

  return {
    ok: true,
    entry: {
      route,
      screenshotRef: input.screenshotRef?.trim() || null,
      viewportWidth: input.viewportWidth ?? null,
      colorScheme: input.colorScheme ?? null,
      gitRef: input.gitRef?.trim() || null,
      finding,
      lenses: input.lenses ?? [],
      verdict: input.verdict ?? null,
      verdictAuthority: input.verdictAuthority ?? null,
      status: input.status ?? "draft",
    },
  };
}

/**
 * Schema tag stamped into WikiPage.metadata so a critique-entry overlay page is
 * distinguishable from any other craft-override page, and so a future reader can
 * refuse a payload it does not understand rather than mis-parsing one.
 */
export const CRITIQUE_ENTRY_METADATA_KIND = "ux-critique-entry.v1";

/**
 * The structured critique fields, as they live in the WikiPage.metadata Json bag
 * (the same free-form column the WSID variant axes already use). `finding` and
 * `status` are NOT carried here — the page body IS the finding and the row
 * status IS the entry status, so duplicating them into metadata would invite the
 * two copies to drift. Everything else has no home on the page and lives here.
 */
export type CritiqueEntryMetadata = {
  metadataKind: typeof CRITIQUE_ENTRY_METADATA_KIND;
  route: string;
  screenshotRef: string | null;
  viewportWidth: number | null;
  colorScheme: "light" | "dark" | null;
  gitRef: string | null;
  lenses: CritiqueLens[];
  verdict: CritiqueVerdict | null;
  verdictAuthority: VerdictAuthority | null;
};

/** Project the metadata-resident fields of a validated entry for storage. */
export function critiqueEntryToMetadata(entry: CritiqueEntry): CritiqueEntryMetadata {
  return {
    metadataKind: CRITIQUE_ENTRY_METADATA_KIND,
    route: entry.route,
    screenshotRef: entry.screenshotRef,
    viewportWidth: entry.viewportWidth,
    colorScheme: entry.colorScheme,
    gitRef: entry.gitRef,
    lenses: [...entry.lenses],
    verdict: entry.verdict,
    verdictAuthority: entry.verdictAuthority,
  };
}

/**
 * Reassemble a CritiqueEntry from a stored WikiPage row. `finding` and `status`
 * come from the row (body + status), the rest from the metadata bag. Returns
 * null when the metadata is absent, the wrong kind, or malformed — a page that
 * cannot be understood is not silently treated as an empty critique, it is
 * simply not one.
 */
export function critiqueEntryFromWikiPage(page: {
  body: string;
  status: string;
  metadata: unknown;
}): CritiqueEntry | null {
  const meta = page.metadata;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  if (m.metadataKind !== CRITIQUE_ENTRY_METADATA_KIND) return null;

  const validated = validateCritiqueEntry({
    route: typeof m.route === "string" ? m.route : undefined,
    finding: page.body,
    screenshotRef: typeof m.screenshotRef === "string" ? m.screenshotRef : null,
    viewportWidth: typeof m.viewportWidth === "number" ? m.viewportWidth : null,
    colorScheme: m.colorScheme === "light" || m.colorScheme === "dark" ? m.colorScheme : null,
    gitRef: typeof m.gitRef === "string" ? m.gitRef : null,
    lenses: Array.isArray(m.lenses) ? (m.lenses as CritiqueLens[]) : [],
    verdict: (m.verdict ?? null) as CritiqueVerdict | null,
    verdictAuthority: (m.verdictAuthority ?? null) as VerdictAuthority | null,
    status: page.status === "published" ? "published" : "draft",
  });
  return validated.ok ? validated.entry : null;
}

/**
 * The authority contract, mechanically. An entry counts as calibration data only
 * when a human design authority has ruled on a screen someone can look at again.
 *
 * Each clause earns its place:
 * - published    — a draft is a proposal, whatever it contains.
 * - verdict      — "no verdict yet" is the corpus's work queue, not its content.
 * - attaching authority — an agent-proposed verdict never promotes itself. A
 *   judge calibrated on agent-authored entries is calibrated against itself and
 *   would report rising agreement while measuring nothing.
 * - screenshotRef — an unreviewable claim cannot be re-judged, so it cannot
 *   settle a disagreement later.
 */
export function isCalibrationEligible(entry: CritiqueEntry): boolean {
  return (
    entry.status === "published" &&
    entry.verdict !== null &&
    entry.verdictAuthority !== null &&
    ATTACHING_AUTHORITIES.includes(entry.verdictAuthority) &&
    entry.screenshotRef !== null
  );
}

/** The calibration set is derived, never hand-curated. */
export function calibrationSet(entries: readonly CritiqueEntry[]): CritiqueEntry[] {
  return entries.filter(isCalibrationEligible);
}

/**
 * Entries that need a founder verdict — the corpus's work queue, and the single
 * most useful recurring task the curation role performs.
 */
export function awaitingVerdict(entries: readonly CritiqueEntry[]): CritiqueEntry[] {
  return entries.filter(
    (e) =>
      !isCalibrationEligible(e) &&
      (e.verdict === null || !ATTACHING_AUTHORITIES.includes(e.verdictAuthority as VerdictAuthority)),
  );
}

/**
 * Deterministic hash over the entry's identity. Same entry → same bucket on
 * every run, so the held-out slice below is stable across processes and machines
 * without storing a split or seeding a RNG.
 */
function stableBucket(entry: CritiqueEntry, buckets: number): number {
  const key = `${entry.route}|${entry.gitRef ?? ""}|${entry.finding}`;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash % buckets;
}

export type CalibrationSplit = {
  /** Entries the judge may be grounded in. */
  grounding: CritiqueEntry[];
  /** Entries reserved for measuring agreement — never used for grounding. */
  heldOut: CritiqueEntry[];
};

/**
 * Split the calibration set into grounding and held-out halves.
 *
 * The calibration gate promotes a critique's authority on "measured agreement
 * against a held-out slice." Held-out has to mean never-grounded-in, or the
 * measurement is a memory test that passes trivially. Deterministic bucketing
 * makes that property checkable rather than promised: the same entry lands in
 * the same half on every run, so grounding cannot quietly leak across.
 *
 * @param heldOutPercent share reserved for measurement (default 30%).
 */
export function splitForCalibration(
  entries: readonly CritiqueEntry[],
  heldOutPercent = 30,
): CalibrationSplit {
  const eligible = calibrationSet(entries);
  const grounding: CritiqueEntry[] = [];
  const heldOut: CritiqueEntry[] = [];
  for (const entry of eligible) {
    if (stableBucket(entry, 100) < heldOutPercent) heldOut.push(entry);
    else grounding.push(entry);
  }
  return { grounding, heldOut };
}

/** Coverage by route — the exit condition is breadth, not a row count. */
export function routeCoverage(entries: readonly CritiqueEntry[]): Map<string, number> {
  const coverage = new Map<string, number>();
  for (const entry of calibrationSet(entries)) {
    coverage.set(entry.route, (coverage.get(entry.route) ?? 0) + 1);
  }
  return coverage;
}

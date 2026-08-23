// apps/web/lib/ux-budget/ratchet.ts
//
// The wall-of-text gate — EP-UX-SYSTEM spec §6 L4 (BI-BD81682A), incorporating rev 2
// decisions D1 (net-new absolutes) and D2 (structural hierarchy snapshot).
//
// This is the module that answers "every iteration adds more wall of text". It is pure
// and DOM-free on purpose: the Playwright driver (scripts/ux-route-sweep.ts) does the
// measuring, this decides the verdict, and the verdict logic is unit-testable without a
// browser, a database or a build.
//
// THREE ENFORCEMENT MODES, by route:
//
//   1. PRE-EXISTING route  → REGRESSION RATCHET, blocking. A changed route may not
//      exceed its own frozen baseline on any axis. No calibration needed: adding 400
//      words to a cockpit is a regression regardless of where the "right" number sits.
//      Its absolute budgets stay advisory (the §8 flip contract governs retrofit).
//   2. NET-NEW route → ABSOLUTE BUDGETS, blocking (rev 2 D1). A pure ratchet freezes
//      whatever ships first, so without this a brand-new route becomes its own baseline
//      and can be born as a wall of text without ever failing. New code has no legacy
//      excuse.
//   3. STRUCTURE → the ARIA snapshot must not drift (rev 2 D2). Hierarchy is the
//      dominant AI failure mode per the cited research and was previously unmeasured;
//      the snapshot is deterministic and diffable, so it ratchets like the numbers do.
//
// BOOTSTRAP HONESTY: a ratchet needs a baseline, and the baseline can only come from
// measuring a running portal (spec §7.1 step 1 — the league table precedes migration).
// Until that measured baseline is committed, `bootstrapped` is false and the sweep
// REPORTS without blocking. That is a single mechanical step, not a calibration debate
// or an open-ended "advisory for now" hedge — and while it is false the sweep says so
// loudly rather than passing quietly.

import { evaluateUxBudget, type BudgetFinding, type RouteStatus } from "./evaluate";
import type { UxBudgetMetrics } from "./measure";
import type { UxShell } from "./budgets";
import type { ExemptCheck } from "./route-shells";
import type { RouteAudience } from "../navigation/route-audience";

/** What the sweep measured for one route. */
export type RouteMeasurement = {
  routePath: string;
  shell: UxShell;
  metrics: UxBudgetMetrics;
  /** YAML accessibility-tree projection (roles, heading levels, names). */
  ariaSnapshot: string;
  /** Serious/critical axe violations. Necessary, never sufficient. */
  axeViolations: number;
  exemptChecks?: readonly ExemptCheck[];
  /** Route audience — sets the reading tier for operator surfaces (BI-1DE6F69E). */
  audience?: RouteAudience;
};

/** The frozen per-route baseline a changed route is measured against. */
export type RouteBaseline = {
  defaultVisibleWords: number;
  leadBandWords: number;
  primaryActions: number;
  visibleFields: number;
  maxChoicesPerControl: number;
  subLegibleControls: number;
  buriedPrimaryAction: number;
  axeViolations: number;
  ariaSnapshot: string;
};

export type BaselineFile = {
  /** False until a measured baseline has been committed; the sweep reports only. */
  bootstrapped: boolean;
  generator: string;
  routes: Record<string, RouteBaseline>;
};

/** Ordered for a readable report. Each axis declares how regression is detected. */
export const RATCHET_AXES = [
  "defaultVisibleWords",
  "leadBandWords",
  "primaryActions",
  "visibleFields",
  "maxChoicesPerControl",
  "subLegibleControls",
  "buriedPrimaryAction",
  "axeViolations",
] as const;
export type RatchetAxis = (typeof RATCHET_AXES)[number];

type RatchetAxisPolarity = "max" | "presence";

const RATCHET_AXIS_POLARITY: Record<RatchetAxis, RatchetAxisPolarity> = {
  defaultVisibleWords: "max",
  leadBandWords: "presence",
  primaryActions: "max",
  visibleFields: "max",
  maxChoicesPerControl: "max",
  subLegibleControls: "max",
  buriedPrimaryAction: "max",
  axeViolations: "max",
};

/**
 * Measured noise floor per axis — the residue that survives normalisation.
 *
 * Determined empirically, not guessed: two independent freezes of the SAME commit
 * were diffed. Every count axis agreed exactly, and the ONLY residue was word counts
 * moving by ±2 on list surfaces, from relative-time phrasing whose length varies with
 * the clock ("less than a minute ago" is five words, "3 minutes ago" is three).
 *
 * So word axes get a 2-word floor and every count axis stays EXACT. This is a noise
 * floor, not a tolerance for sloppiness: the regressions this gate exists to catch are
 * hundreds of words, two orders of magnitude above it. Tighten it if the fixture is
 * ever made clock-deterministic.
 */
export const NOISE_FLOOR: Record<RatchetAxis, number> = {
  defaultVisibleWords: 2,
  leadBandWords: 2,
  primaryActions: 0,
  visibleFields: 0,
  maxChoicesPerControl: 0,
  subLegibleControls: 0,
  buriedPrimaryAction: 0,
  axeViolations: 0,
};

const AXIS_LABEL: Record<RatchetAxis, string> = {
  defaultVisibleWords: "words visible on arrival",
  leadBandWords: "lead-band words",
  primaryActions: "primary actions",
  visibleFields: "visible fields",
  maxChoicesPerControl: "choices in one control",
  subLegibleControls: "sub-legible controls",
  buriedPrimaryAction: "buried primary action (was reachable, now behind a collapse)",
  axeViolations: "axe violations",
};

export type RouteVerdict = {
  routePath: string;
  shell: UxShell;
  routeStatus: RouteStatus;
  /** Blocking regressions against the frozen baseline. */
  regressions: string[];
  /** Blocking absolute-budget failures (net-new routes only). */
  blockingBudgetFailures: string[];
  /** Advisory budget failures — reported, never blocking. */
  advisoryBudgetFailures: string[];
  /** True when the accessibility tree changed shape. */
  structureChanged: boolean;
  /**
   * WHAT changed in that tree, as `-` baseline / `+` measured lines — empty unless
   * structureChanged. Without this the gate says only "shape changed" and the failure
   * is undiagnosable from CI: the report artifact carries no snapshot, so finding the
   * cause meant reproducing the route against a live portal by hand. Safe to publish
   * — the projection is roles-only and VOLATILE_PATTERNS has already redacted names.
   */
  structureDiff: string[];
  ok: boolean;
  findings: BudgetFinding[];
  metrics: UxBudgetMetrics;
};

function measurementValue(m: RouteMeasurement, axis: RatchetAxis): number {
  return axis === "axeViolations" ? m.axeViolations : m.metrics[axis];
}

function ratchetAxisRegressed(axis: RatchetAxis, was: number, now: number): boolean {
  switch (RATCHET_AXIS_POLARITY[axis]) {
    case "max":
      return now > was + NOISE_FLOOR[axis];
    case "presence":
      // Lead-band adoption is the retrofit path for legacy routes. Adding one is
      // improvement; removing an established one is the regression the ratchet catches.
      return was > 0 && now === 0;
  }
}

/** Compare one route against its baseline (or judge it as net-new). */
export function verdictForRoute(
  measurement: RouteMeasurement,
  baseline: RouteBaseline | undefined,
): RouteVerdict {
  const routeStatus: RouteStatus = baseline ? "pre-existing" : "net-new";
  const report = evaluateUxBudget(measurement.metrics, measurement.shell, {
    routeStatus,
    exemptChecks: measurement.exemptChecks,
    audience: measurement.audience,
  });

  const regressions: string[] = [];
  let structureChanged = false;
  let structureDiff: string[] = [];

  if (baseline) {
    for (const axis of RATCHET_AXES) {
      const now = measurementValue(measurement, axis);
      const was = baseline[axis];
      // A negative value means the measurement was UNAVAILABLE this run (e.g. the axe
      // scan threw). Comparing it would manufacture a phantom regression the next time
      // the scan works — 0 > -1 is not an increase in violations, it is a scan that
      // recovered. Skip the axis and let the run that measured it decide.
      if (now < 0 || was < 0) continue;
      if (ratchetAxisRegressed(axis, was, now)) {
        regressions.push(`${AXIS_LABEL[axis]}: ${was} → ${now}`);
      }
    }
    // Whitespace-only reformatting of the YAML projection is not a hierarchy change.
    structureChanged = normaliseSnapshot(measurement.ariaSnapshot) !== normaliseSnapshot(baseline.ariaSnapshot);
    if (structureChanged) {
      structureDiff = summariseStructureDiff(baseline.ariaSnapshot, measurement.ariaSnapshot);
    }
  }

  const failed = report.findings.filter((f) => !f.ok);

  // On a PRE-EXISTING route the ratchet is the enforcement, and nothing else blocks.
  //
  // This is not a softening — it is what makes the gate adoptable. Legacy surfaces
  // already violate absolute budgets (the audit found an 818-word page with 34
  // sub-legible controls). If those absolutes blocked on a route the PR did not make
  // worse, every unrelated PR would fail until someone rewrote the whole portal —
  // the blind mass-rewrite the ratchet exists to avoid, and the fastest way to get a
  // required check disabled. Existing debt is reported every run and is caught the
  // moment it GROWS, because subLegibleControls and the rest are ratchet axes.
  // A net-new route has no such history, so on it every budget blocks.
  const blockingBudgetFailures =
    routeStatus === "net-new" ? failed.filter((f) => f.severity === "blocking").map((f) => f.detail) : [];
  const advisoryBudgetFailures =
    routeStatus === "net-new"
      ? failed.filter((f) => f.severity === "advisory").map((f) => f.detail)
      : failed.map((f) => f.detail);

  return {
    routePath: measurement.routePath,
    shell: measurement.shell,
    routeStatus,
    regressions,
    blockingBudgetFailures,
    advisoryBudgetFailures,
    structureChanged,
    structureDiff,
    ok: regressions.length === 0 && !structureChanged && blockingBudgetFailures.length === 0,
    findings: report.findings,
    metrics: measurement.metrics,
  };
}

/**
 * Volatile values that appear inside accessible names — deploy SHAs, record ids,
 * timestamps, counts. They must be redacted before a snapshot is stored or compared,
 * for two reasons:
 *   1. The structural ratchet asks "did the hierarchy change shape?" — a heading whose
 *      text is "Deployed: abc1234" would look changed on every deploy even when the
 *      structure is identical, firing noisy false regressions that get the gate
 *      disabled.
 *   2. The stored snapshot is committed to git; raw SHAs and ids are secret-shaped
 *      content that trips secret scanning and should not be persisted verbatim.
 * Each pattern collapses to a stable placeholder so structure (roles, heading levels,
 * nesting) is preserved while the volatile value is not.
 */
const VOLATILE_PATTERNS: [RegExp, string][] = [
  // Secret-SHAPED content the live DOM can legitimately show as a label or
  // placeholder (e.g. an integration-setup field that reads "-----BEGIN PRIVATE
  // KEY-----" or a sample token). It is not a real secret, but it must not be
  // stored verbatim: it trips secret scanning and is noise for a structure gate.
  // Redact FIRST, before the narrower value patterns below.
  [/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "<pem>"], // PEM key blocks
  [/-----BEGIN[A-Z0-9 ]*-----/g, "<pem>"], // a lone PEM header shown as a label
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "<jwt>"], // JWTs
  [/\b[0-9a-f]{7,40}\b/gi, "<hex>"], // git SHAs (short and full)
  [/\bc[a-z0-9]{24,}\b/gi, "<id>"], // cuid-style record ids
  [/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, "<timestamp>"], // ISO date/time
  [/\b\d[\d,]{2,}\b/g, "<num>"], // multi-digit counts (4+ chars incl. separators)
];

/**
 * Wall-clock text the UI renders — the measured cause of run-to-run drift.
 *
 * Two independent sweep runs of identical code differed on 91/200 ARIA snapshots
 * and 38/200 word counts. The diff was always the same shape: seeded records carry
 * `updatedAt = now`, and the UI renders it — "· updated 7/23/2026, 7:37:21 PM" in
 * one run, "8:27:13 PM" in the next. Relative phrasings ("2 hours ago" vs "just
 * now") also change the WORD COUNT, which is where the ±2 deltas came from.
 *
 * Each pattern collapses to a single stable token, so both the text and its word
 * count stop moving. Applied to the served HTML before measuring (BI-EA221325).
 */
const RELATIVE_UNIT = "(?:second|minute|hour|day|week|month|year)s?";
// Qualifier + quantity are BOTH optional and variable-length, which is exactly what
// moved the word count: "less than a minute ago" (5 words) vs "3 minutes ago" (3).
// Each optional group carries its OWN trailing space — a shared leading `\s*` would
// swallow the space before the phrase and glue it to the preceding word
// ("updated 3 minutes ago" -> "updated<ago>", one token instead of two).
const RELATIVE_QUALIFIER = "(?:(?:about|almost|over|under|nearly|roughly|approximately|less than|more than|just)\\s+)?";
const RELATIVE_QUANTITY = "(?:(?:an?|\\d+)\\s+)?";

const VOLATILE_TEXT_PATTERNS: [RegExp, string][] = [
  [new RegExp(`\\b${RELATIVE_QUALIFIER}${RELATIVE_QUANTITY}${RELATIVE_UNIT}\\s+ago\\b`, "gi"), "<ago>"],
  [/\b(?:just now|a moment ago|moments ago)\b/gi, "<ago>"],
  [new RegExp(`\\bin\\s+${RELATIVE_QUALIFIER}${RELATIVE_QUANTITY}${RELATIVE_UNIT}\\b`, "gi"), "<in>"],
  [/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?/g, "<time>"],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "<date>"],
  [/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/g, "<date>"],
];

/** Collapse wall-clock text so a measurement does not move with the clock. */
export function normaliseVolatileText(text: string): string {
  let out = text;
  for (const [re, placeholder] of VOLATILE_TEXT_PATTERNS) out = out.replace(re, placeholder);
  return out;
}

// A property line inside the tree, e.g. `- /url: /workspace`. Carries data, not shape.
const PROPERTY_LINE = /^\/[\w-]+:/;

/**
 * Live-region roles. These announce transient state (a toast, a polling status) and
 * come and go with timing, not with the page's structure — one measured run had an
 * `alert` node its twin did not. They are excluded so a transient announcement is
 * never reported as "the hierarchy changed shape".
 */
const TRANSIENT_ROLES = new Set(["alert", "status", "log", "marquee", "timer"]);

/**
 * Document-level landmarks. Once `main` has been seen, a TOP-LEVEL node that is not
 * one of these is portal chrome (toasts, dialogs) that React appends to the end of
 * <body> — it comes and goes with timing and is not page structure.
 *
 * This is what finally made the comparison exact. The measured case: one run's tail
 * was `alert`, its twin's was `button` then `alert` — the toast's dismiss control is
 * a SIBLING of the alert, sometimes emitted before it, so neither subtree-skipping
 * nor "stop at the first live region" catches it. Ending the projection where the
 * page's own landmarks end does.
 */
const DOCUMENT_LANDMARKS = new Set([
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "navigation",
  "region",
  "search",
  "form",
]);

/**
 * Project an ARIA snapshot down to STRUCTURE: nesting depth, role, and structural
 * state ([level=2], [pressed], [checked], …). Accessible names, URLs and text
 * payloads are DROPPED.
 *
 * This is the whole point of the gate — "did the hierarchy change shape?", not "did
 * a label's text change". Names are where the volatile data lives (timestamps, ids,
 * counts) and also where secret-shaped labels appear, so dropping them makes the
 * comparison both deterministic and safe to commit. The measured evidence supports
 * it: when two runs differed, the LINE COUNTS matched exactly (141 vs 141) — only
 * the text payloads moved.
 */
type ProjectedNode = { line: string; children: ProjectedNode[] };

/**
 * Build a tree from indentation-ordered projected lines. Stack-based so an
 * unexpected indentation jump re-parents rather than dropping the subtree.
 */
function toTree(lines: string[]): ProjectedNode[] {
  const root: ProjectedNode = { line: "", children: [] };
  const stack: { indent: number; node: ProjectedNode }[] = [{ indent: -1, node: root }];
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node: ProjectedNode = { line, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent, node });
  }
  return root.children;
}

function serialiseNode(n: ProjectedNode): string {
  return `${n.line.trim()}(${n.children.map(serialiseNode).join(",")})`;
}

function flatten(nodes: ProjectedNode[], out: string[]): void {
  for (const n of nodes) {
    out.push(n.line);
    flatten(n.children, out);
  }
}

/**
 * Collapse consecutive sibling subtrees that project identically.
 *
 * A list of N identically-shaped rows IS the same shape as one row — and N varies
 * with seeded data. /build/work was the measured case: a table whose row count
 * differed between two runs of the same commit, which no amount of text
 * normalisation can fix because the ROWS are structure.
 *
 * The trade-off is deliberate and bounded: the projection becomes insensitive to
 * COUNT (how many rows, how many cells) while staying sensitive to KIND, nesting and
 * structural state — a new sort of node inside a row, a flattened heading, a missing
 * landmark are all still caught. Count is not lost from the gate: it is exactly what
 * the numeric axes (words, controls, fields) already ratchet.
 */
function collapseRepeatedSiblings(lines: string[]): string[] {
  if (lines.length === 0) return lines;
  const dedupe = (nodes: ProjectedNode[]): ProjectedNode[] => {
    const out: ProjectedNode[] = [];
    for (const n of nodes) {
      n.children = dedupe(n.children);
      const prev = out[out.length - 1];
      if (prev && serialiseNode(prev) === serialiseNode(n)) continue;
      out.push(n);
    }
    return out;
  };
  const flat: string[] = [];
  flatten(dedupe(toTree(lines)), flat);
  return flat;
}

/** Diff lines emitted into the report before truncating. Enough to name the cause. */
export const STRUCTURE_DIFF_LIMIT = 12;

/**
 * A line-level diff of the two NORMALISED projections, as `-` baseline / `+` measured.
 *
 * Both sides are already collapsed and redacted by normaliseSnapshot, so this reports
 * the same thing the gate actually compared — not the raw tree, which would show
 * repetition the gate deliberately ignores and send the reader chasing row counts.
 *
 * Longest-common-subsequence, with a size guard: the projections are roles-only and
 * collapsed (hundreds of lines), but a pathological surface must not turn a reporting
 * nicety into a quadratic blowup inside the gate. Past the guard, fall back to naming
 * the first point of divergence, which is still strictly better than a bare boolean.
 */
export function summariseStructureDiff(
  baselineSnapshot: string,
  measuredSnapshot: string,
  limit: number = STRUCTURE_DIFF_LIMIT,
): string[] {
  const was = normaliseSnapshot(baselineSnapshot).split("\n");
  const now = normaliseSnapshot(measuredSnapshot).split("\n");
  if (was.join("\n") === now.join("\n")) return [];

  const truncate = (out: string[]): string[] =>
    out.length > limit
      ? [...out.slice(0, limit), `… ${out.length - limit} more structural line(s)`]
      : out;

  // Replace the projection's own `- ` bullet rather than prefixing it: a `- ` diff
  // marker in front of a `- role` line reads as `- - banner`. Indentation is kept,
  // because depth is how the reader locates the node in the tree.
  const render = (marker: "[-]" | "[+]", line: string): string => {
    const indent = line.slice(0, line.length - line.trimStart().length);
    return `${indent}${marker} ${line.trimStart().replace(/^-\s*/, "")}`;
  };

  const LCS_GUARD = 4_000_000; // cells; ~2000x2000 lines
  if (was.length * now.length > LCS_GUARD) {
    let i = 0;
    while (i < was.length && i < now.length && was[i] === now[i]) i++;
    return truncate(
      [
        `first divergence at line ${i + 1} (diff truncated — projection too large)`,
        ...(was[i] === undefined ? [] : [render("[-]", was[i])]),
        ...(now[i] === undefined ? [] : [render("[+]", now[i])]),
      ].filter(Boolean),
    );
  }

  // lcs[i][j] = length of the longest common subsequence of was[i..] and now[j..].
  const lcs: number[][] = Array.from({ length: was.length + 1 }, () =>
    new Array<number>(now.length + 1).fill(0),
  );
  for (let i = was.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      lcs[i][j] =
        was[i] === now[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < was.length && j < now.length) {
    if (was[i] === now[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(render("[-]", was[i]));
      i++;
    } else {
      out.push(render("[+]", now[j]));
      j++;
    }
  }
  for (; i < was.length; i++) out.push(render("[-]", was[i]));
  for (; j < now.length; j++) out.push(render("[+]", now[j]));

  return truncate(out);
}

export function normaliseSnapshot(snapshot: string): string {
  let out = snapshot;
  // Defense in depth: redact before projecting, so anything that survives into a
  // role or attribute is still scrubbed.
  for (const [re, placeholder] of VOLATILE_PATTERNS) out = out.replace(re, placeholder);

  const lines: string[] = [];
  // Depth of a transient subtree currently being skipped, or null. A live region's
  // CHILDREN are transient too — the measured case was an `alert` whose dismiss
  // `button` also appeared in only one of the two runs — so the whole subtree goes.
  let skipDeeperThan: number | null = null;
  let seenMain = false;

  for (const raw of out.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (skipDeeperThan !== null) {
      if (indent.length > skipDeeperThan) continue;
      skipDeeperThan = null;
    }
    // Strip the list marker, then any wrapping quotes around the whole node.
    const body = line.trimStart().replace(/^-\s*/, "").replace(/^['"]|['"]$/g, "");
    if (PROPERTY_LINE.test(body)) continue;
    const role = /^([a-zA-Z][\w-]*)/.exec(body)?.[1];
    if (!role) continue;
    const lower = role.toLowerCase();
    // Past the page's own landmarks, top-level nodes are portal chrome — stop.
    if (indent.length === 0 && seenMain && !DOCUMENT_LANDMARKS.has(lower)) break;
    if (lower === "main") seenMain = true;
    if (TRANSIENT_ROLES.has(lower)) {
      if (indent.length === 0) break;
      skipDeeperThan = indent.length;
      continue;
    }
    const attrs = [...body.matchAll(/\[([^\]]+)\]/g)].map((m) => `[${m[1]}]`).join(" ");
    lines.push(`${indent}- ${role}${attrs ? ` ${attrs}` : ""}`);
  }
  return collapseRepeatedSiblings(lines).join("\n");
}

export type SweepVerdict = {
  bootstrapped: boolean;
  /** True when CI should fail. Always false while bootstrapping. */
  blocked: boolean;
  verdicts: RouteVerdict[];
  netNewRoutes: string[];
  regressedRoutes: string[];
  /** §7.1 league table: worst offenders first, by words then controls. */
  leagueTable: { routePath: string; shell: UxShell; words: number; controls: number }[];
};

/**
 * Which blocking verdicts failed to reproduce on a second measurement.
 *
 * A gate must attribute its refusal to a real defect. Some routes render from
 * database state the sweep does not pin, so their metrics move between runs with
 * no code change — observed live on /storefront/settings/operations, which
 * blocked a PR touching only a Dockerfile and shell scripts, then passed on an
 * identical-SHA re-run (BI-69FE5504).
 *
 * A real regression is deterministic and reproduces. An unstable measurement
 * does not. So a route only keeps its blocking verdict if the SECOND pass agrees.
 *
 * Fails safe in both directions that matter:
 *  - a route that could not be re-measured keeps blocking (silence is not
 *    evidence of stability);
 *  - a route that reproduces keeps blocking, unchanged.
 */
export function findNotReproducibleBlocking(input: {
  firstPassBlocking: readonly string[];
  confirmPassBlocking: readonly string[];
  unmeasuredOnConfirm: readonly string[];
}): string[] {
  const stillBlocking = new Set(input.confirmPassBlocking);
  const unmeasured = new Set(input.unmeasuredOnConfirm);
  return [...new Set(input.firstPassBlocking)]
    .filter((routePath) => !stillBlocking.has(routePath) && !unmeasured.has(routePath))
    .sort();
}

export function evaluateSweep(
  measurements: RouteMeasurement[],
  baselineFile: BaselineFile,
): SweepVerdict {
  const verdicts = measurements.map((m) => verdictForRoute(m, baselineFile.routes[m.routePath]));

  const leagueTable = measurements
    .map((m) => ({
      routePath: m.routePath,
      shell: m.shell,
      words: m.metrics.defaultVisibleWords,
      controls: m.metrics.primaryActions + m.metrics.visibleFields,
    }))
    .sort((a, b) => b.words - a.words || b.controls - a.controls);

  return {
    bootstrapped: baselineFile.bootstrapped,
    // While bootstrapping the sweep's job is to PRODUCE the baseline, so it cannot
    // meaningfully judge against one. It reports; it does not block.
    blocked: baselineFile.bootstrapped && verdicts.some((v) => !v.ok),
    verdicts,
    netNewRoutes: verdicts.filter((v) => v.routeStatus === "net-new").map((v) => v.routePath),
    regressedRoutes: verdicts.filter((v) => v.regressions.length > 0).map((v) => v.routePath),
    leagueTable,
  };
}

/** Freeze the current measurements as the new baseline. */
export function freezeBaseline(measurements: RouteMeasurement[], generator: string): BaselineFile {
  const routes: Record<string, RouteBaseline> = {};
  for (const m of [...measurements].sort((a, b) => (a.routePath < b.routePath ? -1 : 1))) {
    routes[m.routePath] = {
      defaultVisibleWords: m.metrics.defaultVisibleWords,
      leadBandWords: m.metrics.leadBandWords,
      primaryActions: m.metrics.primaryActions,
      visibleFields: m.metrics.visibleFields,
      maxChoicesPerControl: m.metrics.maxChoicesPerControl,
      subLegibleControls: m.metrics.subLegibleControls,
      buriedPrimaryAction: m.metrics.buriedPrimaryAction,
      axeViolations: m.axeViolations,
      ariaSnapshot: normaliseSnapshot(m.ariaSnapshot),
    };
  }
  return { bootstrapped: true, generator, routes };
}

export type BaselineReproducibilityIssue = {
  routePath: string;
  axis: RatchetAxis | "ariaSnapshot" | "route";
  first: number | string;
  second: number | string;
};

/**
 * Compare two independent freezes of one source tree using the same contract as
 * enforcement. Count axes and semantic structure must match exactly; word axes may
 * differ only inside the empirically measured noise floor documented above.
 */
export function compareBaselineReproducibility(
  first: BaselineFile,
  second: BaselineFile,
): BaselineReproducibilityIssue[] {
  const issues: BaselineReproducibilityIssue[] = [];
  const routePaths = [...new Set([
    ...Object.keys(first.routes),
    ...Object.keys(second.routes),
  ])].sort();

  for (const routePath of routePaths) {
    const a = first.routes[routePath];
    const b = second.routes[routePath];
    if (!a || !b) {
      issues.push({
        routePath,
        axis: "route",
        first: a ? "present" : "missing",
        second: b ? "present" : "missing",
      });
      continue;
    }
    for (const axis of RATCHET_AXES) {
      if (Math.abs(a[axis] - b[axis]) > NOISE_FLOOR[axis]) {
        issues.push({
          routePath,
          axis,
          first: a[axis],
          second: b[axis],
        });
      }
    }
    const firstStructure = normaliseSnapshot(a.ariaSnapshot);
    const secondStructure = normaliseSnapshot(b.ariaSnapshot);
    if (firstStructure !== secondStructure) {
      issues.push({
        routePath,
        axis: "ariaSnapshot",
        first: firstStructure,
        second: secondStructure,
      });
    }
  }
  return issues;
}

/**
 * Produce the conservative envelope of two reproducible freezes. Exact-count axes
 * are equal by construction, so only word counts can move when the envelope forms.
 */
export function mergeReproducibleBaselines(
  first: BaselineFile,
  second: BaselineFile,
): BaselineFile {
  const issues = compareBaselineReproducibility(first, second);
  if (issues.length > 0) {
    const summary = issues
      .slice(0, 8)
      .map((issue) => `${issue.routePath}:${issue.axis}`)
      .join(", ");
    throw new Error(
      `UX route baselines are not reproducible (${issues.length} issue(s)): ${summary}`,
    );
  }

  const routes: Record<string, RouteBaseline> = {};
  for (const routePath of Object.keys(first.routes).sort()) {
    const a = first.routes[routePath];
    const b = second.routes[routePath];
    routes[routePath] = {
      defaultVisibleWords: Math.max(a.defaultVisibleWords, b.defaultVisibleWords),
      leadBandWords: Math.max(a.leadBandWords, b.leadBandWords),
      primaryActions: Math.max(a.primaryActions, b.primaryActions),
      visibleFields: Math.max(a.visibleFields, b.visibleFields),
      maxChoicesPerControl: Math.max(a.maxChoicesPerControl, b.maxChoicesPerControl),
      subLegibleControls: Math.max(a.subLegibleControls, b.subLegibleControls),
      buriedPrimaryAction: Math.max(a.buriedPrimaryAction, b.buriedPrimaryAction),
      axeViolations: Math.max(a.axeViolations, b.axeViolations),
      ariaSnapshot: normaliseSnapshot(a.ariaSnapshot),
    };
  }
  return {
    bootstrapped: true,
    generator: first.generator,
    routes,
  };
}

/** Human-readable summary for the CI log / PR comment. */
export function formatSweepReport(sweep: SweepVerdict): string {
  const lines: string[] = [];
  if (!sweep.bootstrapped) {
    lines.push(
      "UX route sweep — BOOTSTRAP MODE (reporting, not blocking).",
      "No measured baseline is committed yet, so there is nothing to ratchet against.",
      "Commit the baseline this run produced to arm the gate.",
      "",
    );
  }

  for (const v of sweep.verdicts.filter((x) => !x.ok)) {
    lines.push(`${v.routePath}  [${v.shell}, ${v.routeStatus}]`);
    for (const r of v.regressions) lines.push(`  REGRESSION  ${r}`);
    if (v.structureChanged) {
      lines.push("  REGRESSION  accessibility tree changed shape (heading/landmark structure)");
      // The diff is the whole point of the line above: without it the reader knows
      // only THAT the shape moved, and the log tail is where they look first.
      for (const d of v.structureDiff) lines.push(`                ${d}`);
    }
    for (const f of v.blockingBudgetFailures) lines.push(`  BLOCKING    ${f}`);
    for (const f of v.advisoryBudgetFailures) lines.push(`  advisory    ${f}`);
    lines.push("");
  }

  lines.push("Worst surfaces by words visible on arrival (§7.1 league table):");
  for (const row of sweep.leagueTable.slice(0, 15)) {
    lines.push(`  ${String(row.words).padStart(5)}w  ${row.routePath}  [${row.shell}]`);
  }
  return lines.join("\n");
}

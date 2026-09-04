// Standing self-tasks for the coworkers declared in coworker-standing-shapes.ts.
//
// Split from coworker-self-tasks.ts, which was within 51 lines of the 800-line
// soft ceiling. That file keeps the type, the procedural-tool contract, and the
// original entries; this one holds the entries that pair with a declared work
// shape.
//
// Each entry drives the FIRST stage of that coworker's shape and nothing
// further. A self-task starts standing work; it never carries it past the
// shape's governed gate, because the gate is where a human decides.
//
// Every cron is off-peak and minute-staggered so a full roster does not wake
// together; deconflictCron shifts any that still collide. `balanced` and
// `assertive` are the two Proactivity levels — without an entry here a
// Proactivity setting is a silent no-op, which is what the cadence plane of the
// capability measure reports as level 0.

import type { CoworkerSelfTask } from "./coworker-self-tasks";

const AUTONOMOUS_PREAMBLE = [
  "You are running as a scheduled, autonomous task — no human is watching this",
  "turn, so finish the work rather than asking questions.",
  "",
].join("\n");

function task(
  title: string,
  routeContext: string,
  balanced: string,
  assertive: string,
  body: string[],
): CoworkerSelfTask {
  return {
    title,
    prompt: AUTONOMOUS_PREAMBLE + body.join("\n"),
    routeContext,
    cadence: { balanced, assertive },
  };
}

export const COWORKER_STANDING_SELF_TASKS: Record<string, CoworkerSelfTask> = {
  // ── security-alert-triage-ladder ─────────────────────────────────────────
  "soc-triage-analyst": task(
    "Enrich and judge the detection queue", "/ops/security", "11 6 * * 1-5", "11 6,14 * * *",
    [
      "Goal: no detection reaches a human unenriched or unjudged.",
      "1. Read open detections. For each, attach asset, identity, and threat-intel context.",
      "2. Assign a verdict backed by named events: false-positive, benign-true-positive,",
      "   malicious, or needs-human. The verdict is an evidence conclusion — never guess,",
      "   and never let a scoring tool decide whether something is malicious.",
      "3. Close clear false positives and benign true positives with a rationale.",
      "4. Escalate anything ambiguous or high-severity with the timeline already built.",
      "If the detection store cannot be read, report that and stop. An empty read is not a",
      "quiet queue, and reporting it as one is the failure this task exists to prevent.",
    ],
  ),
  "soc-investigator": task(
    "Scope the escalated cases", "/ops/security", "13 7 * * 1-5", "13 7,15 * * *",
    [
      "Goal: every escalated case carries a defensible scope before anyone is asked to act.",
      "1. Reconstruct the timeline from cited events — what happened, in what order, where.",
      "2. Establish blast radius: which hosts, accounts, and data are implicated.",
      "3. Map observed behaviour to ATT&CK techniques by name.",
      "4. Set verdict and confidence from the evidence, or mark needs-human when the",
      "   evidence will not support a call. Marking needs-human is a correct outcome.",
    ],
  ),
  "soc-incident-commander": task(
    "Advance open incidents and propose response", "/ops/security", "17 8 * * 1-5", "17 8,16 * * *",
    [
      "Goal: scoped cases move, and response is proposed rather than taken.",
      "1. For each scoped case, name and rank the containment/remediation options.",
      "2. Draft each as a PROPOSAL on the proposal-not-action rail. It lands on the",
      "   customer's Attention Surface and executes on their runner. Never execute here.",
      "3. Drive case status investigating -> contained -> resolved -> closed, with the",
      "   timeline reflecting each decision and who made it.",
      "4. Say plainly what you propose and what you need approved.",
    ],
  ),
  "soc-threat-hunter": task(
    "Hunt the coverage gaps", "/ops/security", "23 5 * * 1", "23 5 * * 1,4",
    [
      "Goal: find what the rules are not catching.",
      "1. Name ATT&CK techniques and asset classes with no detection — enumerate them,",
      "   do not characterise them.",
      "2. Run a structured hunt against the highest-value gap. Record what you looked for",
      "   and what you found, INCLUDING when you found nothing.",
      "3. Turn a confirmed gap into a proposed DetectionRule tuning for operator review.",
      "4. Sweep the estate against the threat-intel index and surface unmatched hits.",
    ],
  ),

  // ── estate-conformance-watch / architecture-alignment-review ─────────────
  "data-steward": task(
    "Read the estate as recorded and as observed", "/platform/data", "29 4 * * *", "29 4,16 * * *",
    [
      "Goal: know where the record and the observable estate disagree.",
      "1. Read each asset class as RECORDED and as OBSERVED.",
      "2. List every divergence. Name any class you could not read on either side.",
      "3. Do not reconcile the record to the observation. Raising the divergence is the",
      "   work; deciding the response belongs to the data owner.",
      "An unreadable class reported honestly is more useful than a clean diff you cannot",
      "stand behind.",
    ],
  ),
  "data-architect": task(
    "Classify estate divergences", "/platform/data", "31 5 * * *", "31 5,17 * * *",
    [
      "Goal: each divergence is understood before anyone is asked to decide on it.",
      "1. For each open divergence, classify it: record defect, observation defect, or a",
      "   genuine change in the estate.",
      "2. State the evidence for the classification. A classification without evidence is",
      "   a guess wearing a category.",
      "3. Where schema is implicated, say which model and field, not just which table.",
    ],
  ),
  "inventory-specialist": task(
    "Reconcile the asset inventory", "/inventory", "37 5 * * *", "37 5,17 * * *",
    [
      "Goal: assets present in one reading and absent from the other are visible.",
      "1. Compare recorded inventory against observed assets.",
      "2. List each one-sided asset with its last-seen evidence and when that was.",
      "3. Never delete or create an asset record from this task — surface the difference",
      "   and let the owner decide.",
    ],
  ),
  "ea-architect": task(
    "Compare delivered against recorded architecture", "/ea/capabilities", "41 3 * * 1", "41 3 * * 1,4",
    [
      "Goal: know where the architecture on paper and the architecture in the code differ.",
      "1. For each capability in scope, compare the recorded architecture with what the",
      "   code graph actually shows.",
      "2. Name capabilities that have NO recorded architecture as exactly that — absence",
      "   is a finding, not alignment.",
      "3. Raise findings against named capabilities. Ratification is the owner's.",
    ],
  ),

  // ── licence-currency-watch ───────────────────────────────────────────────
  "licensing-specialist": task(
    "Re-confirm licensing requirements against their authority", "/compliance/licensing", "43 5 * * *", "43 5,17 * * *",
    [
      "Goal: nothing is served as current that has not been checked recently enough.",
      "1. List requirement references at or approaching their staleness budget. The",
      "   platform ceiling is 90 days — a reference past it is unconfirmed, not merely old.",
      "2. Re-check each against its official source. Record the outcome WHETHER OR NOT the",
      "   rule changed; 'checked, unchanged' is the result that keeps the record honest.",
      "3. Where the authority is unreachable, mark the reference unconfirmed and say so.",
      "   Never retain old text as current because the source was down.",
      "4. Where the rule changed, hand it to legal for a jurisdiction-layered reading.",
    ],
  ),
  "legal-operations-counsel": task(
    "Read changed requirements by jurisdiction", "/compliance/regulations", "47 6 * * *", "47 6,18 * * *",
    [
      "Goal: a changed requirement is understood before it is adopted.",
      "1. For each requirement flagged as changed, state what changed, in which",
      "   jurisdiction, and for whom it applies.",
      "2. Layer the analysis: federal, state/province, and local obligations are distinct",
      "   and a conclusion at one layer is not a conclusion at another.",
      "3. Do not assert a legal conclusion the source does not support. Adoption is the",
      "   compliance owner's decision, not yours.",
    ],
  ),

  // ── workforce-intake-cycle ───────────────────────────────────────────────
  "admin-assistant": task(
    "Assemble open intake packets", "/workspace/inbox", "53 6 * * 1-5", "53 6,14 * * *",
    [
      "Goal: an intake is never blocked on something nobody noticed was missing.",
      "1. For each person joining, moving, or leaving, capture start date, role, location,",
      "   and the records the change requires.",
      "2. Name what is MISSING rather than assuming a default. A packet that looks complete",
      "   because a gap was filled with a guess is worse than an obviously incomplete one.",
    ],
  ),
  "hr-specialist": task(
    "Prepare employment records and role readiness", "/people", "59 6 * * 1-5", "59 6,15 * * *",
    [
      "Goal: the packet is ready for a human to admit — or is honestly blocked.",
      "1. Prepare employment records and assign the onboarding curriculum.",
      "2. Identify credentials the ROLE legally requires. Flag any that are absent or",
      "   unverifiable as BLOCKING. Do not proceed past a blocking credential.",
      "3. Never grant access. Admission is a human act, and a complete packet is not",
      "   evidence that a required licence is held.",
    ],
  ),

  // ── service-dispatch-cycle ───────────────────────────────────────────────
  "dispatcher": task(
    "Propose the day's assignments", "/workspace/calendar", "7 5 * * *", "7 5,11 * * *",
    [
      "Goal: every job in the window has a proposed technician and time, or a named reason",
      "it has neither.",
      "1. Read real technician availability. Do not assume capacity you cannot see.",
      "2. Propose an assignment and window per job.",
      "3. Name conflicts and unassignable jobs explicitly — an unassignable job that is",
      "   quietly deferred becomes a missed customer promise nobody decided to break.",
      "4. Propose only. Committing the schedule makes an external promise and is a human act.",
    ],
  ),
  "ops-coordinator": task(
    "Coordinate the committed day", "/ops", "9 7 * * *", "9 7,13,17 * * *",
    [
      "Goal: the committed schedule and reality stay in step.",
      "1. Reflect running-late, reassignment, and completion states against what was committed.",
      "2. Where reality has diverged from the commitment, surface it with the customer",
      "   impact named, rather than silently updating the record.",
    ],
  ),

  // ── outward-surface-review ───────────────────────────────────────────────
  "storefront-advisor": task(
    "Check outward claims against the storefront", "/storefront", "19 8 * * 1-5", "19 8,16 * * *",
    [
      "Goal: the business never advertises what it does not sell.",
      "1. Compare offers, prices, and availability in outward content against the",
      "   storefront record.",
      "2. Name each mismatch. Do not correct the content silently — a mismatch may mean",
      "   the storefront is wrong, and deciding which is not yours.",
    ],
  ),
  "doc-specialist": task(
    "Reconcile user-facing documentation", "/knowledge", "27 9 * * 1-5", "27 9,17 * * *",
    [
      "Goal: documentation matches what the product actually does.",
      "1. Identify user-facing pages affected by recent change.",
      "2. Update them, or record that they are unaffected WITH a reason. An unexamined page",
      "   is not an unaffected page.",
    ],
  ),
  "ux-accessibility-agent": task(
    "Review outward surfaces for accessibility", "/platform/ux", "33 10 * * 1-5", "33 10 * * *",
    [
      "Goal: nothing reaches the public that a person using assistive technology cannot use.",
      "1. Check text alternatives, contrast, and semantic structure on surfaces queued for",
      "   publication.",
      "2. Report failures as BLOCKING, not advisory. An accessibility failure downgraded to",
      "   a suggestion is an accessibility failure that ships.",
      "3. Say what would fix each one, specifically enough to act on.",
    ],
  ),

  // ── external-build-handoff ───────────────────────────────────────────────
  "external-claude-code": task(
    "Report claimed external work", "/build/work", "21 4 * * *", "21 4,16 * * *",
    [
      "Goal: work built on this surface is visible to the coordination plane.",
      "1. Report each claimed workroom, its branch, and whether evidence has been recorded.",
      "2. Where a claim is stale — no branch, no evidence, no heartbeat — say so, so the",
      "   workroom can be reaped rather than silently held.",
    ],
  ),
  "external-codex": task(
    "Report claimed external work", "/build/work", "23 4 * * *", "23 4,16 * * *",
    [
      "Goal: work built on this surface is visible to the coordination plane.",
      "1. Report each claimed workroom, its branch, and whether evidence has been recorded.",
      "2. Where a claim is stale, say so rather than leaving it held.",
    ],
  ),
  "external-grok": task(
    "Report claimed external work", "/build/work", "25 4 * * *", "25 4,16 * * *",
    [
      "Goal: work built on this surface is visible to the coordination plane.",
      "1. Report each claimed workroom, its branch, and whether evidence has been recorded.",
      "2. Where a claim is stale, say so rather than leaving it held.",
    ],
  ),

  // ── catalog-scout-sweep ──────────────────────────────────────────────────
  "external-catalog-scout": task(
    "Sweep external catalogs for candidates", "/platform/tools/catalog", "39 2 * * 1", "39 2 * * 1,4",
    [
      "Goal: surface capabilities worth evaluating, with enough evidence to evaluate them.",
      "1. Scan external catalogs for candidates against known platform gaps.",
      "2. For each, record source, licence, and which gap it would close.",
      "3. Drop any candidate whose licence or provenance you cannot establish. Do not defer",
      "   it — an unattributable dependency is not a candidate.",
      "4. Adoption is a governed decision. Surface, never adopt.",
    ],
  ),
};

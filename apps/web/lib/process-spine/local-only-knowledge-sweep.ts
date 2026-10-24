// BI-1281A164 — make a durable finding that never left this install visible,
// without anyone having to notice.
//
// THE MEASURED PROBLEM. `learnings-belong-in-the-shared-commons` says every
// durable finding routes to a commons lane, and `dpf-route-learning-to-commons`
// spells out the four lanes and the tool for each. Both are prose. On one
// operator install 553 markdown files accumulated in a single AI client's local
// memory instead, and 239 improvement proposals sat at `contributionStatus:
// "local"` with none contributed — on an install explicitly configured to
// contribute. Per the cognitive-load ladder, the next rung above prose is a
// control at the moment of action, not more prose.
//
// WHY THIS SHAPE. AGENTS.md §1: platform function never depends on a client. A
// client-side hook could see the memory files but could never be the guarantee,
// and no other install would inherit it. What the PLATFORM can see is its own
// record of findings that were captured and never routed —
// `ImprovementProposal.contributionStatus`, which already defaults to "local"
// and is only ever moved to "contributed" by the hive delivery path, keyed on a
// build id. A finding raised by an external session has no build, so it can
// never leave. That column is the honest server-side signal, and it needs no
// migration.
//
// NOT A NAG (EP-C00F61F4: an always-red signal is worse than none). This files
// ONE backlog item and then goes quiet: `ingestBacklogItem` dedupes on the
// origin marker against non-terminal items, so every later sweep increments an
// occurrence count rather than filing again. Closing that item is the event
// that clears the signal and re-arms the sweep. It also never contributes
// anything itself — routing a learning is a judgment call with a named lane,
// and a cron must not make it.

export const LOCAL_ONLY_SWEEP_JOB_ID = "local-only-knowledge-sweep";
export const LOCAL_ONLY_SWEEP_INNGEST_ID = `ops/${LOCAL_ONLY_SWEEP_JOB_ID}`;
/** Weekly, Monday 06:43 — off the :17 canonical digest and the :23 triage drain. */
export const LOCAL_ONLY_SWEEP_CRON = "43 6 * * 1";
export const LOCAL_ONLY_SWEEP_ORIGIN = { kind: "local-only-knowledge", id: "sweep" } as const;

/**
 * Below this, local findings are ordinary work in flight rather than a corpus
 * stranding on one machine. Above it, nobody is routing and the platform should
 * say so. Chosen against the measured install: 239 unrouted proposals, so any
 * threshold in the tens would have fired years of findings ago.
 */
export const LOCAL_ONLY_THRESHOLD = 10;

/** The commons lanes from `dpf-route-learning-to-commons`. */
export const COMMONS_LANES = ["wwmd", "wwwd", "wsid", "code-and-rulebook"] as const;
export type CommonsLane = (typeof COMMONS_LANES)[number];

export type UnroutedProposal = {
  proposalId: string;
  title: string;
  category: string;
  severity: string;
  createdAt: Date;
};

export type LaneRouting = {
  lane: CommonsLane;
  /** The governed tool that moves it, so the item says what to DO, not just what is wrong. */
  tool: string;
};

/**
 * Map a proposal to the lane that owns it. Deterministic and total: an
 * unrecognised category routes to WWWD, the platform-knowledge lane, because
 * the failure we are guarding against is a finding going nowhere. Sending it to
 * a lane a human then corrects is strictly better than dropping it, and this
 * runs unattended so it must never need a model to decide.
 */
export function laneForProposal(proposal: Pick<UnroutedProposal, "category">): LaneRouting {
  switch (proposal.category) {
    case "skill":
      return { lane: "wsid", tool: "propose_skill_improvement" };
    case "process":
      // A process rule is a durable judgment — "when X, prefer Y" — which is
      // kernel shape. Kernel pages are PR-only and ratified on merge; the skill
      // is explicit that a principle is never invented in place.
      return { lane: "wwmd", tool: "a PR adding docs/founder-kernel/wiki/principles/<slug>.md" };
    case "bug":
    case "code":
      return { lane: "code-and-rulebook", tool: "create_backlog_item, then a PR carrying code and AGENTS.md together" };
    default:
      return { lane: "wwwd", tool: "propose_improvement" };
  }
}

export type SweepVerdict =
  | { fires: false; reason: "below-threshold"; unrouted: number; threshold: number }
  | { fires: true; unrouted: number; threshold: number; oldestDays: number };

/**
 * Decide whether the sweep has anything to say. Pure.
 *
 * `oldestDays` is carried because count alone understates the problem: ten
 * findings from this week are a queue, ten from last quarter are a corpus that
 * stopped moving.
 */
export function evaluateSweep(input: {
  proposals: UnroutedProposal[];
  now: Date;
  threshold?: number;
}): SweepVerdict {
  const threshold = input.threshold ?? LOCAL_ONLY_THRESHOLD;
  const unrouted = input.proposals.length;
  if (unrouted < threshold) {
    return { fires: false, reason: "below-threshold", unrouted, threshold };
  }
  const oldest = input.proposals.reduce(
    (min, p) => (p.createdAt < min ? p.createdAt : min),
    input.proposals[0]!.createdAt,
  );
  const oldestDays = Math.max(0, Math.floor((input.now.getTime() - oldest.getTime()) / 86_400_000));
  return { fires: true, unrouted, threshold, oldestDays };
}

export function buildSweepTitle(verdict: Extract<SweepVerdict, { fires: true }>): string {
  return `${verdict.unrouted} durable finding(s) recorded here have never reached the commons`;
}

export function buildSweepBody(input: {
  verdict: Extract<SweepVerdict, { fires: true }>;
  proposals: UnroutedProposal[];
  sampleSize?: number;
}): string {
  const { verdict } = input;
  const sample = input.proposals.slice(0, input.sampleSize ?? 20);
  const byLane = new Map<CommonsLane, number>();
  for (const p of input.proposals) {
    const { lane } = laneForProposal(p);
    byLane.set(lane, (byLane.get(lane) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(
    `${verdict.unrouted} improvement proposal(s) on this install still carry `
      + "`contributionStatus: \"local\"`. They were captured and never routed to a commons lane, "
      + `so no other installation can inherit them. The oldest is ${verdict.oldestDays} day(s) old.`,
  );
  lines.push("");
  lines.push(
    "This is not a backlog of bad findings. It is the measurement behind "
      + "`learnings-belong-in-the-shared-commons`: the rule is prose, nothing enforces it, and "
      + "knowledge stops at the install. Routing each one is a judgment call with a named lane, "
      + "so this sweep reports and never contributes on anyone's behalf.",
  );
  lines.push("");
  lines.push("## By lane");
  lines.push("");
  lines.push("| Lane | Findings | Governed route |");
  lines.push("|---|---:|---|");
  for (const lane of COMMONS_LANES) {
    const count = byLane.get(lane) ?? 0;
    if (count === 0) continue;
    const example = input.proposals.find((p) => laneForProposal(p).lane === lane)!;
    lines.push(`| \`${lane}\` | ${count} | ${laneForProposal(example).tool} |`);
  }
  lines.push("");
  lines.push(`## Oldest ${sample.length} of ${verdict.unrouted}`);
  lines.push("");
  for (const p of sample) {
    lines.push(`- \`${p.proposalId}\` (${laneForProposal(p).lane}, ${p.severity}) — ${p.title}`);
  }
  lines.push("");
  lines.push("## What closes this");
  lines.push("");
  lines.push(
    "Route them, or record why they should stay local. Then close this item — the sweep "
      + "files nothing while it is open and re-arms once it is closed, so it reports a standing "
      + "condition once rather than every week.",
  );
  lines.push("");
  lines.push(
    "Install-specific configuration correctly stays local and must NOT be routed: secrets, "
      + "host paths, hardware counts, compose project names.",
  );
  return lines.join("\n");
}

export type SweepStore = {
  improvementProposal: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
      select: Record<string, boolean>;
    }): Promise<UnroutedProposal[]>;
  };
};

export type SweepResult =
  | { filed: false; reason: "below-threshold"; unrouted: number }
  | { filed: true; itemId: string; created: boolean; unrouted: number };

/**
 * Read the unrouted population and file (or bump) the one standing item.
 *
 * `ingestBacklogItem` is injected so the test can prove the sweep fires on a
 * seeded case without a database, and so the dedupe behaviour under test is the
 * real one rather than a reimplementation.
 */
export async function runLocalOnlyKnowledgeSweep(input: {
  store: SweepStore;
  ingest: (args: {
    title: string;
    body: string;
    workType: string;
    source: string;
    itemIdPrefix: string;
    submittedById: null;
    agentId: string;
    scopeKind: string;
    scopeRationale: string;
    origin: { kind: string; id: string };
  }) => Promise<{ itemId: string; created: boolean }>;
  now?: Date;
  threshold?: number;
  max?: number;
}): Promise<SweepResult> {
  const now = input.now ?? new Date();
  const proposals = await input.store.improvementProposal.findMany({
    where: { contributionStatus: "local" },
    orderBy: { createdAt: "asc" },
    take: input.max ?? 500,
    select: {
      proposalId: true,
      title: true,
      category: true,
      severity: true,
      createdAt: true,
    },
  });

  const verdict = evaluateSweep({ proposals, now, threshold: input.threshold });
  if (!verdict.fires) {
    return { filed: false, reason: "below-threshold", unrouted: verdict.unrouted };
  }

  const result = await input.ingest({
    title: buildSweepTitle(verdict),
    body: buildSweepBody({ verdict, proposals }),
    workType: "chore",
    source: "automated-detection",
    itemIdPrefix: "LOK",
    submittedById: null,
    agentId: "local-only-knowledge-sweep",
    scopeKind: "platform",
    scopeRationale:
      "Every install accumulates findings; the routing rule is platform doctrine, not this install's habit.",
    origin: { ...LOCAL_ONLY_SWEEP_ORIGIN },
  });

  return { filed: true, itemId: result.itemId, created: result.created, unrouted: verdict.unrouted };
}

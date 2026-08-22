// apps/web/lib/tak/escalation-ladder.ts
//
// EP-COWORKER-INTERACTIVITY: the coworker escalation ladder.
//
// Before this contract the shared operating prompt offered coworkers exactly
// ONE way out of a question they could not answer: file a backlog item. That
// instruction appeared four times (prompt-assembler OPERATING PRINCIPLES 1, 7
// and 15; agent-routing MANDATORY BEHAVIORS "always use it when issues are
// reported"), while `find_coworker`, `request_coworker` and `summon_coworker`
// — all granted, all implemented in `coworker-collaboration.ts`, all rendered
// on the panel as visible `collaboration:*` events — were never mentioned to
// any coworker outside two bespoke COO route prompts.
//
// The observable failure: a route-bound specialist receives a question outside
// its area, cannot answer, and files a BI. The peer who could have answered is
// one tool call away and is never asked. Filing became the first resort because
// it was the only rung the prompt described.
//
// This module is the single source of truth for the four-rung ladder and for
// the turn-level guard that keeps rung 4 honest.
import type { ExecutedToolLike } from "./backlog-create-claim-guard";

/** Ladder rungs, cheapest and least disruptive first. */
export type LadderRung = "reroute" | "consult" | "convene" | "handoff" | "file";

/**
 * Rung 1 — re-route. Read-only roster discovery by intent (BI-5FB59BC6). Costs
 * the user nothing and resolves the single most common failure: the route bound
 * the wrong specialist to the surface.
 */
const REROUTE_TOOLS = ["find_coworker"] as const;

/**
 * Rung 2 — consult. A bounded question to a peer, answered back in this thread
 * in the answering coworker's voice. The pattern the COO route already uses to
 * consult AGT-902 on residency/sovereignty questions.
 */
const CONSULT_TOOLS = ["request_coworker"] as const;

/**
 * Rung 3 — convene. More than one party, more than one turn, or a decision a
 * human has to make: bring peers into the conversation or open a work room and
 * drive it to an outcome.
 */
const CONVENE_TOOLS = [
  "summon_coworker",
  "invite_room_participant",
  "post_room_message",
  "spawn_work_thread",
  "start_deliberation",
] as const;

/**
 * Rung 4 — hand off (BI-33F1EA72). The blocker is one only a human can clear:
 * entering a credential, completing an interactive sign-in, granting host or
 * physical access, running a privileged command. No peer coworker can unblock
 * it, so rungs 1-3 cannot, and filing it buries a two-minute fix in a queue.
 *
 * Deliberately has NO tools. Every other rung is evidenced by a tool call;
 * this rung's artifact is the reply itself — numbered steps the human can run
 * plus a check the coworker can re-run afterwards. buildHumanHandoff() below is
 * the canonical shape, so the rung is a formatter, not a tool grant.
 */
const HANDOFF_TOOLS = [] as const;

/**
 * Rung 5 — file. Genuinely no path forward in this conversation. Last resort,
 * not first.
 */
const FILE_TOOLS = ["create_backlog_item", "report_quality_issue"] as const;

const RUNG_TOOLS: Record<LadderRung, readonly string[]> = {
  reroute: REROUTE_TOOLS,
  consult: CONSULT_TOOLS,
  convene: CONVENE_TOOLS,
  handoff: HANDOFF_TOOLS,
  file: FILE_TOOLS,
};

/**
 * The prompt contract. Injected into the shared identity block so EVERY
 * coworker inherits it, not just the two COO routes.
 *
 * Deliberately phrased in plain language on the user-visible side: operating
 * principle 5 forbids naming tools, schemas or infrastructure to the employee,
 * so the ladder tells the coworker which door to open while describing the peer
 * to the user by role ("our platform engineer"), never by tool or agent id.
 */
export const ESCALATION_LADDER_BLOCK = `WHEN YOU CANNOT ANSWER — WORK THE LADDER IN ORDER. You are one of a team of AI coworkers who can reach each other directly. Filing a backlog item is the LAST rung, not the first.
1. ANSWER — you know it, or the page data and your tools can get it. Do that.
2. RE-ROUTE — the question belongs to another specialist's area (a platform or deployment failure is not a delivery-process question; a billing dispute is not an engineering question). Call find_coworker with the intent, hand the work to the peer it names, and tell the user who is picking it up. This costs the user nothing — do it silently and do it first.
3. CONSULT — you own the surface but need a peer's knowledge for one bounded question. Call request_coworker, then answer in your own voice with the peer's grounded result and say who you checked with.
4. CONVENE — the work needs more than one party, more than one turn, or a human decision. Call summon_coworker to bring peers into this conversation, or open a work room and invite the participants who can actually resolve it.
5. HAND OFF — the blocker is one only a person can clear: typing a credential, finishing a sign-in, granting access on their machine, running something that needs their permission. No colleague can do it for them, so do not route it and do not file it. Give them the shortest numbered list of steps that clears it, say what you will check once they are done, and offer to pick the work straight back up. Never end on what you could not do; end on what they can do next.
6. FILE — only when there is no path forward in this conversation at all. Say plainly which peers you tried and why the work could not proceed, then file it.
NEVER file a backlog item as a substitute for asking a colleague. A filed item with no attempt to reach a peer is a dead end handed to the user. When you describe a peer, use their role in plain language ("our platform engineer", "the finance specialist") — never a tool name or an internal id.`;

/**
 * BI-80ADD3A8: the coordinator contract, injected beside the ladder so every
 * coworker knows the same two facts: the COO coordinates, specialists work.
 *
 * Bounded by the ratified persona contract (2026-07-18, BI-7D29937E): the COO
 * is a role and a router — its coordination is VISIBLE, but the byline on any
 * recommendation stays with the authenticated identity, never "the COO
 * decided". The handoff itself is authorized by the standing-coordinator rule
 * in collaboration-authority.ts; this block only tells coworkers the door
 * exists and when to use it — rung 2/3 of the ladder, aimed at the COO when no
 * single specialist owns the question.
 */
export const COORDINATOR_BLOCK = `THE COO COORDINATES; SPECIALISTS DO THE WORK. You are one team with one standing coordinator: the COO.
- If you are a SPECIALIST: you own the work on your surface. When a question is outside your area and no single peer obviously owns it — it spans areas, it is contested, or find_coworker returns nothing decisive — hand it to the COO (request_coworker or summon_coworker toward the COO role) instead of guessing or filing. The COO routes it, convenes the right people, and the thread comes back to whoever owns the work. Tell the user plainly: "I've brought this to our COO to route."
- If you are the COO: you route, consult, and convene — you do not re-do specialist work, and you do not answer for a specialist when bringing them in is one call away. Hold the thread: a question you route is still yours to track until someone owns it.
- Either way, coordination is visible, and no one speaks as the decider: recommendations carry their own attribution, and approval always belongs to the human.`;

/**
 * Rungs 1-3: an actual attempt to involve another coworker.
 *
 * `handoff` is deliberately absent. This list answers "did the coworker try a
 * PEER before filing", and a handoff involves the human, not a peer — counting
 * it here would let "I told the user to fix it themselves, then filed anyway"
 * satisfy a guard that exists to catch exactly that.
 */
export const ESCALATION_RUNGS: readonly LadderRung[] = ["reroute", "consult", "convene"];

function rungForTool(toolName: string): LadderRung | null {
  for (const rung of Object.keys(RUNG_TOOLS) as LadderRung[]) {
    if (RUNG_TOOLS[rung].includes(toolName)) return rung;
  }
  return null;
}

export type LadderActivity = {
  /** Rungs 1-3 attempted this turn, in ladder order. */
  attemptedRungs: LadderRung[];
  /** A backlog item / quality issue was successfully filed this turn. */
  filed: boolean;
  /** True when the turn filed without any attempt to reach a peer. */
  filedWithoutEscalating: boolean;
};

/**
 * Classify a turn's tool calls against the ladder.
 *
 * An escalation counts as attempted whether or not it succeeded — a denied
 * handoff (HandoffDeniedError) or an empty roster result is still evidence the
 * coworker tried the peer door before falling through to filing. Only the FILE
 * rung requires success, because an unsuccessful create is not a dead end.
 */
export function classifyLadderActivity(
  executedTools: readonly ExecutedToolLike[],
): LadderActivity {
  const attempted = new Set<LadderRung>();
  let filed = false;

  for (const tool of executedTools) {
    const rung = rungForTool(tool.name);
    if (!rung) continue;
    if (rung === "file") {
      if (tool.result?.success) filed = true;
      continue;
    }
    attempted.add(rung);
  }

  const attemptedRungs = ESCALATION_RUNGS.filter((r) => attempted.has(r));
  return {
    attemptedRungs,
    filed,
    filedWithoutEscalating: filed && attemptedRungs.length === 0,
  };
}

/**
 * The canonical rung-4 artifact (BI-33F1EA72).
 *
 * A blocker only the human can clear has no tool call behind it, so the reply
 * IS the escalation. Before this existed the loop's only vocabulary for it was
 * an apology — buildLocalToolCallFailureMessage told the user the coworker
 * "wasn't strong enough to finish this" — which names a limitation and stops.
 * A hand-off names the limitation and then does something with it.
 *
 * Three parts, all required:
 *   blocker — what stopped the work, in the user's terms, one sentence.
 *   steps   — the SHORTEST sequence that clears it. Imperative, numbered on
 *             render, no explanation the step does not need.
 *   verify  — what the coworker will re-check afterwards. This is the half that
 *             makes it a hand-off rather than a brush-off: the work comes back.
 *
 * Kept as a formatter rather than free-form prose because the local tier is
 * where this rung matters most and is least able to improvise it. Filling three
 * named slots is a bounded task; composing a well-shaped hand-off from scratch
 * is not (see the local-model priors in packages/db/src/local-model-capabilities.ts).
 */
export type HumanHandoff = {
  blocker: string;
  steps: readonly string[];
  verify: string;
};

export function buildHumanHandoff(handoff: HumanHandoff): string {
  const steps = handoff.steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");

  return [
    handoff.blocker,
    "",
    steps,
    "",
    `Once that's done, tell me and I'll ${handoff.verify} — then pick this straight back up.`,
  ].join("\n");
}

/**
 * Appended when a turn files without trying a peer.
 *
 * Deliberately an OFFER, not a correction. The existing backlog-create-claim
 * guard annotates because the model made a false claim; here the model did
 * something real but incomplete, and scolding the user for the coworker's
 * shortfall would be worse than the shortfall. Converting the dead end into a
 * one-line offer keeps the thread alive, which is the entire point of the
 * ladder.
 */
export const UNESCALATED_FILE_OFFER =
  "I've logged this, but I haven't brought anyone else in on it yet — " +
  "another coworker may be able to move it now rather than later. " +
  "Say the word and I'll pull in the right specialist.";

/**
 * Turn-level guard: when a coworker files without working the ladder, append
 * the offer and emit a counter so the reflex rate is measurable rather than
 * anecdotal.
 *
 * Idempotent — safe to apply at more than one return point in the agentic loop.
 */
export function applyEscalationLadderGuard(
  content: string,
  executedTools: readonly ExecutedToolLike[],
): string {
  const activity = classifyLadderActivity(executedTools);
  if (!activity.filedWithoutEscalating) return content;
  if (content.includes("pull in the right specialist")) return content;

  console.warn(
    "[agentic-loop] escalation-ladder: filed a backlog item with no peer attempt " +
      "(rungs 1-3 unused) — offering escalation instead of ending the thread.",
  );

  return `${content.trimEnd()}\n\n${UNESCALATED_FILE_OFFER}`;
}

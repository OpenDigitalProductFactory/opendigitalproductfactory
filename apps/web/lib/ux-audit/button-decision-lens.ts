// Coworker button-decision lens (EP-UX-AUDITOR Phase 2, BI-C3768478).
//
// This is the founder's standing requirement made executable: the coworker
// button-decision interface (BI-3237B5D6) is validated as ONE LENS INSIDE a
// comprehensive portal survey, not spot-checked in isolation. The Phase-1
// orchestrator defines `BUTTON_DECISION_LENS`; this module is its verdict logic,
// and the e2e runner supplies the live observation by driving a real coworker.
//
// Pure by construction — the browser half lives in the runner, so the rules that
// decide pass/fail are unit-testable and identical whether the observation came
// from Playwright, browser-use, or a replayed transcript.
//
// The rule the lens enforces (spec §5.3 + the decision-block contract):
//   when a coworker's turn ENDS on a next-step decision, the human must get
//   clickable, recommended-first buttons — not a free-text "type your reply".
// Both carrier paths count as a pass: the HTML-comment sentinel AND the
// deterministic prose fallback (`deriveDecisionFromProse`). The lens does not
// care which produced the buttons; it cares that buttons rendered.

import type { UxFinding } from "@/lib/tak/page-evaluator";
import {
  deriveDecisionFromProse,
  parseDecisionFromContent,
} from "@/lib/tak/decision-block";

/** One rendered decision button as observed in the live DOM. */
export type ObservedDecisionButton = {
  label: string;
  recommended: boolean;
};

/**
 * What the runner observed after driving the coworker to a closeout. `reply` is
 * the human-visible text of the coworker's last message (the sentinel is already
 * stripped by the renderer, exactly as a human sees it).
 */
export type ButtonDecisionObservation = {
  route: string;
  /** Whether the coworker panel was reachable at all. */
  panelPresent: boolean;
  /** Last assistant message text, as rendered. */
  reply: string;
  /** Buttons in DOM order — the order the human reads them. */
  buttons: ObservedDecisionButton[];
  /** Which carrier the runner attributed the buttons to, when known. */
  carrier?: "sentinel" | "prose-fallback" | "none";
};

const FINDING_ELEMENT = '[data-testid="agent-decision"]';

/**
 * The user-facing messages the panel renders when inference never happened —
 * provider saturation, routing failure, a degraded local engine.
 *
 * These matter because they are the silent-pass trap: such a reply is not a
 * decision closeout, so the lens would emit NO finding and the route would read
 * as "coworker offered no decision, nothing wrong". That is a NOT-RUN wearing a
 * pass's clothes. Observed live 2026-08-04, when the local engine hit admission
 * timeouts and the coworker answered "The AI providers are momentarily busy".
 */
const INFERENCE_FAILURE_RE =
  /\b(AI providers are momentarily busy|rate.?limited or overloaded|no eligible endpoints|all endpoints failed|inference admission timeout|try again in about \d+ seconds|I cannot proceed|my tools are limited)\b/i;

/** Did the panel render an inference-failure notice instead of a real turn? */
export function isInferenceFailureReply(reply: string): boolean {
  return INFERENCE_FAILURE_RE.test(reply);
}

/**
 * Does this reply END on a decision the human must answer? Two signals, both
 * conservative:
 *  - the deterministic prose fallback recognizes an enumerated choice, or
 *  - the reply closes on a direct question (the proceed-case: "Shall I go ahead?").
 * A reply that merely CONTAINS a question mark mid-paragraph does not count —
 * a wrong finding is worse than no finding, same guard as the fallback itself.
 */
export function isDecisionCloseout(reply: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed) return false;
  if (deriveDecisionFromProse(trimmed)) return true;
  return /\?\s*$/.test(trimmed);
}

/**
 * Classify which carrier SHOULD have produced buttons for this reply. Used to
 * attribute a miss precisely: a sentinel that never rendered is a different
 * defect from a prose closeout the fallback failed to recover.
 */
export function expectedCarrier(rawReply: string): "sentinel" | "prose-fallback" | "none" {
  if (rawReply.includes("dpf-decision")) {
    const { decision } = parseDecisionFromContent(rawReply);
    if (decision) return "sentinel";
  }
  if (deriveDecisionFromProse(rawReply)) return "prose-fallback";
  return "none";
}

/**
 * Evaluate one live observation into findings. Empty array = the lens passed:
 * the coworker closed on a decision and recommended-first buttons rendered.
 */
export function evaluateButtonDecision(
  observation: ButtonDecisionObservation,
): UxFinding[] {
  const findings: UxFinding[] = [];

  if (!observation.panelPresent) {
    findings.push({
      severity: "critical",
      category: "semantic-html",
      element: '[data-agent-panel="true"]',
      issue:
        "No AI-coworker panel was reachable on this route, so the human has no way to ask for or answer a next-step decision.",
      recommendation:
        "Mount the coworker panel on this route, or remove the route from the coworker-bearing set the survey plans behavioral lenses for.",
    });
    return findings;
  }

  const reply = observation.reply.trim();

  if (!reply) {
    findings.push({
      severity: "critical",
      category: "semantic-html",
      element: '[data-agent-panel="true"]',
      issue:
        "The coworker produced no visible reply, so the button-decision lens could not observe a closeout. This is a NOT-RUN, not a pass.",
      recommendation:
        "Check the coworker's model routing and tool grants for this route; the lens needs a completed turn to judge.",
    });
    return findings;
  }

  if (isInferenceFailureReply(reply)) {
    findings.push({
      severity: "critical",
      category: "semantic-html",
      element: '[data-agent-panel="true"]',
      issue: `The coworker returned an inference-failure notice instead of a turn, so the button-decision lens could not observe a closeout. This is a NOT-RUN, not a pass. Reply: "${reply.slice(0, 160)}"`,
      recommendation:
        "Re-run the lens once inference is healthy. If it persists, check the route's model routing and the local engine's admission queue — a saturated engine makes every behavioral lens silently unmeasurable.",
    });
    return findings;
  }

  const closeout = isDecisionCloseout(reply);
  const buttons = observation.buttons;

  if (buttons.length === 0) {
    if (!closeout) return findings; // No decision was offered — nothing to render.

    findings.push({
      severity: "important",
      category: "semantic-html",
      element: FINDING_ELEMENT,
      issue:
        "The coworker ended its turn on a next-step decision but rendered no decision buttons — the human must retype the answer as free text.",
      recommendation:
        "Emit the <!--dpf-decision:...--> sentinel on decision closeouts. If the model omits it, the deterministic prose fallback (deriveDecisionFromProse) should recover the options; extend it for this closeout shape.",
    });
    return findings;
  }

  // Buttons rendered — now judge their SHAPE. Recommended-first is the contract:
  // the primary action must be the one the human reads first.
  const recommendedIndex = buttons.findIndex((b) => b.recommended);

  if (recommendedIndex === -1) {
    findings.push({
      severity: "minor",
      category: "semantic-html",
      element: FINDING_ELEMENT,
      issue: `${buttons.length} decision buttons rendered but none is marked recommended, so no option carries primary emphasis.`,
      recommendation:
        "Mark exactly one option `recommended: true` so it renders as the accent-tinted primary button.",
    });
  } else if (recommendedIndex > 0) {
    findings.push({
      severity: "minor",
      category: "semantic-html",
      element: FINDING_ELEMENT,
      issue: `The recommended option renders in position ${recommendedIndex + 1} of ${buttons.length}; the recommendation is not what the human reads first.`,
      recommendation:
        "Order the options so the recommended one is first — the button-decision contract is recommended-FIRST, not merely recommended-somewhere.",
    });
  }

  const unlabeled = buttons.filter((b) => !b.label.trim()).length;
  if (unlabeled > 0) {
    findings.push({
      severity: "important",
      category: "accessibility",
      element: FINDING_ELEMENT,
      issue: `${unlabeled} decision button(s) rendered with no accessible label.`,
      recommendation:
        "Every decision option needs a non-empty label — it is both the button text and its accessible name (WCAG 4.1.2).",
      wcagRef: "4.1.2 Name, Role, Value",
    });
  }

  return findings;
}

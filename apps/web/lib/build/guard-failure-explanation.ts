/**
 * Make a guard-gauntlet failure legible and actionable to a non-developer
 * (BI-9A09BE70).
 *
 * The gauntlet slices made the in-platform path as SAFE as an external agent's.
 * This is the slice that makes it USABLE by the person it is for, and without it
 * those slices produce a path that is rigorous and unusable — which is worse than
 * the status quo, because it fails people late and confidently.
 *
 * The target user is not a developer, and the guards do not speak to them.
 * Verbatim, from a real run:
 *
 *     Module-size ratchet failed (BI-OPT-RATCHETS).
 *     Baselined files that GREW — the baseline only allows shrinking:
 *       - apps/web/lib/tak/agentic-loop.ts (2642 -> 2680)
 *     Reduce the file, or if the growth is unavoidable and intentional, justify it
 *     and run `node scripts/check-module-size.mjs --update` to re-baseline.
 *
 * An engineer reads that and knows the options. A non-developer stops, and
 * stopping there is the flywheel not turning.
 *
 * Two rules this module holds to:
 *
 * 1. **Never replace the evidence.** The translation fronts the raw output; it
 *    does not discard it. Whoever does read guard output still needs it.
 * 2. **Never fabricate an explanation.** An unrecognised guard degrades to the
 *    raw output plus an honest "a maintainer needs to look at this". A
 *    confidently wrong translation is worse than the raw text, because the raw
 *    text at least signals "this is for someone else".
 */

/** Who can act on this failure. */
export type GuardRemedyOwner =
  /** The person who asked for the change can resolve it themselves. */
  | "self-serve"
  /** It needs someone who works on the platform. Handing this back cleanly is a good outcome. */
  | "maintainer";

export type GuardExplanation = {
  /** The guard name as the gauntlet reported it. */
  guard: string;
  /** Whether this module actually knows this guard. */
  recognized: boolean;
  remedy: GuardRemedyOwner;
  /** What happened, in the reader's terms — not which script exited non-zero. */
  what: string;
  /** Something the reader can do, in the product. Never a shell command. */
  nextAction: string;
};

/**
 * The decision gates.
 *
 * These are the guards a non-developer genuinely CAN answer, because they ask
 * about the INTENT of the change rather than the shape of the code: does this
 * change what users see, does it touch stored data, does it need a document
 * updating. The person who asked for the change is in fact the best-placed
 * person to answer, so routing these to a maintainer would be both wrong and
 * wasteful.
 *
 * Keyed by the guard's reported NAME because that is what the gauntlet parses
 * out of the failure summary. The registry's stable ids are carried alongside as
 * a comment so the pairing can be re-checked against `pregate-preflight --plan`.
 */
const DECISION_GATES: Record<string, { what: string; nextAction: string }> = {
  // docs-impact-gate
  "Docs Impact Gate": {
    what: "This change affects something people read — a user-facing document, a guide, or an instruction another coworker follows — and nothing says which.",
    nextAction: "Say whether this change needs a document updated, and which one. If it genuinely needs none, say that and why.",
  },
  // data-impact-gate
  "Data-Impact Gate": {
    what: "This change may affect stored information, and nothing records what happens to data that already exists.",
    nextAction: "Say whether existing records are affected. If nothing stored changes shape, say so.",
  },
  // convergence-impact-gate
  "Convergence-Impact Gate": {
    what: "Nothing records how this change reaches installations that are already running.",
    nextAction: "Say whether this arrives on its own with the next update, or whether someone has to do something.",
  },
  // design-grounding-gate
  "Design Grounding Gate": {
    what: "This change touches how the product behaves, and nothing names the design it follows.",
    nextAction: "Point at the design or decision this follows. If it is a small correction that changes no agreed behaviour, say that.",
  },
  // docs-impact-gate sibling
  "Spec/Plan/Doc Gate": {
    what: "This change adds something new to the product, and new things are expected to come with a written description.",
    nextAction: "Describe what was added and why, or say that it is too small to need its own document.",
  },
  // seed-fit-gate
  "Seed Contribution Fit Gate": {
    what: "This change touches content that every installation starts with, and nothing records whether it should apply to all of them.",
    nextAction: "Say whether this belongs to every business on the platform, only to businesses like yours, or only to this installation.",
  },
  // ux-fit-gate
  "UX-Fit Gate": {
    what: "This change affects a screen, and nothing records how it was checked against how people actually use it.",
    nextAction: "Describe what you looked at on the screen and what you expected to see.",
  },
};

/**
 * Guards whose failure is a fact about the CODE rather than about intent.
 *
 * Listed explicitly so the reason handed back is specific rather than a shrug.
 * Everything not named here still routes to a maintainer — the default is
 * deliberately the cautious one, because telling someone a problem is theirs to
 * fix when it is not costs them an hour before they find out.
 */
const MAINTAINER_GUARDS: Record<string, string> = {
  "Module Size Guard": "This change makes a file that is already too large grow further. Splitting it up is a judgement about how the code is organised.",
  "Prose Lint Guard": "Wording in a tracked document does not match the house style rules.",
  "UX Primitive Adoption Guard": "The screen change builds its own version of something the product already has a standard piece for.",
  "New Dependency Gate": "This change pulls in outside software, which needs review before it can be accepted.",
  "Docs Link Integrity": "A link in a document points at something that does not exist.",
  "Doc Anchor Existence": "A reference points at a section of a document that is not there.",
  "Doc Reference Integrity": "A document refers to something that cannot be found.",
};

const UNRECOGNISED_WHAT =
  "An automated check refused this change, and this is not one of the checks the product can yet explain in plain terms.";
const UNRECOGNISED_NEXT =
  "Hand this to a maintainer with the detail below. The wording is written for someone who works on the platform.";

/**
 * Explain one guard failure.
 *
 * Pinned to the guard's identity, never to its prose: guard output is not a
 * stable contract and will drift, while the registry name is the thing the
 * gauntlet actually reports.
 */
export function explainGuardFailure(guardName: string): GuardExplanation {
  const name = guardName.trim();

  const decision = DECISION_GATES[name];
  if (decision) {
    return { guard: name, recognized: true, remedy: "self-serve", ...decision };
  }

  const maintainerReason = MAINTAINER_GUARDS[name];
  if (maintainerReason) {
    return {
      guard: name,
      recognized: true,
      remedy: "maintainer",
      what: maintainerReason,
      nextAction: "Hand this to a maintainer. It is not something to resolve from here.",
    };
  }

  return {
    guard: name,
    recognized: false,
    remedy: "maintainer",
    what: UNRECOGNISED_WHAT,
    nextAction: UNRECOGNISED_NEXT,
  };
}

export type GauntletFailureBriefing = {
  /** One line for the top of the surface. */
  headline: string;
  explanations: GuardExplanation[];
  /** True when at least one failure is the reader's to resolve. */
  anySelfServe: boolean;
  /** True when at least one failure needs a maintainer. */
  needsMaintainer: boolean;
  /** Preserved verbatim. Translation fronts the evidence, never replaces it. */
  rawOutput: string;
};

/**
 * Turn a failed gauntlet run into something a non-developer can act on.
 *
 * The headline leads with what the reader can do, because that is the decision
 * they are facing. When everything needs a maintainer, saying so plainly is the
 * useful answer — a clean handoff is a good outcome, not a failure of this
 * feature.
 */
export function explainGauntletFailure(input: {
  failedGuards: readonly string[];
  output: string;
}): GauntletFailureBriefing {
  const explanations = input.failedGuards.map(explainGuardFailure);
  const anySelfServe = explanations.some((entry) => entry.remedy === "self-serve");
  const needsMaintainer = explanations.some((entry) => entry.remedy === "maintainer");

  const count = explanations.length;
  const noun = count === 1 ? "check" : "checks";

  let headline: string;
  if (count === 0) {
    // Defensive: a failure with no named guard is a crash, which the gauntlet
    // already reports as not-run. Never invent a guard to explain.
    headline = "Verification did not pass, and it did not say which check refused. A maintainer needs to look at this.";
  } else if (anySelfServe && !needsMaintainer) {
    headline = `${count} ${noun} need an answer from you before this change can go out.`;
  } else if (anySelfServe && needsMaintainer) {
    headline = `${count} ${noun} refused this change. Some need an answer from you; the rest need a maintainer.`;
  } else {
    headline = `${count} ${noun} refused this change, and all of them need a maintainer. Nothing here is yours to fix.`;
  }

  return { headline, explanations, anySelfServe, needsMaintainer, rawOutput: input.output };
}

/**
 * Escalation Gate CONFORMANCE (BI-6B3DA9DD).
 *
 * The founder's rule is enforced by `resolveEscalation`, not by prose. This is
 * what stops it drifting back into prose, and it runs in the existing test job
 * on every PR rather than as a new CI job nobody wires up:
 *
 *   1. EXHAUSTIVE DOMAIN PROOF. The gate's input space is closed and small, so
 *      this walks EVERY combination. The load-bearing property: the gate may
 *      only REMOVE escalations, never add one the retired tier-only rule did
 *      not already make — proved against that rule, encoded below. A fix for
 *      over-escalation that introduced new approval envelopes would be the
 *      same defect wearing the opposite coat. Walking the whole domain
 *      subsumes a per-tool table: no future tool shape can slip a human step
 *      back in, because every shape a tool could have is already covered.
 *   2. WIRING. The authority evaluator must decide through the gate, and must
 *      no longer mint an envelope from the acting coworker's HITL tier alone.
 *   3. THE PRINCIPLE FOLLOWS THE PROCESS. The kernel principle page must state
 *      exactly the sentences the gate exports, so what an agent reads and what
 *      the platform enforces cannot disagree on any install.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DAMAGING_SENSITIVITIES,
  describeEscalationRule,
  ESCALATION_STEERING,
  resolveEscalation,
  type EscalationInput,
} from "./escalation-gate";

// `new URL(...).pathname` returns "/D:/..." on Windows and breaks readFileSync.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const PRINCIPLE_PATH = join(
  REPO_ROOT,
  "docs/founder-kernel/wiki/principles/escalation-is-a-gate-not-a-trust-tier.md",
);
const EVALUATOR_PATH = join(HERE, "coworker-authority-decision.ts");

const CONSEQUENCES = [null, "outward", "irreversible", "authority"] as const;
const SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
const EXECUTION_MODES = ["immediate", "proposal"] as const;

/**
 * The rule the platform ran BEFORE this gate: a proposal escalates, a read
 * never does, and otherwise the acting coworker's HITL-derived approval policy
 * alone decided. Encoded so the walk can prove the new rule adds nothing.
 */
function retiredTierOnlyRule(shape: {
  sideEffect: boolean;
  executionMode: "proposal" | "immediate";
  operatorRequiresApproval: boolean;
}): "automated" | "human" {
  if (shape.executionMode === "proposal") return "human";
  if (!shape.sideEffect) return "automated";
  return shape.operatorRequiresApproval ? "human" : "automated";
}

type Case = { input: EscalationInput; damaging: boolean; shape: string };

function everyCase(): Case[] {
  const cases: Case[] = [];
  for (const sideEffect of [true, false]) {
    for (const executionMode of EXECUTION_MODES) {
      for (const consequence of CONSEQUENCES) {
        for (const workCaseConsequential of [true, false]) {
          for (const sensitivity of SENSITIVITIES) {
            for (const steering of ESCALATION_STEERING) {
              for (const operatorRequiresApproval of [true, false]) {
                cases.push({
                  input: {
                    action: { sideEffect, executionMode, consequence, workCaseConsequential },
                    dataPolicy: { sensitivity },
                    operatorRequiresApproval,
                    steering,
                  },
                  damaging:
                    workCaseConsequential
                    || consequence !== null
                    || (DAMAGING_SENSITIVITIES as readonly string[]).includes(sensitivity),
                  shape:
                    `sideEffect=${sideEffect} mode=${executionMode} consequence=${consequence} `
                    + `workCase=${workCaseConsequential} sensitivity=${sensitivity} `
                    + `steering=${steering} operatorRequiresApproval=${operatorRequiresApproval}`,
                });
              }
            }
          }
        }
      }
    }
  }
  return cases;
}

const CASES = everyCase();

describe("escalation gate conformance — exhaustive domain proof", () => {
  it("covers the gate's entire input space", () => {
    expect(CASES.length).toBe(
      2 * 2 * CONSEQUENCES.length * 2 * SENSITIVITIES.length * ESCALATION_STEERING.length * 2,
    );
  });

  it("only ever REMOVES an escalation, never adds one", () => {
    const added = CASES.filter(({ input, shape }) => {
      const retired = retiredTierOnlyRule({
        sideEffect: input.action.sideEffect,
        executionMode: input.action.executionMode,
        operatorRequiresApproval: input.operatorRequiresApproval,
      });
      return resolveEscalation(input).verdict === "human" && retired === "automated"
        ? shape
        : false;
    });
    expect(added).toEqual([]);
  });

  it("removes exactly the wrong escalations: non-damaging, steered side effects", () => {
    const removed = CASES.filter(({ input }) => {
      const retired = retiredTierOnlyRule({
        sideEffect: input.action.sideEffect,
        executionMode: input.action.executionMode,
        operatorRequiresApproval: input.operatorRequiresApproval,
      });
      return retired === "human" && resolveEscalation(input).verdict === "automated";
    });
    expect(removed.length).toBeGreaterThan(0);
    for (const { input, damaging } of removed) {
      expect(damaging).toBe(false);
      expect(input.steering).not.toBe("none");
      expect(input.action.sideEffect).toBe(true);
      expect(input.action.executionMode).toBe("immediate");
      expect(input.operatorRequiresApproval).toBe(true);
    }
  });

  it("keeps a damaging action in front of a person wherever it escalated before", () => {
    const leaked = CASES.filter(
      ({ input, damaging, shape }) =>
        damaging
        && input.operatorRequiresApproval
        && input.action.sideEffect
        && input.action.executionMode === "immediate"
        && resolveEscalation(input).verdict !== "human"
        && shape,
    );
    expect(leaked).toEqual([]);
  });

  it("never escalates an immediate read", () => {
    const escalated = CASES.filter(
      ({ input }) =>
        !input.action.sideEffect
        && input.action.executionMode === "immediate"
        && resolveEscalation(input).verdict === "human",
    );
    expect(escalated).toEqual([]);
  });

  it("records a damage classification that matches the rule", () => {
    for (const { input, damaging, shape } of CASES) {
      expect(resolveEscalation(input).damaging, shape).toBe(damaging);
    }
  });
});

describe("escalation gate conformance — wiring", () => {
  const evaluator = readFileSync(EVALUATOR_PATH, "utf8");

  it("decides escalation through the gate", () => {
    expect(evaluator).toContain("resolveEscalation(");
  });

  it("no longer mints an envelope from the acting coworker's trust tier alone", () => {
    expect(evaluator).not.toMatch(
      /return input\.action\.approvalPolicy === "all"\s*\n?\s*\|\| input\.action\.approvalPolicy === "side-effects";/,
    );
  });
});

describe("escalation gate conformance — the principle follows the process", () => {
  it("states every rule the gate enforces, verbatim", () => {
    const principle = readFileSync(PRINCIPLE_PATH, "utf8");
    const missing = describeEscalationRule().filter((rule) => !principle.includes(rule));
    expect(missing).toEqual([]);
  });
});

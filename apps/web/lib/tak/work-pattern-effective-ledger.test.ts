import { describe, expect, it } from "vitest";

import {
  resolveEffectiveWorkPatternLedger,
  validateWorkPatternPromotionPair,
} from "./work-pattern-effective-ledger";

describe("resolveEffectiveWorkPatternLedger", () => {
  it("keeps append-only corrections and resolves the effective tail", () => {
    const rows = [
      { ledgerId: "L1", metadata: {} },
      {
        ledgerId: "L2",
        metadata: { supersedesLedgerId: "L1", invalidationReason: "oracle correction" },
      },
      {
        ledgerId: "L3",
        metadata: { supersedesLedgerId: "L2", invalidationReason: "review correction" },
      },
      { ledgerId: "L4", metadata: {} },
    ];

    expect(resolveEffectiveWorkPatternLedger(rows).map((row) => row.ledgerId)).toEqual([
      "L3",
      "L4",
    ]);
    expect(rows).toHaveLength(4);
  });

  it("fails closed for dangling supersession references", () => {
    expect(() =>
      resolveEffectiveWorkPatternLedger([
        {
          ledgerId: "L2",
          metadata: { supersedesLedgerId: "missing", invalidationReason: "correction" },
        },
      ]),
    ).toThrow("work_pattern_ledger_dangling_reference:missing");
  });

  it("detects supersession cycles", () => {
    expect(() =>
      resolveEffectiveWorkPatternLedger([
        {
          ledgerId: "L1",
          metadata: { supersedesLedgerId: "L2", invalidationReason: "one" },
        },
        {
          ledgerId: "L2",
          metadata: { supersedesLedgerId: "L1", invalidationReason: "two" },
        },
      ]),
    ).toThrow("work_pattern_ledger_supersession_cycle");
  });

  it("fails closed when two corrections fork from the same evidence row", () => {
    expect(() =>
      resolveEffectiveWorkPatternLedger([
        { ledgerId: "L1", metadata: {} },
        {
          ledgerId: "L2",
          metadata: { supersedesLedgerId: "L1", invalidationReason: "first correction" },
        },
        {
          ledgerId: "L3",
          metadata: { supersedesLedgerId: "L1", invalidationReason: "second correction" },
        },
      ]),
    ).toThrow("work_pattern_ledger_ambiguous_supersession");
  });
});

describe("validateWorkPatternPromotionPair", () => {
  const completedCell = {
    cellKey: "method-a:model-a",
    fixtureKey: "fixture-1",
    sourceCommitSha: "abc123",
    taskCorpusKey: "corpus",
    taskCorpusVersion: "1",
    oracleKey: "oracle",
    oracleVersion: "1",
    resourcePolicyKey: "bounded-default",
    status: "completed" as const,
    budgetUsed: 10,
    budgetLimit: 20,
  };

  it("accepts evidence-cleared, comparable terminal cells", () => {
    expect(
      validateWorkPatternPromotionPair({
        requiredCellKeys: [completedCell.cellKey],
        left: [completedCell],
        right: [{ ...completedCell, cellKey: "method-b:model-a" }],
      }),
    ).toEqual({ valid: true, reasons: [] });
  });

  it.each([
    ["missing", [], ["missing_required_cell"]],
    [
      "blocked",
      [{ ...completedCell, status: "blocked" as const }],
      ["non_terminal_required_cell"],
    ],
    [
      "cancelled",
      [{ ...completedCell, status: "canceled" as const }],
      ["non_terminal_required_cell"],
    ],
    [
      "budget-skewed",
      [{ ...completedCell, budgetUsed: 40 }],
      ["resource_budget_exceeded"],
    ],
  ])("invalidates %s cells without erasing their evidence", (_name, right, reasons) => {
    expect(
      validateWorkPatternPromotionPair({
        requiredCellKeys: [completedCell.cellKey],
        left: [completedCell],
        right,
      }),
    ).toEqual({ valid: false, reasons });
  });

  it("rejects pairs that differ in fixture, source, corpus, oracle, or resource policy", () => {
    const result = validateWorkPatternPromotionPair({
      requiredCellKeys: [completedCell.cellKey],
      left: [completedCell],
      right: [
        {
          ...completedCell,
          fixtureKey: "fixture-2",
          sourceCommitSha: "different",
          taskCorpusVersion: "2",
          oracleVersion: "2",
          resourcePolicyKey: "unbounded",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual([
      "fixture_mismatch",
      "source_commit_mismatch",
      "corpus_mismatch",
      "oracle_mismatch",
      "resource_policy_mismatch",
    ]);
  });
});

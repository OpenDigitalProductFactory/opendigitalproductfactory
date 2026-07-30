import { describe, expect, it } from "vitest";

import { purposeContractSourceSchema } from "../page-purpose";
import { SELF_UPGRADE_PURPOSE_CONTRACT } from "./self-upgrade";

describe("SELF_UPGRADE_PURPOSE_CONTRACT", () => {
  it("is a ratified contract source with every route-owned state", () => {
    const parsed = purposeContractSourceSchema.parse(
      SELF_UPGRADE_PURPOSE_CONTRACT,
    );

    expect(parsed.status).toBe("intent-ratified");
    if (parsed.status !== "intent-ratified") return;
    expect(Object.keys(parsed.stateScenarios)).toEqual([
      "update-available",
      "queued-or-running",
      "current",
      "failed-recoverable",
      "blocked",
    ]);
    expect(parsed.intent.contentRoles.defaultVisibleKeys).toEqual([
      "current-state",
      "impact-on-work",
      "next-action",
      "recovery-status",
    ]);
    expect(parsed.consequentialAction).toBeDefined();
    expect(parsed.aiMediated).toBeUndefined();
  });

  it("starts task validation from the operator's natural home", () => {
    expect(SELF_UPGRADE_PURPOSE_CONTRACT.taskProtocol.startRoute).not.toBe(
      "/ops/self-upgrade",
    );
    expect(
      SELF_UPGRADE_PURPOSE_CONTRACT.taskProtocol.falseSuccessConditions,
    ).toContain("The update is queued but never reaches a terminal healthy state.");
  });
});

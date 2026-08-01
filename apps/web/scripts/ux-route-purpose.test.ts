import { describe, expect, it } from "vitest";

import purposeRegistryJson from "../lib/ux-budget/route-purpose.generated.json";
import { parsePagePurposeRegistry } from "../lib/ux-budget/page-purpose";
import { selectSweepPurposeContracts } from "./ux-route-purpose";

describe("selectSweepPurposeContracts", () => {
  it("keeps fixture-sensitive contracts out of the broad route sweep", () => {
    const registry = parsePagePurposeRegistry(purposeRegistryJson);
    const contracts = selectSweepPurposeContracts(registry);

    expect([...contracts.keys()]).toEqual(["/admin/graph-explorer"]);
    expect(contracts.has("/ops/self-upgrade")).toBe(false);
  });
});

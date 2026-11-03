import { describe, expect, it } from "vitest";
import * as legacyRoot from "./index";
import * as legacyGraph from "./flow-graph";
import * as legacyMarking from "./marking";
import * as legacyReceipts from "./receipts";
import * as legacyResult from "../action-result";
import * as legacyOutcome from "../outcome-disposition";
import * as legacyIds from "../gpp/element-ids";
import * as legacyDiagnostics from "../gpp/diagnostics";
import * as legacyConstructs from "../gpp/executable-constructs";
import * as canonicalRoot from "@opendigitalproductfactory/dpf-workroom";
import * as canonicalGraph from "@opendigitalproductfactory/dpf-workroom/flow-graph";
import * as canonicalMarking from "@opendigitalproductfactory/dpf-workroom/marking";
import * as canonicalReceipts from "@opendigitalproductfactory/dpf-workroom/receipts";
import * as canonicalResult from "@opendigitalproductfactory/dpf-workroom/result";
import * as canonicalOutcome from "@opendigitalproductfactory/dpf-workroom/outcome-disposition";
import * as canonicalIds from "@opendigitalproductfactory/dpf-workroom/process/element-ids";
import * as canonicalDiagnostics from "@opendigitalproductfactory/dpf-workroom/process/diagnostics";
import * as canonicalConstructs from "@opendigitalproductfactory/dpf-workroom/process/executable-constructs";

// Compatibility paths preserve symbols and identity, never another implementation.
const bridges = [
  ["workroom", legacyRoot, canonicalRoot],
  ["workroom/flow-graph", legacyGraph, canonicalGraph],
  ["workroom/marking", legacyMarking, canonicalMarking],
  ["workroom/receipts", legacyReceipts, canonicalReceipts],
  ["action-result", legacyResult, canonicalResult],
  ["outcome-disposition", legacyOutcome, canonicalOutcome],
  ["gpp/element-ids", legacyIds, canonicalIds],
  ["gpp/diagnostics", legacyDiagnostics, canonicalDiagnostics],
  ["gpp/executable-constructs", legacyConstructs, canonicalConstructs],
] as const;

describe.each(bridges)("canonical component identity through %s", (_path, legacy, canonical) => {
  it("retains the complete public export set", () => {
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(canonical).sort());
  });
  it("resolves every exported value to the identical artifact body", () => {
    for (const symbol of Object.keys(canonical)) {
      expect((legacy as Record<string, unknown>)[symbol], symbol)
        .toBe((canonical as Record<string, unknown>)[symbol]);
    }
  });
});

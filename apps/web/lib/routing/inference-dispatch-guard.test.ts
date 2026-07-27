import { describe, expect, it } from "vitest";
import type { InferenceDataScreenReceipt } from "@/lib/inference/data-screening/types";
import {
  assertInferenceDispatchScreen,
  UnsafeInferenceDispatchError,
} from "./inference-dispatch-guard";

const receipt: InferenceDataScreenReceipt = {
  schemaVersion: "inference-data-screen/v1",
  screenId: "screen_abc",
  decisionIds: ["decision-1"],
  decisionVersions: [
    {
      decisionId: "decision-1",
      assetVersion: "asset-1",
      classificationVersion: "classification-1",
      authorityVersion: "authority-1",
    },
  ],
  inputHash: "hash-1",
  classifiedDataClasses: ["employee-records"],
  policyEffect: "allow",
  routeEffect: "allow",
  destinationClass: "external-service",
  transformation: "none",
  explanationCodes: ["dispatch-allowed"],
  obligationKinds: [],
  rawPayloadStored: false,
};
const decisionVersion = receipt.decisionVersions[0]!;

const decision = {
  sensitivity: "restricted" as const,
  policyRulesApplied: ["inference-dispatch"],
  inferenceDataScreenReceipt: receipt,
};

describe("assertInferenceDispatchScreen freshness", () => {
  it("accepts a receipt re-evaluated against the same payload and policy versions", () => {
    expect(() => assertInferenceDispatchScreen(decision, structuredClone(receipt))).not.toThrow();
  });

  it("fails closed when the payload hash changes after routing", () => {
    expect(() =>
      assertInferenceDispatchScreen(decision, {
        ...receipt,
        screenId: "screen_changed",
        inputHash: "hash-changed",
      }),
    ).toThrowError(UnsafeInferenceDispatchError);
  });

  it.each(["assetVersion", "classificationVersion", "authorityVersion"] as const)(
    "fails closed when %s changes after the policy decision",
    (versionKey) => {
      expect(() =>
        assertInferenceDispatchScreen(decision, {
          ...receipt,
          decisionVersions: [
            {
              ...decisionVersion,
              [versionKey]: `${versionKey}-changed`,
            },
          ],
        }),
      ).toThrowError(/stale inference data screen receipt/);
    },
  );

  it("requires decision version evidence for a governed PDP decision", () => {
    expect(() =>
      assertInferenceDispatchScreen(
        {
          ...decision,
          inferenceDataScreenReceipt: {
            ...receipt,
            decisionVersions: [],
          },
        },
        {
          ...receipt,
          decisionVersions: [],
        },
      ),
    ).toThrowError(/missing policy decision version evidence/);
  });

  it("fails closed when the current policy outcome no longer matches the routed outcome", () => {
    expect(() =>
      assertInferenceDispatchScreen(decision, {
        ...receipt,
        policyEffect: "deny",
        routeEffect: "local-only",
        explanationCodes: ["policy-changed"],
      }),
    ).toThrowError(/stale inference data screen receipt/);
  });
});

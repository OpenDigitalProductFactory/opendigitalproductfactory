// apps/web/lib/ea/ea-validation.test.ts
//
// Unit tests for the pure reference-status assertion helpers extracted from
// lib/actions/ea.ts (BI-OPT-FAT-ACTIONS, EA slice).
import { describe, it, expect } from "vitest";
import {
  assertCoverageStatus,
  assertProposalStatus,
  REFERENCE_COVERAGE_STATUSES,
  REFERENCE_PROPOSAL_STATUSES,
} from "./ea-validation";

describe("assertCoverageStatus", () => {
  it("accepts every supported coverage status", () => {
    for (const status of REFERENCE_COVERAGE_STATUSES) {
      expect(() => assertCoverageStatus(status)).not.toThrow();
    }
  });

  it("throws 'Invalid coverage status' for an unsupported value", () => {
    expect(() => assertCoverageStatus("unknown")).toThrow("Invalid coverage status");
  });
});

describe("assertProposalStatus", () => {
  it("accepts every supported proposal status", () => {
    for (const status of REFERENCE_PROPOSAL_STATUSES) {
      expect(() => assertProposalStatus(status)).not.toThrow();
    }
  });

  it("throws 'Invalid proposal status' for an unsupported value", () => {
    expect(() => assertProposalStatus("bogus")).toThrow("Invalid proposal status");
  });
});

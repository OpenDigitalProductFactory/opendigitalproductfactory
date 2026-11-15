// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { EvidenceSummary } from "./EvidenceSummary";
afterEach(cleanup);
describe("EvidenceSummary verification facts", () => {
  it.each([
    { typecheckPassed: null, testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: null },
    { typecheckPassed: true, testsPassed: 1, testsFailed: 0, testsExecuted: false, testsApplicable: null },
  ])("keeps missing execution distinct from failed or passing verification", (verificationOut) => {
    render(<EvidenceSummary build={{ verificationOut } as unknown as FeatureBuildRow} />);
    expect(screen.getByText(/Unverified/)).toBeInTheDocument();
    expect(screen.queryByText("Typecheck: fail", { exact: true })).not.toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBalancePolicy } from "@/lib/portfolio/investment-balance";
import type { PlatformFundingSetupView } from "@/lib/portfolio/platform-funding-setup";
import { PLATFORM_FUNDING_SETUP_SURFACE, projectPlatformFundingSetupSurface } from "./platform-funding-setup-surface";

const view = (): PlatformFundingSetupView => ({
  status: "available", reason: null, installationId: "install-test",
  person: { principalId: "person-test", displayName: "Owner" },
  profile: { profileId: "platform-test", name: "Platform policy", currentVersionId: "version-test", ownerPrincipalId: null, ownerOrganizationId: null },
  organizations: [{ id: "org-test", name: "Owner organization", expectedDigest: "a".repeat(64), allocation: { source: "default", policy: defaultBalancePolicy("founder", "shared-platform"), revision: null, active: true } }],
  nextCursor: "org-test",
});

describe("platform funding setup surface projection", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2022-01-01T00:00:00.000Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("binds the existing governed confirmation with only its digest supplied directly", () => {
    const action = PLATFORM_FUNDING_SETUP_SURFACE.actions.find(({ actionId }) => actionId === "platform-funding-confirm");
    expect(action).toMatchObject({ tool: "confirm_platform_funding_owner", actionClass: "domain", risk: "high", confirmation: "required",
      argMap: { organizationId: "platform-funding-organization", reason: "platform-funding-reason", attestation: "platform-funding-attestation" } });
    expect(Object.keys(action!.inputSchema!.properties!)).toEqual(["expectedDigest"]);
    expect(action!.inputSchema!.additionalProperties).toBe(false);
  });

  it("keeps every rendered control id and starts owner choices and attestation empty", () => {
    expect(PLATFORM_FUNDING_SETUP_SURFACE.nodes.filter(({ rendered }) => rendered !== false).map(({ nodeId }) => nodeId).sort()).toEqual([
      "platform-funding-setup", "platform-funding-setup-toggle", "platform-funding-setup-reload", "platform-funding-organization", "platform-funding-reason", "platform-funding-attestation", "platform-funding-confirm", "platform-funding-record-toggle", "platform-funding-more-organizations",
    ].sort());
    const result = projectPlatformFundingSetupSurface({ ok: true, data: view() });
    expect(result.values).toMatchObject({ "platform-funding-organization": "", "platform-funding-reason": "", "platform-funding-attestation": false });
    expect(result.values["platform-funding-setup-record"]).toEqual({ ok: true, data: view() });
    expect(result.states?.["platform-funding-organization"]).toMatchObject({ choices: ["org-test"] });
    expect(result.help?.["platform-funding-more-organizations"]).toContain("afterOrganizationId");
  });

  it("binds allocation validity, revisions, digests and existing ownership in the projected revision", () => {
    const initial = view();
    const seed = projectPlatformFundingSetupSurface({ ok: true, data: initial }).revisionSeed;
    const changes = [
      (copy: PlatformFundingSetupView) => { copy.organizations[0]!.allocation.active = false; },
      (copy: PlatformFundingSetupView) => { copy.organizations[0]!.allocation.policy.refactorPercent = 30; },
      (copy: PlatformFundingSetupView) => { copy.organizations[0]!.expectedDigest = "b".repeat(64); },
      (copy: PlatformFundingSetupView) => { copy.profile!.ownerPrincipalId = "recorded-person"; },
      (copy: PlatformFundingSetupView) => { copy.profile!.currentVersionId = "version-next"; },
    ];
    for (const change of changes) {
      const copy = structuredClone(initial); change(copy);
      expect(projectPlatformFundingSetupSurface({ ok: true, data: copy }).revisionSeed).not.toBe(seed);
    }
    initial.organizations[0]!.allocation.revision = { version: 1, revision: "allocation-test", previousRevision: null,
      scope: { principalId: "person-test", organizationId: "org-test", purpose: "shared-platform" },
      policy: initial.organizations[0]!.allocation.policy, actorPrincipalId: "person-test", reason: "Existing owner choice.",
      effectiveAt: "2020-01-01T00:00:00.000Z", expiresAt: null };
    const allocationSeed = projectPlatformFundingSetupSurface({ ok: true, data: initial }).revisionSeed;
    initial.organizations[0]!.allocation.revision.expiresAt = "2021-01-01T00:00:00.000Z";
    expect(projectPlatformFundingSetupSurface({ ok: true, data: initial }).revisionSeed).not.toBe(allocationSeed);
  });

  it.each(["already-recorded", "partial-or-conflicting", "unavailable"] as const)("marks %s state non-confirmable", status => {
    const result = projectPlatformFundingSetupSurface({ ok: true, data: { ...view(), status } });
    expect(result.states?.["platform-funding-confirm"]).toMatchObject({ disabled: true });
    expect(result.values["platform-funding-setup-available"]).toBe(false);
  });

  it("preserves a denied read as unavailable evidence without synthesizing owner data", () => {
    const denied = { ok: false as const, error: "funding-setup-not-authorized" };
    const result = projectPlatformFundingSetupSurface(denied);
    expect(result.values["platform-funding-setup-record"]).toEqual(denied);
    expect(result.states?.["platform-funding-confirm"]).toMatchObject({ disabled: true });
    expect(JSON.stringify(result)).not.toContain("person-test");
  });
});

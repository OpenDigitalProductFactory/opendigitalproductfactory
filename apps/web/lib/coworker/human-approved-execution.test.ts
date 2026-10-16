import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ envelope: vi.fn(), user: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { coworkerActionEnvelope: { findUnique: m.envelope }, user: { findUnique: m.user } } }));
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { humanApprovalForConsumption, humanApprovalForExecution } from "./human-approved-execution";
import * as permissions from "@/lib/permissions";

const now = new Date("2026-10-16T04:40:00Z");
const params = { capsuleId: "WC-test", reason: "Accept this exact bounded exception." };
const input = { envelopeId: "envelope", toolName: "record_semantic_review_exemption", userId: "owner", agentId: "agent", params,
  requiredApproverCapability: "manage_platform" as const };
const marker = () => ({ userId: "admin", approvedAt: "2026-10-16T04:38:00Z", by: "admin", onBehalfOf: "owner", reason: "Owner authorized this exact action." });
const envelope = () => ({ id: "envelope", status: "approved", resolvedAt: new Date("2026-10-16T04:39:00Z"),
  expiresAt: new Date("2026-10-16T05:00:00Z"), delegatingUserId: "owner", coworkerAgentId: "agent",
  manifestActionId: input.toolName, inputFingerprint: fingerprintCoworkerInput(params), argsJson: { humanApproval: marker() } });
const user = () => ({ isActive: true, isSuperuser: false, automationVerificationId: null, automationProfile: null, automationExpiresAt: null,
  groups: [{ platformRole: { roleId: "HR-000" } }] });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  m.envelope.mockResolvedValue(envelope()); m.user.mockResolvedValue(user());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("persisted approval execution", () => {
  it("retains the actual eligible administrator and the delegated owner separately", async () => {
    expect(await humanApprovalForExecution(input)).toMatchObject({ envelopeId: "envelope", userId: "owner", approverUserId: "admin", onBehalfOf: "owner" });
    expect(m.user).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "admin" } }));
  });
  it("keeps a direct-owner approval valid", async () => {
    m.envelope.mockResolvedValue({ ...envelope(), argsJson: { humanApproval: { userId: "owner", approvedAt: marker().approvedAt } } });
    expect(await humanApprovalForExecution(input)).toMatchObject({ envelopeId: "envelope", userId: "owner" });
  });
  it("does not enable on-behalf decisions for existing owner-only consumers", async () => {
    const { requiredApproverCapability: _capability, ...ownerOnly } = input;
    expect(await humanApprovalForExecution(ownerOnly)).toBeNull();
  });
  it("does not substitute administrator capability for the action capability", async () => {
    vi.spyOn(permissions, "can").mockImplementation((_actor, capability) => capability === "manage_users");
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it("does not substitute action capability for the on-behalf administrator requirement", async () => {
    vi.spyOn(permissions, "can").mockImplementation((_actor, capability) => capability === "manage_platform");
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it.each([{ ...user(), isActive: false }, { ...user(), groups: [{ platformRole: { roleId: "HR-100" } }] }])("does not lend more authority than the current delegated owner holds", async owner => {
    m.user.mockImplementation(async ({ where }) => where.id === "admin" ? user() : owner);
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it.each([
    { userId: "someone-else" }, { by: "someone-else" }, { onBehalfOf: "someone-else" }, { reason: " " },
    { approvedAt: "not-a-date" }, { approvedAt: "2026-10-16T04:41:00Z" },
  ])("refuses a malformed or inconsistent on-behalf marker %j", async patch => {
    m.envelope.mockResolvedValue({ ...envelope(), argsJson: { humanApproval: { ...marker(), ...patch } } });
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it.each([
    { status: "executed" }, { status: "failed" }, { status: "cancelled" }, { resolvedAt: null },
    { resolvedAt: new Date("invalid") }, { resolvedAt: new Date("2026-10-16T04:41:00Z") }, { expiresAt: new Date("invalid") },
    { expiresAt: new Date("2026-10-16T04:39:00Z") }, { delegatingUserId: "other" }, { coworkerAgentId: "other" },
    { manifestActionId: "other" }, { inputFingerprint: fingerprintCoworkerInput({ ...params, changed: true }) },
  ])("preserves the exact reserved envelope boundary %j", async patch => {
    m.envelope.mockResolvedValue({ ...envelope(), ...patch });
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it.each([
    null, { ...user(), isActive: false }, { ...user(), automationVerificationId: "fixture" },
    { ...user(), automationProfile: "platform_manager" },
    { ...user(), automationSlot: 0 }, { ...user(), automationExpiresAt: new Date("2026-10-16T05:00:00Z") },
    { ...user(), groups: [{ platformRole: { roleId: "HR-100" } }] },
  ])("refuses an ineligible actual decision maker", async actor => {
    m.user.mockResolvedValue(actor);
    expect(await humanApprovalForExecution(input)).toBeNull();
  });
  it.each(["approved", "executed"])("consumes a still-valid %s decision through the same strict identity", async status => {
    m.envelope.mockResolvedValue({ ...envelope(), status });
    expect(await humanApprovalForConsumption(input)).toMatchObject({ userId: "owner", approverUserId: "admin" });
  });
  it.each(["proposed", "failed", "cancelled", "expired"])("never consumes a %s decision", async status => {
    m.envelope.mockResolvedValue({ ...envelope(), status });
    expect(await humanApprovalForConsumption(input)).toBeNull();
  });
});

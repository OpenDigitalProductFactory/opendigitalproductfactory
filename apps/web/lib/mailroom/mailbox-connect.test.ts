import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poll: vi.fn(), complete: vi.fn(), probe: vi.fn(),
  upsert: vi.fn(), saved: vi.fn(), owned: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { mailboxAccount: { upsert: mocks.upsert, findUniqueOrThrow: mocks.saved, findFirst: mocks.owned } } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner", type: "admin" } }) }));
vi.mock("@/lib/govern/credential-crypto", () => ({ encryptJson: () => "encrypted" }));
vi.mock("@/lib/identity/principal-linking", () => ({ resolvePrincipalIdForUser: async () => "principal" }));
vi.mock("@/lib/mailroom/classifier", () => ({ MAILROOM_AGENT_ID: "mailroom" }));
vi.mock("@/lib/mailroom/providers/registry", () => ({ createMailboxProviderAdapters: () => ({ imap: { probe: mocks.probe } }) }));
vi.mock("@/lib/mailroom/reply", () => ({}));
vi.mock("@/lib/shared/email", () => ({}));
vi.mock("@/lib/mailroom/runtime.server", () => ({
  pollMailboxNow: mocks.poll,
  resolveMailroomOrganizationId: async () => "org",
  resolveOrganizationMailroomProfile: async () => ({ expectedMailboxes: [{ purposeKey: "business" }] }),
}));
vi.mock("@/lib/onboarding/setup-progress-service.server", () => ({ completeSetupStepFromEvidence: mocks.complete }));

import { checkMailboxNow, connectMailbox } from "@/app/(shell)/workspace/mailroom/actions";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ provider: "imap", address: "owner@example.test", purposeKey: "business", host: "mail.example.test", password: "test-only", folder: "Business" })) data.set(key, value);
  return data;
}

describe("mailbox setup completion evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.probe.mockResolvedValue({ ok: true, data: { mailboxLabel: "Business" } });
    mocks.saved.mockResolvedValue({ mailboxRef: "MBX-test" });
    mocks.owned.mockResolvedValue({ mailboxRef: "MBX-test" });
    mocks.complete.mockResolvedValue(undefined);
  });
  it("keeps setup incomplete when credentials work but the first read fails", async () => {
    mocks.poll.mockResolvedValue({ ok: false, error: "Provider unavailable" });
    const result = await connectMailbox(null, form());
    expect(result.ok).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    if (result.ok) expect(result.data.firstRead).toContain("First read failed");
  });
  it("keeps setup incomplete when no first-read outcome exists", async () => {
    mocks.poll.mockResolvedValue(null);
    await connectMailbox(null, form());
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("records completion after a successful read, including an empty business folder", async () => {
    mocks.poll.mockImplementation(async () => {
      expect(mocks.complete).not.toHaveBeenCalled();
      return { ok: true, data: { ingested: 0 } };
    });
    await connectMailbox(null, form());
    expect(mocks.complete).toHaveBeenCalledWith("org", "mailroom");
  });
  it("does not save or complete setup when the connection probe fails", async () => {
    mocks.probe.mockResolvedValue({ ok: false, error: "Access denied" });
    const result = await connectMailbox(null, form());
    expect(result.ok).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.poll).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("completes setup when a later owner check recovers the failed first read", async () => {
    mocks.poll.mockResolvedValueOnce({ ok: false, error: "Unavailable" })
      .mockResolvedValueOnce({ ok: true, data: { ingested: 1, skipped: 0 } });
    await connectMailbox(null, form());
    expect(mocks.complete).not.toHaveBeenCalled();
    expect((await checkMailboxNow("MBX-test")).ok).toBe(true);
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
  it("does not mark setup complete on a failed later check", async () => {
    mocks.poll.mockResolvedValue({ ok: false, error: "Unavailable" });
    expect((await checkMailboxNow("MBX-test")).ok).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ recipient: vi.fn(), notify: vi.fn(), legacyNotify: vi.fn(), operator: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./nested-room-coordination.server", () => ({ resolveNestedRoomStallRecipient: mocked.recipient }));
vi.mock("@/lib/attention/notify-live", () => ({
  notifyAttentionLiveOrThrow: mocked.notify, notifyAttentionLive: mocked.legacyNotify, resolveOperatorRecipient: mocked.operator,
}));
import { notifyWorkroomStall } from "./workroom-stall-notice";

const input = () => ({ room: { id: "child-row", capsuleId: "WC-CHILD", ownerUserId: "old-owner" },
  hold: { key: "held", since: "2026-10-12T01:00:00Z", ticks: 4, stuckSince: "2026-10-12T01:00:00Z", stuckTicks: 4, notifiedAt: null },
  reason: "sub_shape_stopped", conformance: null });
beforeEach(() => {
  vi.resetAllMocks();
  mocked.recipient.mockResolvedValue("recorded-human");
  mocked.notify.mockResolvedValue({ created: true });
});
describe("recorded nested stall delivery", () => {
  it("notifies the recorded route's human with the existing stable stall identity", async () => {
    await notifyWorkroomStall(input());
    expect(mocked.recipient).toHaveBeenCalledWith(expect.anything(), { roomId: "child-row" });
    expect(mocked.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "recorded-human",
      source: "workroom-stall", itemKey: "WC-CHILD:2026-10-12T01:00:00Z" }));
    expect(mocked.operator).not.toHaveBeenCalled();
  });
  it("does not acknowledge an unresolved route by notifying a guessed owner", async () => {
    mocked.recipient.mockResolvedValue(null);
    await expect(notifyWorkroomStall(input())).rejects.toThrow();
    expect(mocked.notify).not.toHaveBeenCalled();
    expect(mocked.legacyNotify).not.toHaveBeenCalled();
  });
  it("propagates failed delivery so the existing drive retains its retry", async () => {
    mocked.notify.mockRejectedValue(new Error("notification store unavailable"));
    await expect(notifyWorkroomStall(input())).rejects.toThrow("notification store unavailable");
  });
});

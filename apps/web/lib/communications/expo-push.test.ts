import { describe, it, expect, vi } from "vitest";
import {
  isExpoPushToken,
  buildExpoPushMessages,
  sendExpoPush,
} from "./expo-push";

describe("isExpoPushToken", () => {
  it("accepts Expo tokens and rejects others", () => {
    expect(isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("not-a-token")).toBe(false);
  });
});

describe("buildExpoPushMessages", () => {
  it("maps tokens, attaches the deep link, and drops invalid tokens", () => {
    const msgs = buildExpoPushMessages(
      ["ExponentPushToken[a]", "garbage"],
      { title: "New job", body: "Compressor swap", deepLink: "/jobs/WI-1" },
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      to: "ExponentPushToken[a]",
      title: "New job",
      body: "Compressor swap",
      data: { deepLink: "/jobs/WI-1" },
    });
  });

  it("caps an overly long body", () => {
    const long = "x".repeat(500);
    const [msg] = buildExpoPushMessages(["ExponentPushToken[a]"], {
      title: "t",
      body: long,
    });
    expect(msg.body.length).toBeLessThanOrEqual(240);
    expect(msg.body.endsWith("…")).toBe(true);
  });
});

describe("sendExpoPush", () => {
  it("posts to the Expo endpoint and returns ticket ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "ticket-1", status: "ok" }] }),
    });
    const result = await sendExpoPush(
      [{ to: "ExponentPushToken[a]", title: "t", body: "b" }],
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ ok: true, ticketIds: ["ticket-1"] });
  });

  it("no-ops for an empty message list", async () => {
    const fetchMock = vi.fn();
    const result = await sendExpoPush([], fetchMock as unknown as typeof fetch);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, ticketIds: [] });
  });

  it("returns an error on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const result = await sendExpoPush(
      [{ to: "ExponentPushToken[a]", title: "t", body: "b" }],
      fetchMock as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("502");
  });

  it("returns an error when the request throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await sendExpoPush(
      [{ to: "ExponentPushToken[a]", title: "t", body: "b" }],
      fetchMock as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("offline");
  });
});

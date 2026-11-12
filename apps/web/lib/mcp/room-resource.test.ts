import { describe, expect, it } from "vitest";

import {
  decodeStreamEventId,
  encodeStreamEventId,
  mcpSubscriberKey,
  newStreamId,
  parseRoomResourceUri,
  parseRoomMessageNotice,
  roomResourceUri,
  ROOM_RESOURCE_TEMPLATE,
} from "./room-resource";

describe("room resource URI (BI-ED52AB82)", () => {
  it("round-trips a case key, percent-encoding its colon", () => {
    const uri = roomResourceUri("backlog-item:BI-ED52AB82");
    expect(uri).toBe("dpf://rooms/backlog-item%3ABI-ED52AB82/messages");
    expect(parseRoomResourceUri(uri)).toBe("backlog-item:BI-ED52AB82");
  });

  it("also accepts an unencoded case key, as clients may expand the template literally", () => {
    expect(parseRoomResourceUri("dpf://rooms/backlog-item:BI-1/messages")).toBe("backlog-item:BI-1");
  });

  it("refuses anything that is not a room resource (MCP: servers MUST validate all resource URIs)", () => {
    for (const bad of [
      undefined,
      42,
      "",
      "file:///etc/passwd",
      "dpf://rooms//messages",
      "dpf://rooms/a/b/messages",
      "dpf://rooms/no-colon/messages",
      "dpf://rooms/%E0%A4%A/messages",
      `dpf://rooms/${"x".repeat(300)}:y/messages`,
    ]) {
      expect(parseRoomResourceUri(bad)).toBeNull();
    }
  });

  it("publishes the template the URI follows", () => {
    expect(ROOM_RESOURCE_TEMPLATE).toBe("dpf://rooms/{caseKey}/messages");
  });
});

describe("stream event ids", () => {
  it("encode the originating stream and a time watermark", () => {
    const streamId = newStreamId();
    expect(streamId).toMatch(/^[A-Za-z0-9]{16,64}$/);
    const id = encodeStreamEventId(streamId, 1_731_370_000_123);
    expect(decodeStreamEventId(id)).toEqual({ streamId, ms: 1_731_370_000_123 });
  });

  it("refuses a Last-Event-ID this server did not issue", () => {
    for (const bad of [null, "", "abc", "short.1", "x".repeat(20), `${"a".repeat(20)}.-5`, `${"a".repeat(20)}.1e3`, `${"a".repeat(20)}.${Number.MAX_SAFE_INTEGER}9`]) {
      expect(decodeStreamEventId(bad)).toBeNull();
    }
  });
});

describe("subscriber key", () => {
  it("follows the OAuth refresh family so a rotated access token keeps its subscriptions", () => {
    expect(mcpSubscriberKey({ tokenId: "tok-2", oauthFamilyKey: "fam-1" })).toBe("family:fam-1");
  });

  it("falls back to the credential when there is no refresh family", () => {
    expect(mcpSubscriberKey({ tokenId: "tok-2" })).toBe("token:tok-2");
    expect(mcpSubscriberKey({ tokenId: "tok-2", oauthFamilyKey: null })).toBe("token:tok-2");
  });
});

describe("room message notice", () => {
  it("parses the trigger payload", () => {
    expect(parseRoomMessageNotice(JSON.stringify({
      workItemId: "wi-1", messageId: "m-1", createdAt: "2026-11-12T00:00:01.250Z",
    }))).toEqual({ workItemId: "wi-1", messageId: "m-1", createdAt: new Date("2026-11-12T00:00:01.250Z") });
  });

  it("drops a malformed payload instead of throwing", () => {
    for (const bad of [undefined, "", "{", "[]", JSON.stringify({ workItemId: "w" }), JSON.stringify({ workItemId: "w", messageId: "m", createdAt: "nope" })]) {
      expect(parseRoomMessageNotice(bad)).toBeNull();
    }
  });
});

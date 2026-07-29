import { describe, it, expect } from "vitest";
import {
  notifyAttention,
  attentionNotificationType,
  isAttentionNotificationType,
  type NotifyAttentionDeps,
  type HitlAttentionEvent,
} from "./notify";

function harness(opts: { unread?: boolean } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const emitted: HitlAttentionEvent[] = [];
  const deps: NotifyAttentionDeps = {
    hasUnread: async () => opts.unread ?? false,
    createNotification: async (data) => {
      created.push(data);
    },
    emit: (event) => {
      emitted.push(event);
    },
    nowIso: () => "2026-06-26T00:00:00.000Z",
  };
  return { deps, created, emitted };
}

const baseInput = {
  source: "escalation" as const,
  itemKey: "PIR-1",
  userId: "principal-7",
  title: "Build Studio needs you",
  deepLink: "/build?buildId=FB-9",
  riskClass: "high-risk",
};

describe("attentionNotificationType", () => {
  it("encodes source + item and is recognized by the prefix guard", () => {
    const type = attentionNotificationType("escalation", "PIR-1");
    expect(type).toBe("attention:escalation:PIR-1");
    expect(isAttentionNotificationType(type)).toBe(true);
    expect(isAttentionNotificationType("taskrun.escalated")).toBe(false);
  });
});

describe("notifyAttention", () => {
  it("writes one notification and emits the event for a new item", async () => {
    const { deps, created, emitted } = harness();
    const result = await notifyAttention(deps, baseInput);

    expect(result.created).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      userId: "principal-7",
      type: "attention:escalation:PIR-1",
      title: "Build Studio needs you",
      body: null,
      deepLink: "/build?buildId=FB-9",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      eventType: "attention.created",
      source: "escalation",
      itemKey: "PIR-1",
      userId: "principal-7",
      riskClass: "high-risk",
      occurredAtIso: "2026-06-26T00:00:00.000Z",
    });
  });

  it("dedups: no write and no emit when an unread notification already exists", async () => {
    const { deps, created, emitted } = harness({ unread: true });
    const result = await notifyAttention(deps, baseInput);

    expect(result.created).toBe(false);
    expect(created).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it("passes the body through when provided", async () => {
    const { deps, created } = harness();
    await notifyAttention(deps, { ...baseInput, body: "missing authz on the route" });
    expect(created[0].body).toBe("missing authz on the route");
  });

  it("works without an emit sink (bus optional)", async () => {
    const created: Array<Record<string, unknown>> = [];
    const deps: NotifyAttentionDeps = {
      hasUnread: async () => false,
      createNotification: async (d) => {
        created.push(d);
      },
      nowIso: () => "2026-06-26T00:00:00.000Z",
    };
    const result = await notifyAttention(deps, baseInput);
    expect(result.created).toBe(true);
    expect(created).toHaveLength(1);
  });
});

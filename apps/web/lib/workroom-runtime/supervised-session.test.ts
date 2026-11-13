import { describe, expect, it } from "vitest";

// BI-F5D58F29 (agent dialog broker item D): the durable supervision record and
// which messages name a supervised session.

import {
  buildSupervisedTurnPrompt,
  decideSupervisedTurn,
  messageNamesSession,
  readStoredRuntimeSession,
  type StoredRuntimeSession,
} from "./supervised-session";

const GAID = "gaid:priv:dpf.internal:agt-ext-claude";
const stored: StoredRuntimeSession = {
  provider: "claude", threadId: "thr-1", tokenId: "tok-1", status: "supervised", openedAt: "2026-11-11T05:00:00.000Z",
  cwd: "/workspace", addressedAs: `${GAID}#session=thr-1`, actor: { userId: "user-1", agentId: null, principalId: null },
};
const base = { hopLimit: 8, wakesLastHour: 0, budgetPerHour: 30, live: true };
const addr = (over: Partial<{ agents: string[]; sessions: string[]; hop: number }> = {}) => ({ agents: [], sessions: [], hop: 0, ...over });

describe("readStoredRuntimeSession", () => {
  it("reads a session stored before item D, when a running session was 'open', as supervised", () => {
    const legacy = readStoredRuntimeSession({ runtimeSession: { provider: "codex", threadId: "t", tokenId: "k", status: "open", openedAt: "x", cwd: "/w" } });
    expect(legacy).toMatchObject({ status: "supervised", addressedAs: null, deliveredCursor: null });
    expect(legacy?.actor).toBeUndefined();
  });

  it("keeps the durable fields", () => {
    expect(readStoredRuntimeSession({ runtimeSession: { ...stored, status: "supervision-lost", lostReason: "no codex", deliveredCursor: "c1", lastHeartbeatAt: "h" } }))
      .toMatchObject({ status: "supervision-lost", lostReason: "no codex", deliveredCursor: "c1", lastHeartbeatAt: "h", actor: { userId: "user-1" } });
  });
});

describe("messageNamesSession", () => {
  it("is named by its own qualifier, or by its provider client with no qualifier for that client", () => {
    expect(messageNamesSession(addr({ agents: ["AGT-EXT-CLAUDE"], sessions: [stored.addressedAs!] }), stored)).toBe(true);
    expect(messageNamesSession(addr({ agents: ["AGT-EXT-CLAUDE"] }), stored)).toBe(true);
  });

  it("is not named by another thread of the same client, another client, or a coworker", () => {
    expect(messageNamesSession(addr({ agents: ["AGT-EXT-CLAUDE"], sessions: [`${GAID}#session=thr-other`] }), stored)).toBe(false);
    expect(messageNamesSession(addr({ agents: ["AGT-EXT-CODEX"] }), stored)).toBe(false);
    expect(messageNamesSession(addr({ agents: ["AGT-B"] }), stored)).toBe(false);
  });
});

describe("decideSupervisedTurn", () => {
  it("delivers a message naming a live supervised session (AC-ADB-12)", () => {
    expect(decideSupervisedTurn({ ...base, addressing: addr({ sessions: [stored.addressedAs!] }), stored }))
      .toEqual({ kind: "deliver", addressedAs: stored.addressedAs });
  });

  it("holds a qualifier the room's supervised session does not answer to", () => {
    const decision = decideSupervisedTurn({ ...base, addressing: addr({ sessions: [`${GAID}#session=thr-x`] }), stored });
    expect(decision).toMatchObject({ kind: "held", detail: expect.stringContaining("waits on the cursor") });
  });

  it("leaves a room that never had a supervised session to B2, qualifier or not", () => {
    expect(decideSupervisedTurn({ ...base, addressing: addr({ sessions: [`${GAID}#session=thr-x`] }), stored: null })).toEqual({ kind: "not-named" });
  });

  it("holds when supervision was lost, or the session is not live in this portal (AC-ADB-13)", () => {
    const named = addr({ sessions: [stored.addressedAs!] });
    expect(decideSupervisedTurn({ ...base, addressing: named, stored: { ...stored, status: "supervision-lost", lostReason: "no codex" } }))
      .toMatchObject({ kind: "held", detail: expect.stringContaining("no codex") });
    expect(decideSupervisedTurn({ ...base, live: false, addressing: named, stored })).toMatchObject({ kind: "held" });
    expect(decideSupervisedTurn({ ...base, addressing: named, stored: { ...stored, status: "closed" } })).toMatchObject({ kind: "held" });
  });

  it("gives no turn past the hop limit or the hourly budget", () => {
    const named = { sessions: [stored.addressedAs!] };
    expect(decideSupervisedTurn({ ...base, addressing: addr({ ...named, hop: 8 }), stored })).toMatchObject({ kind: "held" });
    expect(decideSupervisedTurn({ ...base, wakesLastHour: 30, addressing: addr(named), stored })).toMatchObject({ kind: "paused" });
  });

  it("leaves a message that names no session to B2", () => {
    expect(decideSupervisedTurn({ ...base, addressing: addr({ agents: ["AGT-B"] }), stored })).toEqual({ kind: "not-named" });
  });
});

describe("buildSupervisedTurnPrompt", () => {
  it("puts the addressed message first and folds room-wide messages in, oldest first", () => {
    const prompt = buildSupervisedTurnPrompt({
      caseKey: "work-capsule%3AWC-1",
      senderLabel: "gaid:priv:dpf.internal:agt-a",
      body: "Please rerun the failing test.",
      context: [
        { senderLabel: "a person in the room", body: "fyi the build is red", createdAt: new Date("2026-11-11T05:00:01Z") },
        { senderLabel: "AGT-C", body: "looking\n\ninto it", createdAt: new Date("2026-11-11T05:00:02Z") },
      ],
    });
    expect(prompt.indexOf("Please rerun")).toBeLessThan(prompt.indexOf("fyi the build"));
    expect(prompt.indexOf("fyi the build")).toBeLessThan(prompt.indexOf("looking into it"));
    expect(prompt).toContain('caseKey "work-capsule%3AWC-1"');
  });
});

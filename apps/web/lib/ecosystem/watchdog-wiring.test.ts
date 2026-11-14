import { describe, expect, it, vi } from "vitest";
import { computeDemandDispositionDigest } from "@dpf/db/federated-demand-contract";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  isoWeekKey,
  mapDispositionNotices,
  mapParticipantCandidates,
  postDigestToRoom,
  type DigestEnvelope,
} from "./watchdog-wiring";
import { buildWatchdogDigest } from "./watchdog";

const envelope = (overrides: Partial<DigestEnvelope> = {}): DigestEnvelope => ({
  envelopeId: "env-1",
  originInstallationId: "inst_peer",
  title: "Dispatch board loses the second appointment",
  summary: "Two jobs in one slot drops the later one.",
  audience: "community",
  forwarding: { permitted: true, audiences: ["community"] },
  applicability: { archetypeRefs: ["category:trades-maintenance"] },
  signal: { occurrenceCount: 3, affectedOrganizations: 2 },
  ...overrides,
});

const identity = (payload: unknown) => payload as never;

describe("mapParticipantCandidates", () => {
  it("reads what a participant holds: received envelopes and its own outbound demand", () => {
    const candidates = mapParticipantCandidates(
      [
        { canonicalSide: "peer", payload: { envelope: envelope({ envelopeId: "from-peer" }) } },
        { canonicalSide: "local", payload: { envelope: envelope({ envelopeId: "mine", originInstallationId: "inst_me" }) } },
      ],
      { peer: identity, local: identity },
    );
    expect(candidates.map((c) => [c.ref, c.submitter])).toEqual([["from-peer", "inst_peer"], ["mine", "inst_me"]]);
  });

  it("carries the source-owned consent and applicability the ballot gates on", () => {
    const [candidate] = mapParticipantCandidates(
      [{ canonicalSide: "peer", payload: { envelope: envelope() } }],
      { peer: identity, local: identity },
    );
    expect(candidate).toMatchObject({
      forwarding: { permitted: true, audiences: ["community"] },
      archetypeRefs: ["category:trades-maintenance"],
      affectedOrganizations: 2,
    });
  });

  it("treats a missing forwarding grant as forbidden, never as permitted", () => {
    const [candidate] = mapParticipantCandidates(
      [{ canonicalSide: "peer", payload: { envelope: envelope({ forwarding: undefined }) } }],
      { peer: identity, local: identity },
    );
    expect(candidate.forwarding).toBeNull();
  });

  it("drops a withdrawn envelope — there is nothing left to vote on", () => {
    expect(mapParticipantCandidates(
      [
        { canonicalSide: "peer", payload: { envelope: envelope(), activity: "dpf.demand.withdrawn" } },
        { canonicalSide: "peer", payload: { envelope: envelope({ envelopeId: "w2" }), disposition: "withdrawn" } },
      ],
      { peer: identity, local: identity },
    )).toEqual([]);
  });

  it("does not list one envelope twice", () => {
    expect(mapParticipantCandidates(
      [
        { canonicalSide: "peer", payload: { envelope: envelope() } },
        { canonicalSide: "peer", payload: { envelope: envelope() } },
      ],
      { peer: identity, local: identity },
    )).toHaveLength(1);
  });
});

describe("mapDispositionNotices", () => {
  // A real, digested notice: the decoder validates and must not be fooled.
  const notice = (decision: string, message?: string) => {
    const body = {
      specVersion: "dpf.demand-disposition/1" as const,
      noticeId: `fdn_${decision}${message ? "m" : ""}`,
      envelopeId: "env-1",
      originInstallationId: "inst_me",
      decision: decision as "accepted",
      ...(message ? { message } : {}),
      createdAt: "2026-11-10T00:00:00.000Z",
      payloadDigest: "sha256:pending",
    };
    body.payloadDigest = computeDemandDispositionDigest(body as never);
    return { notice: body, receivedAt: "2026-11-10T00:00:01.000Z" };
  };

  it("reads the contract's accepted|rejected vocabulary, which the old decoder never matched", () => {
    const titles = new Map([["env-1", "Dispatch board loses the second appointment"]]);
    const news = mapDispositionNotices([notice("accepted"), notice("rejected", "Superseded by a fix already shipping.")], titles);
    expect(news).toEqual([
      { ref: "env-1", title: "Dispatch board loses the second appointment", outcome: "scheduled", reason: null },
      { ref: "env-1", title: "Dispatch board loses the second appointment", outcome: "declined", reason: "Superseded by a fix already shipping." },
    ]);
  });

  it("keeps a reasonless decline reasonless, so the digest withholds it instead of showing an empty verdict", () => {
    const news = mapDispositionNotices([notice("archived")], new Map());
    expect(news[0]).toMatchObject({ outcome: "declined", reason: null, title: "Something this installation raised" });
  });

  it("skips a payload that is not a valid notice", () => {
    expect(mapDispositionNotices([{ nonsense: true }, null], new Map())).toEqual([]);
  });
});

describe("isoWeekKey", () => {
  it("follows ISO-8601 week numbering across a year boundary", () => {
    expect(isoWeekKey(new Date("2026-11-16T06:05:00Z"))).toBe("2026-W47");
    expect(isoWeekKey(new Date("2027-01-01T06:05:00Z"))).toBe("2026-W53");
  });
});

describe("postDigestToRoom", () => {
  const room = { id: "w1", itemId: "WI-1", caseKey: "ecosystem-participation%3Aweekly-digest", assignedToUserId: null as string | null };
  const digest = buildWatchdogDigest({
    candidates: [{
      ref: "env-1", title: "Vote me", summary: "s", submitter: "inst_peer", audience: "community",
      forwarding: { permitted: true, audiences: ["community"] }, archetypeRefs: ["scope:platform"],
    }],
    dispositions: [],
    releases: [],
    viewer: { installationId: "inst_me", audience: "community", profile: { archetypeCategories: [], archetypeIds: [] } },
    level: "balanced",
  });

  it("posts one system message per installation per ISO week, so re-runs cannot duplicate it", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    await postDigestToRoom(room, digest, {
      db: { workItemMessage: { upsert } }, installationId: "inst_me", now: new Date("2026-11-16T06:05:00Z"), ownerUserId: null,
    });
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ messageId: "ecosystem-digest:inst_me:2026-W47" });
    expect(args.update).toEqual({});
    expect(args.create).toMatchObject({ senderType: "system", messageType: "ecosystem-digest", workItemId: "w1" });
    expect(args.create.body).toContain("Vote me");
  });

  it("tells the recorded accountable human, linking to the room", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const result = await postDigestToRoom(room, digest, {
      db: { workItemMessage: { upsert: vi.fn() } }, installationId: "inst_me", now: new Date(), ownerUserId: "u-owner", notify,
    });
    expect(result.notified).toBe(true);
    expect(notify.mock.calls[0][0]).toMatchObject({
      recipientUserId: "u-owner",
      deepLink: "/workspace/cases/ecosystem-participation%3Aweekly-digest",
    });
  });

  it("tells nobody when no accountable human is recorded, rather than somebody plausible", async () => {
    const notify = vi.fn();
    const result = await postDigestToRoom(room, digest, {
      db: { workItemMessage: { upsert: vi.fn() } }, installationId: "inst_me", now: new Date(), ownerUserId: null, notify,
    });
    expect(result.notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

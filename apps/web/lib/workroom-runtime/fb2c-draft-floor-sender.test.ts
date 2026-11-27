import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import { buildDraftFloorPageRequest, buildDraftFloorRequest, DRAFT_FLOOR_ACK_PATH, DRAFT_FLOOR_PATH,
  matchesDraftTerminalEmptyPage } from "./__fixtures__/fb2c-draft-floor-sender";
import type { ProtectedFloorRequest } from "./protected-authority-control.server";

const hostRef = "host:dpf2-fixture";
const key = { sourceInstallationRef: "install:dpf-fixture", receiverHostRef: hostRef,
  authorityKind: "qualification-epoch", authorityScopeRef: "qualification:fixture-1" } as const;
const request: ProtectedFloorRequest = { version: 1, revocationId: "rev-1", key, minimumAcceptedRevision: 3 };
const affectedDigest = "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const ack = { version: 1, ackFormat: 2, revocationId: "rev-1", key, appliedFloor: 3, outcome: "applied", commitRef: "{store-epoch}:1",
  affectedCount: 0, affectedDigest, inFlight: [], inFlightCount: 0, unlistedCount: 0,
  ackDigest: "sha256:36dd35e8bee029f11ed2b4d9e8966d0878d929cc5a4ceb2e26a8b55bf7649dad" };
const page = { version: 1, revocationId: "rev-1", commitRef: ack.commitRef, nextCursor: null, affected: [], affectedCount: 0, affectedDigest };

describe("FB-2c draft floor sender, synthetic fixture only", () => {
  it("encodes separate POSTs, pinning the first ack page to the same host, ID and returned commit", () => {
    expect(buildDraftFloorRequest(hostRef, request)).toEqual({ method: "POST", path: DRAFT_FLOOR_PATH, body: { hostRef, ...request } });
    expect(buildDraftFloorPageRequest(hostRef, request, ack)).toEqual({ method: "POST", path: DRAFT_FLOOR_ACK_PATH,
      body: { version: 1, hostRef, revocationId: request.revocationId, commitRef: ack.commitRef, cursor: null, pageSize: 100 } });
    expect(matchesDraftTerminalEmptyPage(request, ack, page)).toBe(true);
  });

  it("holds wrong host, invalid floor, refusal, or a commit whose Store epoch cannot be proven current", () => {
    expect(buildDraftFloorRequest("other-host", request)).toBeNull();
    expect(buildDraftFloorRequest(hostRef, { ...request, minimumAcceptedRevision: -1 })).toBeNull();
    expect(buildDraftFloorPageRequest(hostRef, request, { version: 1, refused: "authority-floor-conflict" })).toBeNull();
    expect(buildDraftFloorPageRequest(hostRef, request, { ...ack, commitRef: "actual-store-epoch:1" })).toBeNull();
    expect(buildDraftFloorPageRequest(hostRef, request, { ...ack, key: { ...key, authorityScopeRef: "another" } })).toBeNull();
    expect(buildDraftFloorPageRequest(hostRef, request, ack, 501)).toBeNull();
  });

  it("does not accept unproven affected mappings, nonterminal pages, mismatched snapshots or digests", () => {
    for (const invalid of [{ ...page, affected: [{ sessionRef: "session", stageAttemptRef: "stage", attemptRef: "attempt" }] },
      { ...page, affectedCount: 1 }, { ...page, nextCursor: "some-cursor" }, { ...page, commitRef: "{store-epoch}:2" },
      { ...page, affectedDigest: `${affectedDigest}bad` }]) {
      expect(matchesDraftTerminalEmptyPage(request, ack, invalid)).toBe(false);
    }
  });

  it("requires an explicit empty in-flight snapshot and does not turn an uncertain operation into an empty acknowledgement", () => {
    const { inFlight: _items, inFlightCount: _count, ...oldAck } = ack;
    const operation = { sessionRef: "session", stageAttemptRef: "stage", attemptRef: "opaque",
      operationId: "room-operation:00000000-0000-4000-8000-000000000001", claimStatus: "unknown", effect: "uncertain" };
    for (const invalid of [oldAck, { ...ack, inFlightCount: 1 }, { ...ack, inFlight: [operation] },
      { ...ack, inFlight: [operation], inFlightCount: 1 }, { ...ack, inFlight: null }]) {
      expect(buildDraftFloorPageRequest(hostRef, request, invalid)).toBeNull();
      expect(matchesDraftTerminalEmptyPage(request, invalid, page)).toBe(false);
    }
    // The ack-page operation only pages `affected`, not the header's `inFlight` set.
    expect(matchesDraftTerminalEmptyPage(request, ack, { ...page, inFlight: [], inFlightCount: 0 })).toBe(false);
  });

  it("binds the whole header including its commit and counts, but not its replay outcome", () => {
    const { ackDigest: _digest, ...missingDigest } = ack;
    const { unlistedCount: _unlisted, ...missingUnlisted } = ack;
    for (const invalid of [missingDigest, missingUnlisted, { ...ack, appliedFloor: 4 }, { ...ack, commitRef: "{store-epoch}:2" },
      { ...ack, ackDigest: `sha256:${"a".repeat(64)}` }]) {
      expect(buildDraftFloorPageRequest(hostRef, request, invalid)).toBeNull();
    }
    const replayed = { ...ack, outcome: "replayed" };
    expect(buildDraftFloorPageRequest(hostRef, request, replayed)).toEqual(buildDraftFloorPageRequest(hostRef, request, ack));
    expect(matchesDraftTerminalEmptyPage(request, replayed, page)).toBe(true);
  });

  it("holds an unlisted attempt even when the header digest is valid", () => {
    const { outcome, ackDigest: _old, ...fields } = ack;
    const unlisted = { ...fields, unlistedCount: 1 };
    const ackDigest = `sha256:${createHash("sha256").update(canonicalJson(unlisted)).digest("hex")}`;
    expect(matchesDraftTerminalEmptyPage(request, { ...unlisted, outcome, ackDigest }, page)).toBe(false);
  });

  it("does not promote a format-1 replay or an unlabelled header into format-2 proof", () => {
    const { ackFormat: _format, ackDigest: _digest, inFlight: _items, inFlightCount: _count, unlistedCount: _unlisted, ...legacy } = ack;
    const { outcome: _outcome, ackDigest: _old, ...fields } = ack;
    const labelledLegacy = { ...fields, ackFormat: 1 };
    const legacyDigest = `sha256:${createHash("sha256").update(canonicalJson(labelledLegacy)).digest("hex")}`;
    for (const reply of [legacy, { ...legacy, outcome: "replayed", ackFormat: 1 },
      { ...labelledLegacy, outcome: "replayed", ackDigest: legacyDigest }]) {
      expect(buildDraftFloorPageRequest(hostRef, request, reply)).toBeNull();
      expect(matchesDraftTerminalEmptyPage(request, reply, page)).toBe(false);
    }
  });
});

const fixturePath = process.env.DPF2_FB2C_DRAFT_FLOOR_VECTORS;
it.skipIf(!fixturePath)("matches all nine upstream generated vectors at the pinned draft revision", () => {
  const bytes = readFileSync(fixturePath!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("11dc559947319ffcd0e9538cc8210f612507bedf56bf9f8bdeacfe0386d563a1");
  const fixture = JSON.parse(bytes.toString("utf8")) as { format: string; vectors: {
    operation: string; request: { hostRef: string } & ProtectedFloorRequest; response: Record<string, unknown>;
  }[] };
  expect(fixture.format).toBe("dpf2-fb2c-receiver-vectors/1");
  expect(fixture.vectors).toHaveLength(9);
  const [applied, lower, replayed, conflict, negative, badKind, terminal, mismatch, overLimit] = fixture.vectors;
  const project = (v: (typeof fixture.vectors)[number]) => { const { hostRef: pinned, ...body } = v.request; return buildDraftFloorRequest(pinned, body); };
  for (const vector of [applied!, lower!, replayed!, conflict!]) {
    expect(project(vector)).toEqual({ method: "POST", path: DRAFT_FLOOR_PATH, body: vector.request });
  }
  expect(project(negative!)).toBeNull();
  expect(project(badKind!)).toBeNull();
  const { hostRef: pinned, ...expected } = applied!.request;
  const assemble = (response: unknown, limit?: number) => buildDraftFloorPageRequest(pinned, expected, response, limit);
  expect(assemble(applied!.response)).toEqual({ method: "POST", path: DRAFT_FLOOR_ACK_PATH, body: terminal!.request });
  expect(replayed!.response["ackDigest"]).toBe(applied!.response["ackDigest"]);
  expect(assemble(replayed!.response)).toEqual(assemble(applied!.response));
  const { hostRef: lowerHost, ...lowerRequest } = lower!.request;
  expect(buildDraftFloorPageRequest(lowerHost, lowerRequest, lower!.response)).not.toBeNull();
  expect(assemble(conflict!.response)).toBeNull();
  expect(assemble(overLimit!.response, 501)).toBeNull();
  expect(matchesDraftTerminalEmptyPage(expected, applied!.response, terminal!.response)).toBe(true);
  expect(matchesDraftTerminalEmptyPage(expected, applied!.response, mismatch!.response)).toBe(false);
  expect(matchesDraftTerminalEmptyPage(expected, applied!.response, overLimit!.response)).toBe(false);
});

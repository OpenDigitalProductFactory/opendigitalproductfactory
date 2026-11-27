import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";

import { executionHostRef } from "@/lib/agent-toolchain/execution-host-registry";

import type { ProtectedFloorRequest } from "../protected-authority-control.server";

export const DRAFT_FLOOR_PATH = "/dpf/v1/authority-floor";
export const DRAFT_FLOOR_ACK_PATH = "/dpf/v1/authority-floor/ack";

// DPF2 FB-2c draft at 57b4d8ea6a8d9f3bafed913316e24f72d745a8e9. Only
// generated empty affected and in-flight sets with no unlisted records are covered.
// This has no production receipt port.
const safeRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const draftKey = z.strictObject({ sourceInstallationRef: executionHostRef, receiverHostRef: executionHostRef,
  authorityKind: z.enum(["qualification-epoch", "subject-binding"]), authorityScopeRef: executionHostRef });
const draftRequest = z.strictObject({ version: z.literal(1), revocationId: executionHostRef, key: draftKey,
  minimumAcceptedRevision: safeRevision });
// The sender must not treat an actual Store ref as restore-safe while N1-OI-1 remains open.
const fixtureCommit = z.string().regex(/^\{store-epoch\}:[1-9][0-9]{0,18}$/);
const emptyDigest = z.literal("sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
const draftAck = z.strictObject({ version: z.literal(1), ackFormat: z.literal(2), revocationId: executionHostRef, key: draftKey,
  outcome: z.enum(["applied", "replayed"]), appliedFloor: safeRevision, commitRef: fixtureCommit,
  affectedCount: z.literal(0), affectedDigest: emptyDigest, inFlight: z.tuple([]), inFlightCount: z.literal(0),
  unlistedCount: z.literal(0), ackDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const draftTerminalPage = z.strictObject({ version: z.literal(1), revocationId: executionHostRef, commitRef: fixtureCommit,
  affected: z.tuple([]), affectedCount: z.literal(0), affectedDigest: emptyDigest, nextCursor: z.null() });

export function buildDraftFloorRequest(hostRef: string, request: ProtectedFloorRequest) {
  const parsed = draftRequest.safeParse(request);
  if (!parsed.success || parsed.data.key.receiverHostRef !== hostRef) return null;
  return { method: "POST" as const, path: DRAFT_FLOOR_PATH, body: { hostRef, ...parsed.data } };
}

function matchingDraftAck(request: ProtectedFloorRequest, reply: unknown) {
  const expected = draftRequest.safeParse(request);
  const ack = draftAck.safeParse(reply);
  if (!expected.success || !ack.success || ack.data.revocationId !== expected.data.revocationId ||
    canonicalJson(ack.data.key) !== canonicalJson(expected.data.key) || ack.data.appliedFloor < expected.data.minimumAcceptedRevision) return null;
  const { outcome: _outcome, ackDigest, ...header } = ack.data;
  const calculated = `sha256:${createHash("sha256").update(canonicalJson(header)).digest("hex")}`;
  return calculated === ackDigest ? ack.data : null;
}

export function buildDraftFloorPageRequest(hostRef: string, request: ProtectedFloorRequest, reply: unknown, pageSize = 100) {
  const ack = matchingDraftAck(request, reply);
  if (!ack || ack.key.receiverHostRef !== hostRef || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) return null;
  return { method: "POST" as const, path: DRAFT_FLOOR_ACK_PATH,
    body: { version: 1 as const, hostRef, revocationId: ack.revocationId, commitRef: ack.commitRef, cursor: null, pageSize } };
}

export function matchesDraftTerminalEmptyPage(request: ProtectedFloorRequest, reply: unknown, page: unknown): boolean {
  const ack = matchingDraftAck(request, reply);
  const parsed = draftTerminalPage.safeParse(page);
  return !!ack && parsed.success && parsed.data.revocationId === ack.revocationId && parsed.data.commitRef === ack.commitRef;
}

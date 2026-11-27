import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";
import { readT4GitPage, t4SourceTargetSchema, t4SourceWindowSchema, type T4InstalledStore,
  type T4SourceTarget } from "./t4-source-read-git.server";

export const T4_SOURCE_READ_PATH = "/api/internal/t4-source-read";
export const T4_SOURCE_READ_PROFILE = "t4-control-source-read.v1";
const signatureHeader = "x-dpf-t4-signature";
const MAX_REQUEST = 16 * 1024;
const MAX_REPLY = 64 * 1024;
const ref = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/u);
const operationId = z.string().regex(/^room-operation:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
const attempt = z.strictObject({ sessionAdmissionRef: ref, attemptRef: ref });
const scope = { workroomId: ref, sessionRef: ref, stageKey: ref, stageAttemptRef: ref };
const peerRequest = z.strictObject({
  profile: z.literal(T4_SOURCE_READ_PROFILE), kind: z.literal("source-read"),
  issuer: ref, audience: ref, hostRef: ref, ...scope,
  correlation: attempt.extend({ invocationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u), operationId }),
  target: t4SourceTargetSchema, window: t4SourceWindowSchema,
  reservation: z.strictObject({ reservationId: operationId, reads: z.literal(1), bytes: z.int().min(1).max(8192),
    expiresAt: z.int().nonnegative() }),
});
type Call = z.infer<typeof peerRequest>;
type Peer = Pick<Call, "issuer" | "audience" | "hostRef"> & {
  profile: string; peerPublicKey: KeyObject; replyPrivateKey: KeyObject;
};
type Current = Pick<Call, keyof typeof scope> & {
  correlation: z.infer<typeof attempt>; mode: string; operationKeys: readonly string[];
  target: T4SourceTarget; store: T4InstalledStore; expiresAt: number;
};
type ReservationClaim = Pick<Call, "correlation" | "reservation" | "issuer" | "audience" | "hostRef"
  | "workroomId" | "sessionRef" | "stageKey" | "stageAttemptRef"> & { requestDigest: string };

export type T4ReadPorts = {
  /** Verifies the actual mutually authenticated transport against installed peer registration, not request headers. */
  authenticate(request: Request): Promise<Peer | null>;
  /** Reads current authority, including job ceiling, permit, qualification, concrete route and installed store. */
  readCurrent(call: Call, peer: Peer): Promise<Current | null>;
  /** The durable owner must validate the live attempt and atomically consume an unexpired signed reservation.
   * Key by registered peer and exact attempt/operation. A duplicate or unavailable durable state returns false.
   * Store correlation, reservation and digest only. No body, cursor, page or credential. */
  consumeOnce(claim: ReservationClaim): Promise<boolean>;
  now?: () => number;
  read?: typeof readT4GitPage;
};

async function readBoundedBody(request: Request): Promise<Buffer | null> {
  if (!request.body || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_REQUEST)) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.byteLength;
      if (size > MAX_REQUEST) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function decodeCall(bytes: Buffer): Call | null {
  // Comparing to canonical bytes rejects duplicate decoded keys, BOM, alternate
  // encodings and rounding. The peer sends canonical JSON, not arbitrary JSON.
  const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const raw: unknown = JSON.parse(decoded);
  if (decoded !== canonicalJson(raw)) return null;
  const result = peerRequest.safeParse(raw);
  return result.success ? result.data : null;
}

function matches(current: Current | null, call: Call, now: number): current is Current {
  return current !== null && current.mode === "bounded-coding" && current.operationKeys.includes("read_source_at_version")
    && current.expiresAt > now && call.reservation.expiresAt > now && call.reservation.expiresAt <= current.expiresAt
    && current.workroomId === call.workroomId && current.sessionRef === call.sessionRef && current.stageKey === call.stageKey
    && current.stageAttemptRef === call.stageAttemptRef
    && current.correlation.sessionAdmissionRef === call.correlation.sessionAdmissionRef
    && current.correlation.attemptRef === call.correlation.attemptRef
    && canonicalJson(current.target) === canonicalJson(call.target)
    && current.store.repositoryFullName === call.target.repositoryFullName;
}

const empty = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

/** DPF-side protected adapter only. Does not publish a route or authorize peer registration. */
export function createT4SourceReadWire(ports: T4ReadPorts) {
  const now = ports.now ?? Date.now;
  const read = ports.read ?? readT4GitPage;
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== T4_SOURCE_READ_PATH) return empty(404);
      const peer = await ports.authenticate(request);
      if (peer?.profile !== T4_SOURCE_READ_PROFILE || peer.peerPublicKey.asymmetricKeyType !== "ed25519"
        || peer.replyPrivateKey.asymmetricKeyType !== "ed25519") return empty(403);
      const signature = request.headers.get(signatureHeader);
      if (!signature || !/^[A-Za-z0-9_-]{86}$/u.test(signature)) return empty(403);
      const sig = Buffer.from(signature, "base64url");
      const bytes = await readBoundedBody(request);
      if (!bytes || sig.toString("base64url") !== signature || !verify(null, bytes, peer.peerPublicKey, sig)) return empty(403);
      let call: Call | null;
      try { call = decodeCall(bytes); } catch { return empty(400); }
      if (!call) return empty(400);
      const { issuer, audience, hostRef, correlation, reservation, workroomId, sessionRef, stageKey, stageAttemptRef } = call;
      if (issuer !== peer.issuer || audience !== peer.audience || hostRef !== peer.hostRef
        || reservation.reservationId !== correlation.operationId || reservation.bytes !== call.window.maxBytes) return empty(403);
      const current = await ports.readCurrent(call, peer);
      if (!matches(current, call, now())) return empty(403);
      const gitDir = current.store.gitDir;
      const requestDigest = createHash("sha256").update(bytes).digest("hex");
      if (!await ports.consumeOnce({ issuer, audience, hostRef, workroomId, sessionRef, stageKey, stageAttemptRef,
        correlation, reservation, requestDigest })) return empty(409);
      const beforeRead = await ports.readCurrent(call, peer);
      if (!matches(beforeRead, call, now()) || beforeRead.store.gitDir !== gitDir) return empty(403);
      const result = await read({ repositoryFullName: call.target.repositoryFullName, gitDir }, call.target, call.window);
      const latest = await ports.readCurrent(call, peer);
      if (!matches(latest, call, now()) || latest.store.gitDir !== gitDir) return empty(403);
      const reply = Buffer.from(canonicalJson({ profile: T4_SOURCE_READ_PROFILE, kind: "source-read-result",
        issuer: audience, audience: issuer, hostRef, correlation, requestDigest, target: call.target, result }), "utf8");
      if (reply.byteLength > MAX_REPLY) return empty(503);
      return new Response(new Uint8Array(reply), { status: 200, headers: {
        "content-type": "application/json", "cache-control": "no-store",
        [signatureHeader]: sign(null, reply, peer.replyPrivateKey).toString("base64url"),
      } });
    } catch {
      return empty(503);
    }
  };
}

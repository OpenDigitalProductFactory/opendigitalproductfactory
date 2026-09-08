import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/shared/canonical-json";
import { deriveSemanticReviewGateIdentity } from "@/lib/gates/gate-run-identity";
import { resolveSemanticReviewCoordination, type SemanticChangeReviewOperationInput } from "./semantic-change-review-operation";

export const REVIEW_ARTIFACT_TYPES = ["spec", "plan", "code-change", "architecture-decision", "policy", "research-question"] as const;
export const REVIEW_RISKS = ["low", "medium", "high", "critical"] as const;
export const REVIEW_PROFILES = ["economy", "balanced", "high-assurance", "document-authority"] as const;
export const SEMANTIC_REVIEW_DEADLINE_MS = 30 * 60 * 1_000;
export const SEMANTIC_REVIEW_DISPATCH_CONTRACT_VERSION = "routed-semantic-review.v1";
const MAX_PACKET_BYTES = 2 * 1024 * 1024;
const ref = z.string().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const actorSchema = z.object({ userId: ref, agentId: ref.nullable(), apiTokenId: ref.nullable(), authSource: ref.nullable() }).strict();
const inputSchema = z.object({
  surface: z.enum(["external", "build-studio"]), authorSurface: ref,
  artifactType: z.enum(REVIEW_ARTIFACT_TYPES), title: z.string().min(1).max(2_000),
  artifact: z.string().min(1), verificationEvidence: z.string().min(1),
  changedFiles: z.array(z.string().min(1).max(2_000)).min(1).max(10_000),
  identity: z.object({ capsuleId: ref, baseTreeHash: z.string().regex(/^[a-f0-9]{40}$/),
    headTreeHash: z.string().regex(/^[a-f0-9]{40}$/), diffDigest: sha256,
    policyVersion: ref, reviewerVersion: ref, specialistIds: z.array(ref).max(20) }).strict(),
  repairRound: z.number().int().min(0).max(100).optional(), risk: z.enum(REVIEW_RISKS),
  sensitivityFloor: z.enum(REVIEW_PROFILES).optional(), mode: z.enum(["shadow", "enforce"]).optional(),
}).strict();
const packetSchema = z.object({ schemaVersion: z.literal(1), issuedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(), input: inputSchema, actor: actorSchema, digest: sha256,
  repository: ref, gateKey: sha256 }).strict();
export type SemanticReviewRequestActor = z.infer<typeof actorSchema>;
export type SemanticReviewRequest = z.infer<typeof packetSchema>;

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** A bounded TaskArtifact packet. Actor references are revalidated, never credentials. */
export function createSemanticReviewRequest(input: SemanticChangeReviewOperationInput,
  actor: SemanticReviewRequestActor, now = new Date()): SemanticReviewRequest {
  const { priorReceipt: _priorReceipt, ...request } = input;
  const { identity, risk } = resolveSemanticReviewCoordination(input);
  const normalized = inputSchema.parse({ ...request, identity, risk });
  if (createHash("sha256").update(normalized.artifact, "utf8").digest("hex") !== identity.diffDigest) {
    throw new Error("Semantic review artifact digest mismatch");
  }
  const body = { schemaVersion: 1 as const, issuedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + SEMANTIC_REVIEW_DEADLINE_MS).toISOString(),
    input: normalized, actor: actorSchema.parse(actor),
    repository: process.env.GITHUB_REPOSITORY ?? "OpenDigitalProductFactory/opendigitalproductfactory" };
  const { gateKey } = deriveSemanticReviewGateIdentity({ repository: body.repository, identity, risk,
    dispatchContractVersion: SEMANTIC_REVIEW_DISPATCH_CONTRACT_VERSION });
  const packet = { ...body, gateKey, digest: digest({ ...body, gateKey }) };
  if (Buffer.byteLength(canonicalJson(packet), "utf8") > MAX_PACKET_BYTES) throw new Error("Semantic review packet size limit exceeded");
  return packet;
}

export function parseSemanticReviewRequest(value: unknown): SemanticReviewRequest | null {
  try {
    if (Buffer.byteLength(canonicalJson(value), "utf8") > MAX_PACKET_BYTES) return null;
    const packet = packetSchema.parse(value);
    const { digest: expected, ...body } = packet;
    if (digest(body) !== expected || Date.parse(packet.deadlineAt) - Date.parse(packet.issuedAt) !== SEMANTIC_REVIEW_DEADLINE_MS) return null;
    if (createHash("sha256").update(packet.input.artifact, "utf8").digest("hex") !== packet.input.identity.diffDigest) return null;
    if (deriveSemanticReviewGateIdentity({ repository: packet.repository, identity: packet.input.identity,
      risk: packet.input.risk, dispatchContractVersion: SEMANTIC_REVIEW_DISPATCH_CONTRACT_VERSION }).gateKey !== packet.gateKey) return null;
    return packet;
  } catch { return null; }
}

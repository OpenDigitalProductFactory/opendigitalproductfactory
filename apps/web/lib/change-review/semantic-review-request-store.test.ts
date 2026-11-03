import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ taskArtifact: { findUnique: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { createSemanticReviewRequest } from "./semantic-review-request";
import { readPersistedSemanticReviewRequest } from "./semantic-review-request-store";

const packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
  title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Test passed",
  identity: { capsuleId: "WC-OWN", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
    diffDigest: createHash("sha256").update("diff").digest("hex"), specialistIds: [] },
}, { userId: "owner", agentId: "agent", apiTokenId: "token", authSource: "pat" });
const row = { id: "row-own", taskRunId: "TR-OWN", userId: "owner",
  a2aMetadata: { gateKey: packet.gateKey, capsuleId: "WC-OWN" },
  progressPayload: { semanticReview: { requestDigest: packet.digest } } };
beforeEach(() => { vi.resetAllMocks();
  db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "row-own", parts: [{ data: packet }] }); });

it("loads the same immutable packet under all worker identity bindings", async () => {
  expect(await readPersistedSemanticReviewRequest(row)).toEqual(packet);
  expect(db.taskArtifact.findUnique).toHaveBeenCalledWith({
    where: { artifactId: "semantic-review-request:TR-OWN" }, select: { taskRunId: true, parts: true } });
});
it.each(["owner", "room", "gate", "digest", "task-row", "malformed", "absent"])("refuses %s mismatch rather than synthesizing authority", async reason => {
  const subject = structuredClone(row);
  if (reason === "owner") subject.userId = "foreign";
  if (reason === "room") subject.a2aMetadata.capsuleId = "WC-FOREIGN";
  if (reason === "gate") subject.a2aMetadata.gateKey = "c".repeat(64);
  if (reason === "digest") subject.progressPayload.semanticReview.requestDigest = "d".repeat(64);
  if (reason === "task-row") subject.id = "foreign-row";
  if (reason === "malformed") db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "row-own", parts: [{ data: { ...packet, digest: "e".repeat(64) } }] });
  if (reason === "absent") db.taskArtifact.findUnique.mockResolvedValue(null);
  expect(await readPersistedSemanticReviewRequest(subject)).toBeNull();
});

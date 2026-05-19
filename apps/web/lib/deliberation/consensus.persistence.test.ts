import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import net from "node:net";
import type { PrismaClient } from "@dpf/db";
import type { applyConsensusOutcome as ApplyConsensusOutcome } from "./consensus";
import type { BranchVote, ConsensusDecision } from "./consensus";

const buildId = "FB-test";
const userEmail = "consensus-persistence-test@example.com";

const votes: BranchVote[] = [
  {
    roleSlug: "skeptic",
    confidence: 0.42,
    criticalObjection: true,
    objectionText: "Escalation needs a human decision.",
  },
];

const escalateOutcome: ConsensusDecision = {
  decision: "escalate",
  confidence: 0,
  objections: ["Escalation needs a human decision."],
};

describe.skipIf(!process.env.DATABASE_URL)("applyConsensusOutcome persistence", () => {
  let prisma: PrismaClient;
  let applyConsensusOutcome: typeof ApplyConsensusOutcome;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.CONSENSUS_DB_URL ?? process.env.DATABASE_URL;
    const db = await import("@dpf/db");
    const consensus = await import("./consensus");
    prisma = db.prisma;
    applyConsensusOutcome = consensus.applyConsensusOutcome;
  });

  beforeEach(async () => {
    if (!(await isDatabaseAvailable())) return;
    await prisma.featureBuild.deleteMany({ where: { buildId } });
    const user = await prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: {
        email: userEmail,
        passwordHash: "test-password-hash",
      },
    });

    await prisma.featureBuild.create({
      data: {
        buildId,
        title: "Consensus persistence test",
        createdById: user.id,
      },
    });
  });

  afterEach(async () => {
    if (!(await isDatabaseAvailable())) return;
    await prisma.featureBuild.deleteMany({ where: { buildId } });
  });

  afterAll(async () => {
    if (!(await isDatabaseAvailable())) return;
    await prisma.user.deleteMany({ where: { email: userEmail } });
  });

  it("writes branches and hitl to FeatureBuild.deliberationSummary", async (context) => {
    if (!(await isDatabaseAvailable())) {
      context.skip();
    }

    const before = await prisma.featureBuild.findUniqueOrThrow({
      where: { buildId },
      select: { deliberationSummary: true },
    });
    expect(before.deliberationSummary).toBeNull();

    await applyConsensusOutcome(buildId, escalateOutcome, votes, prisma);

    const updated = await prisma.featureBuild.findUniqueOrThrow({
      where: { buildId },
      select: { deliberationSummary: true },
    });
    expect(updated.deliberationSummary).toEqual({
      hitl: true,
      confidence: 0,
      objections: ["Escalation needs a human decision."],
      branches: votes,
    });

    const rows = await prisma.$queryRaw<
      Array<{ branches: BranchVote[]; hitl: boolean }>
    >`
      SELECT
        "deliberationSummary"->'branches' AS branches,
        ("deliberationSummary"->>'hitl')::boolean AS hitl
      FROM "FeatureBuild"
      WHERE "buildId" = ${buildId}
    `;

    expect(rows).toEqual([{ branches: votes, hitl: true }]);
  });
});

async function isDatabaseAvailable(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;

  const url = new URL(databaseUrl);
  const port = Number(url.port || 5432);

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: url.hostname, port });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

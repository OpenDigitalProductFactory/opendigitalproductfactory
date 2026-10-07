// Administrator-only callers own approval. This module owns state comparison
// and atomic application; it never combines grants from two authority records.
import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { CANONICAL_AGENT_ID_TO_COWORKER_SLUG } from "@dpf/db/agent-identity";
import { coworkerAuthorityAgentId } from "@/lib/coworker-identity";
import { isKnownGrantKey } from "./coworker-tool-grant-core";
import { ok } from "@/lib/shared/action-result";

type Db = Pick<Prisma.TransactionClient, "agent" | "agentToolGrant" | "agentToolGrantRevocation">;
const include = { toolGrants: { orderBy: { grantKey: "asc" as const } }, toolGrantRevocations: { orderBy: { grantKey: "asc" as const } } };
type Row = Prisma.AgentGetPayload<{ include: typeof include }>;
export type GrantState = "granted" | "revoked" | "absent";
export type GrantReconciliationPreview = {
  canonicalAgentId: string;
  aliasAgentId: string | null;
  digest: string;
  differences: Array<{ grantKey: string; canonical: GrantState; alias: GrantState }>;
};

function state(row: Row | null, key: string): GrantState {
  if (row?.toolGrantRevocations.some((r) => r.grantKey === key)) return "revoked";
  return row?.toolGrants.some((g) => g.grantKey === key) ? "granted" : "absent";
}

async function read(ref: string, db: Db) {
  const canonicalAgentId = coworkerAuthorityAgentId(ref);
  const aliasAgentId = CANONICAL_AGENT_ID_TO_COWORKER_SLUG[canonicalAgentId] ?? null;
  const canonical = await db.agent.findFirst({ where: { agentId: canonicalAgentId }, include });
  if (!canonical) throw new Error("Canonical authority record is missing. Administrator provisioning is required.");
  const alias = aliasAgentId ? await db.agent.findFirst({ where: { agentId: aliasAgentId }, include }) : null;
  const keys = [...new Set([canonical, alias].flatMap((row) => row
    ? [...row.toolGrants, ...row.toolGrantRevocations].map((g) => g.grantKey) : []))].sort();
  // Include provenance and IDs: any edit invalidates approval, even if access
  // happens to remain the same. No client-authored grant set enters this hash.
  const snapshot = (row: Row | null) => row ? { id: row.id, grants: row.toolGrants, revocations: row.toolGrantRevocations } : null;
  const digest = createHash("sha256").update(JSON.stringify([snapshot(canonical), snapshot(alias)])).digest("hex");
  const preview: GrantReconciliationPreview = { canonicalAgentId, aliasAgentId: alias?.agentId ?? null, digest,
    differences: alias ? keys.filter((key) => state(canonical, key) !== state(alias, key))
      .map((grantKey) => ({ grantKey, canonical: state(canonical, grantKey), alias: state(alias, grantKey) })) : [] };
  return { canonical, alias, preview };
}

export async function previewCoworkerGrantReconciliation(ref: string, db: Db = prisma): Promise<GrantReconciliationPreview> {
  return (await read(ref, db)).preview;
}

export async function reconcileCoworkerGrants(input: {
  coworkerRef: string;
  digest: string;
  choices: Array<{ grantKey: string; source: "canonical" | "alias" }>;
  approvedBy: string;
}) {
  return prisma.$transaction(async (db) => {
    const { canonical, alias, preview } = await read(input.coworkerRef, db);
    if (preview.digest !== input.digest) throw new Error("Permissions changed after preview. Review a fresh preview.");
    const choices = new Map(input.choices.map((choice) => [choice.grantKey, choice.source]));
    if (choices.size !== input.choices.length || choices.size !== preview.differences.length
      || preview.differences.some((diff) => !choices.has(diff.grantKey))
      || input.choices.some((choice) => choice.source !== "canonical" && choice.source !== "alias")) {
      throw new Error("Choose a source for every difference before approving.");
    }
    for (const difference of preview.differences) {
      if (choices.get(difference.grantKey) === "canonical") continue;
      if (!alias || !isKnownGrantKey(difference.grantKey)) throw new Error("Unsupported legacy grant. Keep the canonical state.");
      const grantKey = difference.grantKey;
      const where = { agentId_grantKey: { agentId: canonical.id, grantKey } };
      if (difference.alias === "granted") {
        const source = alias.toolGrants.find((g) => g.grantKey === grantKey)!;
        await db.agentToolGrant.upsert({ where,
          update: { grantedBy: input.approvedBy, grantedAt: source.grantedAt },
          create: { agentId: canonical.id, grantKey, grantedBy: input.approvedBy, grantedAt: source.grantedAt } });
        await db.agentToolGrantRevocation.deleteMany({ where: { agentId: canonical.id, grantKey } });
      } else {
        await db.agentToolGrant.deleteMany({ where: { agentId: canonical.id, grantKey } });
        // Absence is a deliberate removal too: preserve it across seed runs.
        const source = alias.toolGrantRevocations.find((r) => r.grantKey === grantKey);
        await db.agentToolGrantRevocation.upsert({ where,
          update: { revokedBy: source?.revokedBy ?? input.approvedBy, revokedAt: source?.revokedAt ?? new Date() },
          create: { agentId: canonical.id, grantKey, revokedBy: source?.revokedBy ?? input.approvedBy, ...(source ? { revokedAt: source.revokedAt } : {}) } });
      }
    }
    // Alias rows remain historical execution records. No authority is written
    // back to them and no seed or runtime may read them as an alternate owner.
    return ok();
  }, { isolationLevel: "Serializable" });
}

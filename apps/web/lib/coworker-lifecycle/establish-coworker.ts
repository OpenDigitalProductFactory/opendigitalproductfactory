// Coworker factory door (EP-COWORKER-LIFECYCLE Phase 3, BI-2C4056BF).
//
// The single door for creating a coworker from any dev surface (MCP tool,
// server action, Build Studio). It creates the DB-side half of a coworker —
// Agent row in lifecycleStage "draft", tool grants (tombstone-honoring),
// model floor, principal link — and returns the CODE-side definition
// checklist the Phase 1 conformance gate enforces. A draft coworker is not
// summonable (lifecycle-gate) until its definition lands via PR and it is
// promoted after passing behavioral certification (Phase 2).
//
// promoteCoworker closes the loop: draft → production only when the
// definition is in the canonical roster AND the coworker holds a passing
// certification. This is the draft→defined→certified→active state machine
// expressed over the existing lifecycleStage vocabulary ("draft" and
// "production" are the load-bearing states; "defined" and "certified" are
// derived facts, not stored stages).

import { prisma } from "@dpf/db";
import { COWORKER_AGENT_SEEDS } from "@dpf/db/workforce-seed";
import { knownGrantKeys } from "@/lib/tak/agent-grants";
import { loadCertificationStates } from "./certification-status";

const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const MODEL_TIERS = new Set(["frontier", "strong", "adequate", "basic"]);

export type EstablishCoworkerInput = {
  agentId: string;
  name: string;
  description: string;
  valueStream?: string;
  sensitivity?: "internal" | "confidential" | "restricted";
  grants?: string[];
  minimumTier?: string;
};

export type EstablishCoworkerResult =
  | { ok: true; agentId: string; stage: "draft"; checklist: string[] }
  | { ok: false; code: string; message: string };

/**
 * The code-side steps a draft coworker's author must land via PR before the
 * Phase 1 conformance gate passes and the coworker can be promoted. Returned
 * by the factory door so any surface hands the author the same paved road.
 */
export function definitionChecklist(agentId: string): string[] {
  return [
    `Add ${agentId} to COWORKER_AGENT_SEEDS in packages/db/src/workforce-seed.ts (roster entry: name, tier, valueStream, sensitivity).`,
    `Add ${agentId} grants to HARDCODED_COWORKER_GRANTS in the same file — DB grants written by this door are re-seeded from that map on every boot, so the map is the durable source.`,
    `Bind ${agentId} to a route: ROUTE_AGENT_MAP persona in apps/web/lib/tak/agent-routing.ts + sensitivity mirror in route-context-map.ts (LIFE-003/LIFE-007).`,
    `Add a model floor row to AGENT_MODEL_CONFIG_DEFAULTS in packages/db/src/agent-model-defaults.ts (LIFE-005).`,
    `Map ${agentId} to a profession family in docs/professions/registry.json (seed.test.ts invariant).`,
    `Optionally: curated golden journey in apps/web/lib/coworker-lifecycle/golden-journeys.ts, service-catalog offer, COWORKER_SELF_TASKS entry.`,
    `The coworker-definition-conformance CI gate (apps/web/lib/coworker-lifecycle/) fails on any missing axis. After the definition lands and the nightly certification sweep passes, promote with establish_coworker action="promote".`,
  ];
}

export async function establishCoworker(
  input: EstablishCoworkerInput,
  createdBy: string,
): Promise<EstablishCoworkerResult> {
  const agentId = input.agentId?.trim().toLowerCase() ?? "";
  if (!AGENT_ID_PATTERN.test(agentId)) {
    return {
      ok: false,
      code: "invalid_agent_id",
      message: "agentId must be a kebab-case slug (3-64 chars, lowercase letters/digits/dashes).",
    };
  }
  if (!input.name?.trim() || !input.description?.trim()) {
    return { ok: false, code: "missing_fields", message: "name and description are required." };
  }
  if (input.minimumTier && !MODEL_TIERS.has(input.minimumTier)) {
    return {
      ok: false,
      code: "invalid_tier",
      message: `minimumTier must be one of: frontier, strong, adequate, basic.`,
    };
  }

  const grants = [...new Set(input.grants ?? [])];
  const known = new Set(knownGrantKeys());
  const deadGrants = grants.filter((g) => !known.has(g));
  if (deadGrants.length > 0) {
    return {
      ok: false,
      code: "unknown_grant_keys",
      message: `No tool honors these grant keys (they would authorize nothing): ${deadGrants.join(", ")}. Use keys from the closed grant vocabulary.`,
    };
  }

  const existing = await prisma.agent.findFirst({
    where: { OR: [{ agentId }, { slugId: agentId }] },
    select: { agentId: true, lifecycleStage: true },
  });
  if (existing) {
    return {
      ok: false,
      code: "already_exists",
      message: `${existing.agentId} already exists (stage: ${existing.lifecycleStage}).`,
    };
  }

  const agent = await prisma.agent.create({
    data: {
      agentId,
      slugId: agentId,
      name: input.name.trim(),
      displayName: input.name.trim(),
      kind: "specialist",
      tier: 2,
      type: "coworker",
      description: input.description.trim(),
      valueStream: input.valueStream ?? null,
      sensitivity: input.sensitivity ?? "internal",
      status: "active",
      lifecycleStage: "draft",
    },
  });

  // Tombstone-honoring grant writes (BI-4FA040D5 pattern from bootstrap-first-run).
  const revoked = await prisma.agentToolGrantRevocation.findMany({
    where: { agentId: agent.id },
    select: { grantKey: true },
  });
  const revokedKeys = new Set(revoked.map((r) => r.grantKey));
  for (const grantKey of grants) {
    if (revokedKeys.has(grantKey)) continue;
    await prisma.agentToolGrant.upsert({
      where: { agentId_grantKey: { agentId: agent.id, grantKey } },
      update: {},
      create: { agentId: agent.id, grantKey, grantedBy: createdBy },
    });
  }

  await prisma.agentModelConfig.upsert({
    where: { agentId },
    update: {},
    create: {
      agentId,
      minimumTier: input.minimumTier ?? "adequate",
      budgetClass: "balanced",
      minimumCapabilities: { toolUse: true },
    },
  });

  const { syncAgentPrincipal } = await import("@/lib/identity/principal-linking");
  await syncAgentPrincipal(agentId);

  return { ok: true, agentId, stage: "draft", checklist: definitionChecklist(agentId) };
}

export type PromoteCoworkerResult =
  | { ok: true; agentId: string; stage: "production" }
  | { ok: false; code: string; message: string };

export async function promoteCoworker(agentRef: string): Promise<PromoteCoworkerResult> {
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId: agentRef }, { slugId: agentRef }] },
    select: { agentId: true, lifecycleStage: true },
  });
  if (!agent) {
    return { ok: false, code: "unknown_agent", message: `No agent found for "${agentRef}".` };
  }
  if (agent.lifecycleStage !== "draft") {
    return {
      ok: false,
      code: "not_draft",
      message: `${agent.agentId} is in stage "${agent.lifecycleStage}" — only draft coworkers are promoted.`,
    };
  }

  // Defined: the canonical roster (Phase 1 contract source) must include it.
  const inRoster = COWORKER_AGENT_SEEDS.some((seed) => seed.agentId === agent.agentId);
  if (!inRoster) {
    return {
      ok: false,
      code: "not_defined",
      message: `${agent.agentId} is not in COWORKER_AGENT_SEEDS — its definition has not landed. Complete the establish_coworker checklist first.`,
    };
  }

  // Certified: a passing (fresh or stale) certification from the Phase 2 sweep.
  const states = await loadCertificationStates(
    [agent.agentId],
    prisma as unknown as Parameters<typeof loadCertificationStates>[1],
  );
  const cert = states.get(agent.agentId);
  if (cert?.status !== "certified" && cert?.status !== "stale") {
    return {
      ok: false,
      code: "not_certified",
      message: `${agent.agentId} has no passing behavioral certification (status: ${cert?.status ?? "never"}). Run the coworker-certification sweep (ops/coworker-certification.requested) and fix any failed oracles first.`,
    };
  }

  await prisma.agent.update({
    where: { agentId: agent.agentId },
    data: { lifecycleStage: "production" },
  });
  return { ok: true, agentId: agent.agentId, stage: "production" };
}

// apps/web/scripts/approval-convergence-probe.ts
//
// Approval convergence A2 probe (BI-C8EC05C9; AC-PROBE). READ-ONLY.
//
// Dry-runs convert-and-run (spec D5) for every live pending AgentActionProposal
// through the real authority resolver and evaluator, GAID principal
// resolution, the pre-tool hooks and the alignment requirement, and prints one
// refusal code per row plus each owner's activity. Run by an agent before
// PR-B and PR-C and recorded as workroom evidence; never run by CI.
//
// Read-only by construction: the session is opened with
// `default_transaction_read_only=on`, verified before anything is read, so the
// database refuses any write a resolver or hook might attempt (it is then
// reported as that row's `hook-error` / `authority-evidence-unavailable`).
// No tool handler is ever called.
//
// Usage (DATABASE_URL in the environment; it is never printed):
//   pnpm --filter web exec tsx --tsconfig scripts/tsconfig.gpp-map.json \
//     scripts/approval-convergence-probe.ts [--json]
//
// Without host credentials, the row and owner facts alone come from:
//   pnpm --filter web exec tsx scripts/approval-convergence-probe.ts --print-facts-sql
// piped into `psql` inside the database container, in a BEGIN READ ONLY
// transaction. That does not run the resolver; report the refusal codes as unrun.

/** Row and owner facts for each pending proposal (the read-only SQL fallback). */
export const PENDING_PROPOSAL_FACTS_SQL = `
SELECT p."proposalId", p."actionType", p."agentId", p."taskRunId",
       date_part('day', now() - p."proposedAt")::int AS age_days,
       t."userId" AS owner_id, u."isActive" AS owner_active, u."lastSeenAt" AS owner_last_seen,
       (a.id IS NOT NULL) AS agent_active,
       EXISTS (SELECT 1 FROM "PrincipalAlias" pa JOIN "PrincipalAlias" g ON g."principalId" = pa."principalId" AND g."aliasType" = 'gaid'
               WHERE pa."aliasType" = 'agent' AND pa."aliasValue" = p."agentId" AND pa.issuer = '') AS agent_gaid
FROM "AgentActionProposal" p
JOIN "AgentThread" t ON t.id = p."threadId"
LEFT JOIN "User" u ON u.id = t."userId"
LEFT JOIN "Agent" a ON (a."agentId" = p."agentId" OR a.id = p."agentId") AND a.status = 'active' AND a.archived = false
WHERE p.status = 'proposed'
ORDER BY p."actionType", p."proposedAt";`;

const READ_ONLY_OPTION = "-c default_transaction_read_only=on";

function withReadOnlySession(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const existing = url.searchParams.get("options");
  url.searchParams.set("options", existing ? `${existing} ${READ_ONLY_OPTION}` : READ_ONLY_OPTION);
  return url.toString();
}

async function main(): Promise<void> {
  if (process.argv.includes("--print-facts-sql")) {
    console.log(PENDING_PROPOSAL_FACTS_SQL.trim());
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Use --print-facts-sql for the read-only SQL fallback.");
    process.exit(2);
  }
  process.env.DATABASE_URL = withReadOnlySession(databaseUrl);

  const { prisma } = await import("@dpf/db");
  const [{ default_transaction_read_only: readOnly }] = await prisma.$queryRawUnsafe<Array<{ default_transaction_read_only: string }>>(
    "SHOW default_transaction_read_only",
  );
  if (readOnly !== "on") {
    console.error("Refusing to run: the session is not read-only.");
    process.exit(3);
  }

  const [{ PLATFORM_TOOLS }, decision, resolver, grants, gaid, policy, users, governed, probe] = await Promise.all([
    import("@/lib/mcp-tools"),
    import("@/lib/govern/authority/coworker-authority-decision"),
    import("@/lib/govern/authority/resolve-coworker-tool-authority"),
    import("@/lib/tak/agent-grants"),
    import("@/lib/tak/gaid-actor-envelope"),
    import("@/lib/tak/consequential-tool-policy"),
    import("@/lib/govern/current-user-context"),
    import("@/lib/mcp-governed-execute"),
    import("@/lib/coworker/approval-convergence-probe"),
  ]);
  const { registerServerToolGovernanceHooks } = await import("@/lib/governance/register-tool-governance-hooks");
  registerServerToolGovernanceHooks();

  const pending = await prisma.agentActionProposal.findMany({
    where: { status: "proposed" },
    orderBy: [{ actionType: "asc" }, { proposedAt: "asc" }],
    select: {
      proposalId: true, actionType: true, parameters: true, agentId: true, threadId: true, taskRunId: true, proposedAt: true,
      thread: { select: { user: { select: { id: true, isActive: true, lastSeenAt: true } } } },
    },
  });

  const now = new Date();
  const results = [];
  for (const row of pending) {
    results.push(await probe.probePendingProposal(
      { ...row, owner: row.thread.user ?? null },
      {
        findTool: (name) => PLATFORM_TOOLS.find((tool) => tool.name === name),
        userContext: (userId) => users.currentUserContext(userId),
        agentGrantAllowed: async (agentId, toolName) =>
          grants.isToolAllowedByGrants(toolName, await grants.getAgentToolGrantsAsync(agentId)),
        resolveAuthorityInput: (args) => resolver.resolveCoworkerToolAuthorityInput(args),
        evaluate: decision.evaluateCoworkerAuthority,
        resolveGaid: (args) => gaid.resolveGaidActorEnvelope(args),
        preToolHooks: (args) => governed.runPreToolHooks(args),
        alignmentRequired: (tool, toolName) => policy.classifyConsequentialTool({ tool, toolName }).alignmentRequired,
      },
      now,
    ));
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ probedAt: now.toISOString(), summary: probe.summarizeProbe(results), rows: results }, null, 2));
  } else {
    console.log(`probed ${results.length} pending proposals at ${now.toISOString()}`);
    console.log(JSON.stringify(probe.summarizeProbe(results), null, 2));
    for (const row of results) {
      console.log([row.proposalId, row.actionType, row.agentId, row.refusal, row.escalation ?? "-", `gaid=${row.gaid}`,
        `hook=${row.hook}`, `align=${row.alignmentRequired}`, `owner=${row.ownerId}`, `active=${row.ownerActive}`,
        `lastSeen=${row.ownerLastSeenAt ?? "never"}`, `age=${row.ageDays}d`].join("\t"));
    }
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

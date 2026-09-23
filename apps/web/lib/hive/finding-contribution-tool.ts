// The MCP surface for contributing a FINDING (BI-1281A164).
//
// Kept out of contribution-hive-pack.ts deliberately: that file is already over
// the module-size ceiling, and a tool pack should be a registration list rather
// than a place handlers accumulate. The pack imports the definition and the
// handler and stays a list.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

export const contributeFindingToHiveDefinition: ToolDefinition =
{
    name: "contribute_finding_to_hive",
    description:
      "Contribute a durable FINDING upstream — a platform fact, a technique, a defect nobody else should have to rediscover. This is step 4 of routing a learning to the commons: the step that turns install-local knowledge into platform-wide knowledge. Skipping it leaves the learning true on one install only. "
      + "Use it for a finding you already captured with `propose_improvement`; pass that call's proposalId (IP-...). Use `contribute_to_hive` instead when you are contributing SHIPPED CODE — that one packages a build's diff and needs an active build. This one needs neither a build nor a diff, which is why an external session can call it at all. "
      + "It sends under this install's pseudonym, never a person, and through the same redaction and the same private/fork-only refusals as every other outbound path. "
      + "Refusals are informative, not errors to retry: 'already-contributed' (it left the install earlier; a second send would file a duplicate), 'no-backlog-item' (a low-severity reference-doc note is batched by the canonical digest instead), 'escalation-refused' (carries the reason verbatim — 'install is private' is a correct answer, not a failure). "
      + "The proposal is marked contributed only after the escalation actually files, so a refusal never leaves a finding that looks sent and is not.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: {
          type: "string",
          description: "The improvement proposal id (IP-...), as returned by propose_improvement or listed by the local-only knowledge sweep.",
        },
      },
      required: ["proposalId"],
    },
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
    consequence: "outward", consequenceScope: "platform",
    // Outward egress is a per-finding human decision, exactly as for
    // contribute_to_hive above. Fail closed rather than auto-approving a send.
    autoApproveWhen: async () => {
      return false;
    },
  };

/**
 * BI-1281A164 — contribute a FINDING, which is not a code diff.
 *
 * `contribute_to_hive` above resolves an active FeatureBuild and works from its
 * `diffPatch`. That is right for a code contribution and impossible for a
 * knowledge one: an external session holding a durable finding has no build, so
 * step 4 of `dpf-route-learning-to-commons` — the step that makes a learning
 * platform-wide — could not execute at all. This is that step, for findings.
 *
 * It introduces no transport and no policy of its own. The proposal already
 * carries a backlog item (propose_improvement files one), and
 * `escalateToUpstreamIssue` already escalates a backlog item with no build, no
 * diff and no GitHub token, through the same redaction the feedback path uses
 * and behind the same private/fork-only refusals.
 */
export async function contributeFindingToHiveHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const proposalId = String(params["proposalId"] ?? "").trim();
  if (!proposalId) {
    return { success: false, error: "proposalId is required.", message: "proposalId is required (IP-...)." };
  }

  const { prisma } = await import("@dpf/db");
  const { contributeFindingToHive } = await import("@/lib/hive/finding-contribution-store");
  const { escalateToUpstreamIssue } = await import("@/lib/build/issue-bridge");
  const { getDisplayPseudonym } = await import("@/lib/build/identity-privacy");

  const result = await contributeFindingToHive({
    db: prisma as never,
    proposalId,
    escalate: async (input) => {
      // issue-bridge calls a successful escalation "created"; this module calls
      // it "filed", matching the feedback path's vocabulary. Mapped here rather
      // than renaming either, so neither side has to learn the other's word.
      const outcome = await escalateToUpstreamIssue(input);
      if (outcome.status === "created") {
        return { status: "filed", issueNumber: outcome.issueNumber, url: outcome.url };
      }
      if (outcome.status === "skipped") return { status: "skipped", reason: outcome.reason };
      return { status: "failed", error: outcome.error };
    },
    pseudonym: getDisplayPseudonym,
  });

  if (!result.contributed) {
    return { success: false, error: result.reason, message: result.detail, data: { reason: result.reason } };
  }

  return {
    success: true,
    message:
      `Contributed ${result.proposalId} to the hive as ${result.url ?? `issue #${result.issueNumber}`}. `
      + "It was sent under this install's pseudonym, redacted, and recorded on the contribution ledger.",
    data: { proposalId: result.proposalId, issueNumber: result.issueNumber, url: result.url },
  };
}


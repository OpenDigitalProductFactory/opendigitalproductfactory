// BI-0012E6CA — an approval's lifetime is proportional to the action, and a
// lapse is a visible outcome rather than a silent cancel.
//
// Reproduction (2026-10-01): an external agent's merge_backlog_items call
// minted envelope cmupffie10cdu01t491xmoiby with expiresAt = now + 15 minutes.
// Every authority envelope gets the same fixed window
// (AUTHORITY_APPROVAL_TTL_MS), so a request raised while the operator is away
// lapses before they return. When the agent re-asks, the lapsed proposal is
// written as `cancelled` — the mark for "a person acted" — which is the
// opposite of what happened.
import { describe, expect, it, vi } from "vitest";

import {
  buildCoworkerApprovalBinding,
  evaluateCoworkerAuthority,
  type CoworkerApprovalBinding,
  type CoworkerAuthorityInput,
} from "@/lib/govern/authority/coworker-authority-decision";
import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import {
  AUTHORITY_APPROVAL_TTL_MS,
  ensureAuthorityApprovalEnvelope,
} from "./authority-approval-envelope";

const NOW = new Date("2026-10-01T04:00:00Z");
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function binding(toolName: string): CoworkerApprovalBinding {
  return {
    actingHumanUserId: "user-1",
    actingAgentId: "AGT-EXT-CODEX",
    chainId: null,
    taskRunId: null,
    toolName,
    subject: { kind: "platform", id: "dpf" },
    routeContext: null,
    inputFingerprint: `input-${toolName}`,
    sensitivity: "internal",
    decisionVersionFingerprint: "policy-fingerprint",
  };
}

function db() {
  return {
    coworkerActionEnvelope: {
      findFirst: vi.fn(async (_args: unknown) => null),
      create: vi.fn(async (args: { data: { expiresAt: Date } }) => ({
        id: "ENV-NEW",
        status: "proposed",
        expiresAt: args.data.expiresAt,
      })),
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
    },
    taskRun: { updateMany: vi.fn() },
    agentThread: {
      upsert: vi.fn(async (args: { where: { id: string } }) => ({ id: args.where.id })),
    },
  };
}

/**
 * The gate knows the call's resolved consequence when it mints the envelope
 * (input.action.consequence, after per-call refinement). The fix passes it
 * through; today the parameter does not exist and is ignored.
 */
type MintInput = Parameters<typeof ensureAuthorityApprovalEnvelope>[0];
function mint(toolName: string, consequence: "outward" | "irreversible" | "authority" | null): MintInput {
  return {
    binding: binding(toolName),
    authorityDecisionId: "AUTH-1",
    threadId: "THREAD-1",
    explanation: "Approval is required.",
    now: NOW,
    consequence,
  } as MintInput;
}

function mintedLifetimeMs(mockDb: ReturnType<typeof db>): number {
  const call = mockDb.coworkerActionEnvelope.create.mock.calls[0]![0] as { data: { expiresAt: Date } };
  return call.data.expiresAt.getTime() - NOW.getTime();
}

describe("AC-TTL-PROPORTIONAL: an approval lives as long as the decision it asks for", () => {
  it("does not lapse at fifteen minutes for a durable action (merge_backlog_items, irreversible)", async () => {
    const mockDb = db();
    await ensureAuthorityApprovalEnvelope(mint("merge_backlog_items", "irreversible"), mockDb);
    // A person asleep at 04:00 must still find it in the morning.
    expect(mintedLifetimeMs(mockDb)).toBeGreaterThan(FIFTEEN_MINUTES);
    expect(mintedLifetimeMs(mockDb)).toBeGreaterThanOrEqual(ONE_DAY);
  });

  it("does not lapse at fifteen minutes for an ordinary side effect with no declared consequence", async () => {
    const mockDb = db();
    await ensureAuthorityApprovalEnvelope(mint("create_backlog_item", null), mockDb);
    expect(mintedLifetimeMs(mockDb)).toBeGreaterThanOrEqual(ONE_DAY);
  });

  it("keeps the short window for a time-bound action (outward: it leaves the install and cannot be recalled)", async () => {
    const mockDb = db();
    await ensureAuthorityApprovalEnvelope(mint("send_marketing_email", "outward"), mockDb);
    expect(mintedLifetimeMs(mockDb)).toBe(FIFTEEN_MINUTES);
  });

  it("re-checks staleness at execution: an approval older than the short window does not authorize a call now classified time-bound", () => {
    // A durable approval was given a long window at mint. If, at execution, the
    // same exact call resolves to a time-bound consequence (outward), the
    // lifetime is judged against the CURRENT classification, not the stored
    // expiresAt alone.
    const input: CoworkerAuthorityInput = {
      authContext: {
        principalId: "PRN-HUMAN",
        principalAliases: [],
        population: "workforce",
        platformRole: "HR-200",
        isSuperuser: false,
        employeeId: "EMP-1",
        managerScope: { directReportIds: [], indirectReportIds: [] },
        teamIds: [],
        accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
        sensitivityClearance: ["public", "internal", "confidential"],
        authentication: { source: "session", methods: ["pwd"], contextClassReference: "urn:dpf:pwd" },
        actingHumanUserId: "user-1",
        actingAgentId: "AGT-EXT-CODEX",
        delegationGrantIds: [],
        grantedCapabilities: ["manage_backlog"],
      } as EffectiveAuthContext,
      action: {
        toolName: "contribute_to_hive",
        requiredCapability: "manage_backlog",
        agentGrantAllowed: true,
        sideEffect: true,
        executionMode: "immediate",
        routeContext: null,
        approvalPolicy: "side-effects",
        consequence: "outward",
      },
      subject: { kind: "platform", id: "dpf" },
      delegation: null,
      integration: { required: false, state: "not-required" },
      dataPolicy: {
        sensitivity: "internal",
        maskingRequired: false,
        maskingSatisfied: true,
        decisionVersionsCurrent: true,
      },
      task: null,
      rawParams: { buildId: "FB-1" },
      now: NOW,
    };
    const approvedTwoHoursAgo = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const decision = evaluateCoworkerAuthority({
      ...input,
      approval: {
        status: "approved",
        // stored window still open (minted under a durable classification)
        expiresAt: new Date(NOW.getTime() + 6 * ONE_DAY),
        binding: buildCoworkerApprovalBinding(input),
        approvedAt: approvedTwoHoursAgo,
      } as NonNullable<CoworkerAuthorityInput["approval"]>,
    });
    expect(decision).toMatchObject({ outcome: "deny", reasonCode: "approval-expired" });
  });
});

describe("AC-EXPIRY-VISIBLE: a lapse is recorded as expired, never as a person's cancel", () => {
  it("settles a lapsed proposal as `expired` when the same call is asked again", async () => {
    const mockDb = db();
    await ensureAuthorityApprovalEnvelope(mint("merge_backlog_items", "irreversible"), mockDb);
    const lapseWrite = mockDb.coworkerActionEnvelope.updateMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
      data: { status: string };
    };
    // `cancelled` says a person acted; envelope-state-machine.ts defines
    // `expired` for exactly this case (BI-410ACCB8) and the outcome read model
    // (approval-outcome.ts) reports a cancelled row as "cancelled".
    expect(lapseWrite.data.status).toBe("expired");
  });

  it("keeps the replay window for settled outcomes separate from the decision lifetime", () => {
    // findExecutedAuthorityOutcome reuses AUTHORITY_APPROVAL_TTL_MS as its
    // replay window. Lengthening the decision lifetime must not silently
    // lengthen replay; the constant stays the short window.
    expect(AUTHORITY_APPROVAL_TTL_MS).toBe(FIFTEEN_MINUTES);
  });
});

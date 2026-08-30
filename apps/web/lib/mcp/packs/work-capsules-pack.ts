// Work-capsules tool pack — BI-ARCH-TOOLPACKS.
//
// Third domain pack, second lazy one. Handlers live in
// @/lib/work-capsules/mcp-handlers and were dynamically imported per switch
// case; each handler here is a thin wrapper that lazy-imports the module only
// when the tool is called, passing the same arguments the switch case did (the
// two read tools take params only; the write tools take params + userId +
// context). Definitions were moved verbatim out of the inline PLATFORM_TOOLS
// array; grants mirror agent-grants.ts TOOL_TO_GRANTS.

import type { ToolDefinition } from "@/lib/mcp-tools";
import { workCapsuleToolEnums } from "@/lib/work-capsules/mcp-handlers";
import type { ToolPack } from "../tool-pack";

const ENUMS = workCapsuleToolEnums();

const scopeProperties = {
  decisionScope: { type: "string", enum: ENUMS.decisionScopes, description: "WWMD, WWWD, or WSID activity scope." },
  portfolioRole: { type: "string", enum: ENUMS.portfolioRoles, description: "Primary portfolio role coordinated by the capsule." },
  servedPersona: { type: "string", description: "Human-readable persona served by the activity." },
  activityKind: { type: "string", enum: ENUMS.scopeActivityKinds, description: "Kind of outcome activity coordinated by the capsule." },
  workroomShape: {
    type: "string",
    enum: ENUMS.workroomShapes,
    description:
      "How a gate inside this room routes. Sets the room's action envelope and its posture: outward-review and approval-sign-off require verification before an action leaves, escalation raises urgency, craft-stewardship stays quiet. Omit when the room genuinely has no gate pattern — an unshaped room is reported as unshaped rather than guessed.",
  },
  outcomeAnchor: {
    type: "object",
    additionalProperties: true,
    properties: {
      kind: { type: "string", enum: ENUMS.outcomeAnchorKinds },
      id: { type: "string" },
      label: { type: "string" },
      url: { type: "string" },
      source: { type: "string" },
    },
    description: "Optional business, platform, coworker, or document outcome anchor.",
  },
  servesPortfolioRoles: {
    type: "array",
    items: { type: "string", enum: ENUMS.portfolioRoles },
    description: "Portfolio roles this activity serves.",
  },
  dependsOnPortfolioRoles: {
    type: "array",
    items: { type: "string", enum: ENUMS.portfolioRoles },
    description: "Portfolio roles this activity depends on.",
  },
} as const;

const definitions: ToolDefinition[] = [
  {
    name: "list_workrooms",
    description:
      "List Workroom coordination records for active portal, Build Studio, and external agent work, each annotated with its TRUE liveness (live | lease-expired | build-terminal | idle-stale | no-signal). Liveness is derived from lease expiry, the linked build's phase, an open PR, and last sync — NOT from updatedAt, which a daily heartbeat freezes for Build Studio capsules, so a `working` status is not proof of life. Includes a livenessSummary (live vs reap-candidate counts). Pass staleOnly=true for just the not-live reap candidates. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ENUMS.statuses, description: "Filter by Workroom status." },
        decisionScope: { type: "string", enum: ENUMS.decisionScopes, description: "Filter by WWMD, WWWD, or WSID scope." },
        portfolioRole: { type: "string", enum: ENUMS.portfolioRoles, description: "Filter by primary portfolio role." },
        staleOnly: { type: "boolean", description: "Return only capsules that are NOT truly live (reap candidates). Default false." },
        limit: { type: "number", description: "Max results (default 50, max 100)." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_workroom",
    description: "Fetch one Workroom with its recent activity timeline. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
      },
      required: ["capsuleId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "create_workroom",
    description: "Create a Workroom coordination record for planned work. Idempotency key is required so retries do not duplicate workroom activity.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short workroom title." },
        objective: { type: "string", description: "Outcome this workroom coordinates." },
        source: { type: "string", enum: ENUMS.sources, description: "Origin of the capsule." },
        idempotencyKey: { type: "string", description: "Stable caller-provided key used to make create retries idempotent." },
        executorKind: { type: "string", enum: ENUMS.executors, description: "Optional executor expected to work the capsule." },
        repositoryFullName: { type: "string", description: "Optional GitHub repository full name; defaults to the platform repo. The workroom's durable branch identity is keyed on (repository, branch)." },
        ...scopeProperties,
      },
      required: ["title", "objective", "source", "idempotencyKey"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "plan_workroom_worktree",
    description: "Generate and persist the deterministic branch and worktree-path plan for a Workroom. Idempotent: re-planning returns the existing plan and refuses to propose the root clone.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        taxonomy: { type: "string", enum: ENUMS.taxonomies, description: "AGENTS.md branch prefix." },
      },
      required: ["capsuleId", "taxonomy"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "adopt_worktree",
    description: "Adopt an existing local branch/worktree pair into a Workroom without creating a new worktree. Pass backlogItemId to bind the work: the returned Workroom carries the binding or the call fails, never a partly-bound record. A branch has one durable workroom identity; a terminal Workroom with no backlog item is resumed and rebound rather than blocking the branch, while a foreign binding returns branch_occupied instead of overwriting history.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short workroom title." },
        objective: { type: "string", description: "Outcome this adopted work should reach." },
        repositoryFullName: { type: "string", description: "GitHub repository full name, for example OpenDigitalProductFactory/opendigitalproductfactory." },
        headBranch: { type: "string", description: "Existing branch to adopt." },
        worktreePath: { type: "string", description: "Local worktree path for the branch." },
        backlogItemId: { type: "string", description: "BacklogItem this work delivers (BI-*). Bound onto the Workroom and read back; an unknown id is refused rather than dropped." },
        baseBranch: { type: "string", description: "Optional base branch (defaults to main)." },
        baseSha: { type: "string", description: "Optional current base SHA." },
        headSha: { type: "string", description: "Optional current head SHA." },
        executorKind: { type: "string", enum: ENUMS.executors, description: "Optional executor adopting the worktree." },
        sessionRef: { type: "string", description: "Owner/session id, stored as the workroom executorRef. Without it a claim can be shown to exist but not shown to be yours." },
        ...scopeProperties,
      },
      required: ["title", "objective", "repositoryFullName", "headBranch", "worktreePath"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "claim_backlog_item_for_work",
    description:
      "Claim a BacklogItem for work by binding it to the worktree + branch + session you are starting in. Governed work must declare design, review, plan, or implementation intent; legacy omission is evaluated as implementation and fails closed unless canonical readiness is allowed. Claim, intent event, readiness decision, and exact identity readback share one transaction. A branch bound to a different BI returns branch_occupied and preserves its history. The BI claim remains a soft coordination signal, not a lock.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "BacklogItem id (BI-*) to claim." },
        worktreePath: { type: "string", description: "Local worktree path where the work is happening." },
        branchName: { type: "string", description: "Branch (head) for this work — the workroom is keyed on (repo, branch)." },
        repositoryFullName: { type: "string", description: "Optional GitHub repository full name; defaults to the platform repo." },
        baseBranch: { type: "string", description: "Optional base branch (defaults to main)." },
        provider: { type: "string", description: "Provider string (claude, codex, grok) — mapped to the closest executor kind." },
        sessionRef: { type: "string", description: "Owner/session id, stored as the workroom executorRef." },
        workIntent: { type: "string", enum: ["design", "review", "plan", "implementation"], description: "Lifecycle intent. Required for governed callers; omission is the legacy implementation-safe default." },
      },
      required: ["itemId", "worktreePath", "branchName", "provider", "sessionRef"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "claim_workroom_scope",
    description: "Claim path/module/package/route/skill/prompt scope for a Workroom. Edit-path claims automatically derive, persist, and return changeImpactContract with the tests and guards to address before implementation; consume it immediately, and treat status=unresolved as requiring exhaustive verification. Repeated claims refresh both scope and the full edit-path impact contract. Rejected with error=scope_conflict if another active Workroom already holds an overlapping edit claim — coordinate, claim different scope, or pass force=true to deliberately co-claim.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["path", "module", "package", "route", "skill", "prompt"] },
              value: { type: "string", description: "Claimed scope value." },
              intent: { type: "string", enum: ["edit", "read"] },
            },
            required: ["kind", "value", "intent"],
          },
          description: "Scope claims to add or refresh.",
        },
        force: { type: "boolean", description: "Deliberately co-claim scope despite an active overlap on another Workroom (default false). The override is recorded on the workroom activity log." },
      },
      required: ["capsuleId", "claims"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "heartbeat_workroom",
    description:
      "Renew the active lease for a Workroom so other agents can see that work is in flight. " +
      "Heartbeat on a human-scale cadence (between stages / few minutes), not every tool call. " +
      "If the lease is already expired, re-claim or abandon — do not thrash heartbeat.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
      },
      required: ["capsuleId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "update_workroom_status",
    description: "Set a Workroom status and record a temporary operator-visible status override reason.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        status: { type: "string", enum: ENUMS.statuses, description: "Next Workroom status." },
        reason: { type: "string", description: "Reason for the status update or override." },
      },
      required: ["capsuleId", "status", "reason"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "release_workroom_scope",
    description:
      "Release previously claimed Workroom scope items by kind and value. " +
      "Requires capsuleId (WC-*) plus claims: [{kind, value}, ...] matching prior claim_capsule_scope entries. " +
      "Call once per handoff with the full claim set — do not release item-by-item in a loop. " +
      "Do NOT retry on invalid_input — fix the payload (claims must be a non-empty array of {kind,value}). " +
      "Do NOT call for an abandoned/unknown workroom (retryable: false). " +
      "If nothing matched, success still returns (idempotent no-op on empty released set).",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["path", "module", "package", "route", "skill", "prompt"] },
              value: { type: "string", description: "Scope value to release (exact match to the prior claim)." },
            },
            required: ["kind", "value"],
          },
          description: "Scope claims to release — array required, not a single object.",
        },
      },
      required: ["capsuleId", "claims"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "record_workroom_evidence",
    description: "Append an evidence entry to a Workroom activity timeline.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        kind: { type: "string", enum: ENUMS.evidenceKinds, description: "Evidence kind." },
        summary: { type: "string", description: "Evidence summary." },
        command: { type: "string", description: "Optional command that produced the evidence." },
        url: { type: "string", description: "Optional URL for PRs, CI runs, screenshots, or external evidence." },
        targetId: { type: "string", description: "Optional stable RuntimeTarget id (RT-*)." },
        runtimeTargetId: { type: "string", description: "Optional RuntimeTarget row id." },
        verificationId: { type: "string", description: "Optional RuntimeVerification id (RV-*)." },
        result: { type: "object", description: "Optional structured result payload." },
      },
      required: ["capsuleId", "summary"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "reassign_workroom_executor",
    description:
      "Hand a Workroom off to a different executor: change the executor, transfer the active lease to the caller, and record an executor-changed event with the handoff manifest (next action, open risks, evidence digest). Renders as a plain status event, not raw agent plumbing.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        toExecutorKind: { type: "string", enum: ENUMS.executors, description: "Executor taking over the work." },
        toExecutorRef: { type: "string", description: "Optional session/owner id for the receiving executor." },
        reason: { type: "string", description: "Why the handoff is happening." },
        handoffManifest: { type: "object", description: "Optional handoff context: next action, open risks, evidence digest, branch/worktree, suggested receiver." },
      },
      required: ["capsuleId", "toExecutorKind"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
  },
  {
    name: "start_external_work",
    description:
      "Register that you are STARTING work on an external session — before any evidence — so a tracked Workroom exists immediately and the session is visible to other agents instead of appearing only after the first result. " +
      "Idempotent per session (or per repo+branch when a worktree is supplied); summary is optional at start. " +
      "Call once at session start — re-calling with the same session/worktree is a no-op, not a progress signal.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider string (claude, codex, grok, opencode) — mapped to the closest executor kind." },
        externalSessionId: { type: "string", description: "Stable id for this external session (the workroom executorRef)." },
        summary: { type: "string", description: "Optional short description of the work being started." },
        backlogItemId: { type: "string", description: "Optional BacklogItem id (BI-*) this session works." },
        worktreePath: { type: "string", description: "Optional local worktree path (enables the adopt path keyed on repo+branch)." },
        branchName: { type: "string", description: "Optional branch (head) — required with worktreePath for the adopt path." },
        repositoryFullName: { type: "string", description: "Optional GitHub repository full name; defaults to the platform repo." },
        baseBranch: { type: "string", description: "Optional base branch (defaults to main)." },
      },
      required: ["provider", "externalSessionId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "record_agent_activity",
    description:
      "Emit a human-legible session activity onto a Workroom's timeline — what the working teammate is thinking (thought), doing (action), asking (question), answering (response), or hit (error). Every executor and sub-worker writes to the same capsule, so multi-agent work reads as one teammate session on one item.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        type: { type: "string", enum: ENUMS.agentActivityKinds, description: "Activity type: thought | action | question | response | error." },
        body: { type: "string", description: "Human-legible one-line description of the activity." },
        payload: { type: "object", description: "Optional structured detail (e.g. subtaskRef, tool name)." },
      },
      required: ["capsuleId", "type", "body"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
];

const HANDLERS = () => import("@/lib/work-capsules/mcp-handlers");

export const workCapsulesPack: ToolPack = {
  packId: "work-capsules",
  definitions,
  handlers: {
    list_workrooms: (params) => HANDLERS().then((m) => m.listWorkCapsulesTool(params)),
    get_workroom: (params) => HANDLERS().then((m) => m.getWorkCapsuleTool(params)),
    create_workroom: (params, userId, context) => HANDLERS().then((m) => m.createWorkCapsuleTool(params, userId, context)),
    plan_workroom_worktree: (params, userId, context) => HANDLERS().then((m) => m.planCapsuleWorktreeTool(params, userId, context)),
    adopt_worktree: (params, userId, context) => HANDLERS().then((m) => m.adoptWorktreeTool(params, userId, context)),
    claim_backlog_item_for_work: (params, userId, context) => HANDLERS().then((m) => m.claimBacklogItemForWorkTool(params, userId, context)),
    claim_workroom_scope: (params, userId, context) => HANDLERS().then((m) => m.claimCapsuleScopeTool(params, userId, context)),
    heartbeat_workroom: (params, userId, context) => HANDLERS().then((m) => m.heartbeatCapsuleTool(params, userId, context)),
    update_workroom_status: (params, userId, context) => HANDLERS().then((m) => m.updateWorkCapsuleStatusTool(params, userId, context)),
    release_workroom_scope: (params, userId, context) => HANDLERS().then((m) => m.releaseCapsuleScopeTool(params, userId, context)),
    record_workroom_evidence: (params, userId, context) => HANDLERS().then((m) => m.recordCapsuleEvidenceTool(params, userId, context)),
    reassign_workroom_executor: (params, userId, context) => HANDLERS().then((m) => m.reassignCapsuleExecutorTool(params, userId, context)),
    start_external_work: (params, userId, context) => HANDLERS().then((m) => m.startExternalWorkTool(params, userId, context)),
    record_agent_activity: (params, userId, context) => HANDLERS().then((m) => m.recordAgentActivityTool(params, userId, context)),
    // Legacy workroom names — callable, deliberately NOT advertised in `definitions`.
    list_work_capsules: (params) => HANDLERS().then((m) => m.listWorkCapsulesTool(params)),
    get_work_capsule: (params) => HANDLERS().then((m) => m.getWorkCapsuleTool(params)),
    create_work_capsule: (params, userId, context) => HANDLERS().then((m) => m.createWorkCapsuleTool(params, userId, context)),
    plan_capsule_worktree: (params, userId, context) => HANDLERS().then((m) => m.planCapsuleWorktreeTool(params, userId, context)),
    claim_capsule_scope: (params, userId, context) => HANDLERS().then((m) => m.claimCapsuleScopeTool(params, userId, context)),
    heartbeat_capsule: (params, userId, context) => HANDLERS().then((m) => m.heartbeatCapsuleTool(params, userId, context)),
    update_work_capsule_status: (params, userId, context) => HANDLERS().then((m) => m.updateWorkCapsuleStatusTool(params, userId, context)),
    release_capsule_scope: (params, userId, context) => HANDLERS().then((m) => m.releaseCapsuleScopeTool(params, userId, context)),
    record_capsule_evidence: (params, userId, context) => HANDLERS().then((m) => m.recordCapsuleEvidenceTool(params, userId, context)),
    reassign_capsule_executor: (params, userId, context) => HANDLERS().then((m) => m.reassignCapsuleExecutorTool(params, userId, context)),
  },
  grants: {
    list_workrooms: ["work_capsule_read"],
    get_workroom: ["work_capsule_read"],
    create_workroom: ["work_capsule_write"],
    plan_workroom_worktree: ["work_capsule_write"],
    adopt_worktree: ["work_capsule_adopt"],
    claim_backlog_item_for_work: ["work_capsule_adopt"],
    claim_workroom_scope: ["work_capsule_write"],
    heartbeat_workroom: ["work_capsule_write"],
    update_workroom_status: ["work_capsule_write"],
    release_workroom_scope: ["work_capsule_write"],
    record_workroom_evidence: ["work_capsule_write"],
    reassign_workroom_executor: ["work_capsule_write"],
    start_external_work: ["work_capsule_adopt"],
    record_agent_activity: ["work_capsule_write"],
    // Legacy workroom names keep their grants for the alias window.
    list_work_capsules: ["work_capsule_read"],
    get_work_capsule: ["work_capsule_read"],
    create_work_capsule: ["work_capsule_write"],
    plan_capsule_worktree: ["work_capsule_write"],
    claim_capsule_scope: ["work_capsule_write"],
    heartbeat_capsule: ["work_capsule_write"],
    update_work_capsule_status: ["work_capsule_write"],
    release_capsule_scope: ["work_capsule_write"],
    record_capsule_evidence: ["work_capsule_write"],
    reassign_capsule_executor: ["work_capsule_write"],
  },
};

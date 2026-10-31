// Work-capsules tool pack — BI-ARCH-TOOLPACKS.
//
// Third domain pack, second lazy one. Handlers live in
// @/lib/work-capsules/mcp-handlers and were dynamically imported per switch
// case; each handler here is a thin wrapper that lazy-imports the module only
// when the tool is called, passing the same arguments the switch case did (the
// two read tools take params only; the write tools take params + userId +
// context). Definitions were moved verbatim out of the inline PLATFORM_TOOLS
// array; grants mirror agent-grants.ts TOOL_TO_GRANTS.

import { workroomRuntimeConsequence } from "@/lib/workroom-runtime/runtime-consequence";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { workCapsuleToolEnums } from "@/lib/work-capsules/mcp-handlers";
import { DELIVERY_SHAPE_REFS } from "@/lib/work-management/delivery-shapes";
import { PRINCIPAL_SENSITIVITIES } from "@dpf/db/principal-sensitivity";
import type { ToolPack } from "../tool-pack";

// BI-763D6E01: optional on every receipted Workroom write.
const COMMAND_ID_PROPERTY = {
  type: "string",
  description:
    "Optional idempotency key you choose for this exact call. Retrying with the same commandId returns the first result " +
    "(or the same refusal) without doing the work twice; reusing it for a different room or tool is refused with command_id_conflict.",
} as const;

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
  workShape: {
    type: "string",
    description:
      "The standing ACTIVITY shape that drives this room, as key@version (for example dependency-advisory-watch@1.0.0). Distinct from workroomShape: that says who must be in the room for one consequential act, this says what wakes the room, which stages it moves through, who answers for each, and what stops it. A room without it never wakes on its own — the drive skips it. Use a key from the declared work-shape registry; a shape reference that is not key@version is refused rather than stored as a claim that can never match.",
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
    name: "review_workroom_sensitivity",
    description: "Read exact-room administrative classification state and a revision digest. Returns no room content or historical prose. Use before an administrator verifies an invalid declaration.",
    inputSchema: { type: "object", properties: { capsuleId: { type: "string" } }, required: ["capsuleId"] },
    requiredCapability: "manage_platform", sideEffect: false,
  },
  {
    name: "correct_workroom_sensitivity",
    description: "Correct one invalid Workroom sensitivity declaration after an administrator verifies actual classification. Requires the exact review digest and rationale; retains the original in an audit. Cannot lower a valid classification or widen global clearance. Governed approval still applies.",
    inputSchema: { type: "object", properties: {
      capsuleId: { type: "string" }, expectedDigest: { type: "string" },
      sensitivity: { type: "string", enum: [...PRINCIPAL_SENSITIVITIES] },
      classificationReviewed: { type: "boolean", const: true }, rationale: { type: "string", minLength: 20, maxLength: 2000 },
    }, required: ["capsuleId", "expectedDigest", "sensitivity", "classificationReviewed", "rationale"] },
    requiredCapability: "manage_platform", executionMode: "proposal", sideEffect: true, consequence: "authority",
  },
  {
    name: "list_workrooms",
    description:
      "List Workroom coordination records for active portal, Build Studio, and external agent work, each annotated with its TRUE liveness (live | lease-expired | build-terminal | idle-stale | no-signal). Liveness is derived from lease expiry, the linked build's phase, an open PR, and last sync — NOT from updatedAt, which a daily heartbeat freezes for Build Studio capsules, so a `working` status is not proof of life. Includes a livenessSummary (live vs reap-candidate counts). Pass staleOnly=true for just the not-live reap candidates. Use view=definitions for the bounded installed definition catalogue. Definition metadata is not exercised coverage; use only its definition cursors and no instance filters. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["instances", "definitions"], description: "Default instances lists Workroom observations. definitions lists source definitions and profile metadata. It does not assess occurrences or organization applicability. Instance filters are invalid in definitions view." },
        status: { type: "string", enum: ENUMS.statuses, description: "Filter by Workroom status." },
        decisionScope: { type: "string", enum: ENUMS.decisionScopes, description: "Filter by WWMD, WWWD, or WSID scope." },
        portfolioRole: { type: "string", enum: ENUMS.portfolioRoles, description: "Filter by primary portfolio role." },
        staleOnly: { type: "boolean", description: "Return only capsules that are NOT truly live (reap candidates). Default false." },
        headBranch: { type: "string", maxLength: 255, description: "Find the room for this branch, including one another assistant made for you." },
        pullRequestNumber: { type: "integer", minimum: 1, description: "Find the room for this pull request, including one another assistant made for you." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Requested page size (default 5, maximum 100); whole rows are reduced to fit the client budget." },
        cursor: { type: "string", maxLength: 1024, description: "Opaque continuation for the selected view. Instance and definition cursors cannot be mixed. Keep instance filters unchanged. Instance expiry or changed definition inventory requires a fresh traversal." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_workroom",
    description: "Fetch one Workroom with its recent activity timeline. Pass afterSequence to read the room's ordered log from a position you already hold: every later activity exactly once, in order (the room's activitySequence is the latest). Use activityMode:bounded for finite metadata pages or exact selected-value detail. Use continuationMode:bounded separately for one current assignment under fresh content admission; its facts grant no execution or replay authority. Metadata defers payload evidence; it is not a complete receipt. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        afterSequence: { type: "integer", minimum: 0, description: "Return data.log.activity: rows with sequence greater than this, oldest first, up to 200 (data.log.hasMore says when to read again)." },
        activityMode: { type: "string", enum: ["bounded"], description: "Read bounded metadata or selected detail instead of the full room. Recheck current content admission on each read." },
        throughSequence: { type: "integer", minimum: 0, description: "Bounded mode: preserve the first page's upper sequence bound while reading nextAfterSequence. Later writes are outside this range." },
        activityLimit: { type: "integer", minimum: 1, maximum: 20, description: "Bounded mode: requested metadata page size; whole records may fill the budget sooner." },
        activityId: { type: "string", maxLength: 200, description: "Bounded mode: exact activity ID in this room for a selected-value read. No history cursor is advanced." },
        activityField: { type: "string", enum: ["payload", "summary"], description: "Detail field; defaults to payload. Large values are refused with a narrower-path instruction." },
        payloadPath: { type: "array", maxItems: 16, items: { type: "string", maxLength: 200 }, description: "Detail only: object keys or array indexes within payload. Empty selects the whole payload; a selected value is not a full activity receipt." },
        reviewTaskRunId: { type: "string", minLength: 1, maxLength: 512, description: "Optional exact native review task to recover. Returns bounded recovery only for the authenticated task owner and this exact room, including historical source versions. Does not authorize retry or approve the current source." },
        continuationMode: { type: "string", enum: ["bounded"], description: "Read bounded current assignment facts separately from activity, review and cursor reads. Does not create an external session or authorize effects." },
        continuationTaskId: { type: "string", minLength: 1, maxLength: 512, description: "Continuation only: exact scheduled task whose own checkpoint must match this current room, branch, source and lease." },
        continuationStageKey: { type: "string", minLength: 1, maxLength: 512, description: "Continuation only: select a current manual branch instead of a task. Required when several stages are current; no task identity is invented." },
        continuationVersion: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Continuation only: prior digest. Changed facts or authenticated authority require a fresh read; this is not an execution permit." },
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
      "Claim a BacklogItem by binding its worktree, branch, and session. Governed intent, readiness, claim, and readback share one transaction, and the room is born owned: the person the work is for becomes its Process Overseer and their assistant a contributor. Pass baseSha and headSha so reviewers can be routed to the exact source. Another live Workroom refuses the claim; deliberate co-delivery requires force plus an audited reason.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "BacklogItem id (BI-*) to claim." },
        worktreePath: { type: "string", description: "Local worktree path where the work is happening." },
        branchName: { type: "string", description: "Branch (head) for this work — the workroom is keyed on (repo, branch)." },
        repositoryFullName: { type: "string", description: "Optional GitHub repository full name; defaults to the platform repo." },
        baseBranch: { type: "string", description: "Optional base branch (defaults to main)." },
        baseSha: { type: "string", description: "Full 40-character SHA of the base commit. With headSha, it lets reviewers be routed to the exact source; omit only before the first commit." },
        headSha: { type: "string", description: "Full 40-character SHA of the branch head." },
        provider: { type: "string", description: "Provider string (claude, codex, grok) — mapped to the closest executor kind." },
        sessionRef: { type: "string", description: "Owner/session id, stored as the workroom executorRef." },
        workShape: {
          type: "string",
          enum: [...DELIVERY_SHAPE_REFS],
          description:
            "The DELIVERY shape of this work as key@version: how big it is and what it owes before it is done. Declared here, or derived from the item's effortSize and work type when the classification rules agree; an implementation claim with no derivable shape is refused with work_shape_required and a pick list — put that list to the owner and re-claim, never guess. xlarge never enters implementation.",
        },
        workIntent: { type: "string", enum: ["design", "review", "plan", "implementation"], description: "Lifecycle intent. Required for governed callers; omission is the legacy implementation-safe default." },
        force: { type: "boolean", description: "Deliberately co-claim despite another live Workroom." },
        overrideReason: { type: "string", description: "Required audit reason when force overrides live ownership." },
      },
      required: ["itemId", "worktreePath", "branchName", "provider", "sessionRef"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "declare_break_fix",
    description:
      "Declare the break-fix expedite lane on a claimed backlog item (design 2026-09-02 §4): an operational repair of a live defect that skips pre-authorisation and owes a post-implementation review receipt within 48 hours by someone other than the declarer. Human-only; independent emergencies may be declared concurrently; a declarer whose earlier break-fix missed its PIR is refused. Binds delivery-break-fix@1.0.0 on the item's live Workroom and records break_fix_declared with the PIR deadline.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "BacklogItem id (BI-*) already claimed into a live Workroom." },
        reason: { type: "string", description: "The live symptom and the named ref it was reproduced on (goes on the record and the PR body)." },
      },
      required: ["itemId", "reason"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    consequence: "authority",
  },
  {
    name: "claim_workroom_scope",
    description: "Claim path/module/package/route/skill/prompt scope for a Workroom. Edit-path claims automatically derive, persist, and return changeImpactContract with the tests and guards to address before implementation; consume it immediately, and treat status=unresolved as requiring exhaustive verification. Repeated claims refresh both scope and the full edit-path impact contract. Rejected with error=scope_conflict if another active Workroom already holds an overlapping edit claim — coordinate, claim different scope, or pass force=true to deliberately co-claim.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: COMMAND_ID_PROPERTY,
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
        qualificationAdmissionToken: { type: "string", description: "Opaque server-issued qualification admission. When present, the exact binding is verified and stored atomically with the claims." },
      },
      required: ["capsuleId", "claims"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1). A plain
    // claim on the caller's own room narrows to ordinary (BI-2D65BD1B); a forced
    // claim or one over another principal's live lease stays `authority`.
    consequence: "authority",
    consequenceForCall: async (call) =>
      (await import("@/lib/work-capsules/scope-claim-consequence")).scopeClaimConsequenceForCall(call),
  },
  {
    name: "heartbeat_workroom",
    description:
      "Renew the active lease for a Workroom so other agents can see that work is in flight. " +
      "Heartbeat on a human-scale cadence (between stages / few minutes), not every tool call. " +
      "If the lease is already expired, re-claim or abandon — do not thrash heartbeat. " +
      "Refused with lease_held_by_other while another principal holds a live lease; ask the room's owner to hand it over instead.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: COMMAND_ID_PROPERTY,
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        checkpoint: {
          type: "object",
          description: "Optional note for whoever takes this room over; the latest one is kept.",
          properties: {
            nextAction: { type: "string" },
            addressing: { type: "array", items: { type: "string" }, maxItems: 20 },
            uncommittedPaths: { type: "array", items: { type: "string" }, maxItems: 50 },
            headSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
            pushed: { type: "boolean" },
            openRisks: { type: "array", items: { type: "string" }, maxItems: 20 },
          },
        },
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
    name: "resume_workroom_queue",
    description:
      "Release a Workroom's queue held after a provider failure (drive reason provider_held). " +
      "The held stage is re-armed and runs on the next dispatch. A room with no hold is a no-op. " +
      "Pass commandId to make a retry return the same answer (receipted).",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        reason: { type: "string", description: "Why the queue may run again, e.g. the provider answers again." },
        commandId: { type: "string", description: "Optional idempotency key; a retry with it replays the stored result." },
      },
      required: ["capsuleId", "reason"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // Restores the room's ability to dispatch agent work, and to spend on providers.
    consequence: "authority",
  },
  {
    name: "drive_workroom_runtime",
    description:
      "Drive an agent CLI (codex app-server or claude) as this Workroom's supervised runtime. " +
      "start opens a session with its own room-scoped MCP credential (resumes the room's stored thread); " +
      "turn sends input (queued when a turn is running); steer adds input to the running turn where the CLI supports it; " +
      "interrupt stops the running turn; stop ends the session and revokes its credential; " +
      "decide answers a request the room held for a decision (requestId from the room's question activity); status reports the session. " +
      "Everything the session does is written to the room's log (get_workroom afterSequence).",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        action: { type: "string", enum: ["start", "turn", "steer", "interrupt", "stop", "decide", "status"] },
        provider: { type: "string", enum: ["codex", "claude"], description: "start: which CLI to run." },
        prompt: { type: "string", description: "start (optional first turn), turn, steer: the input." },
        model: { type: "string", description: "start: optional model id." },
        cwd: { type: "string", description: "start: working directory inside the sandbox (default /workspace)." },
        requestId: { type: "string", description: "decide: the held request." },
        decision: { type: "string", enum: ["accept", "decline", "cancel"], description: "decide: the room's answer." },
        reason: { type: "string", description: "stop, decide: why." },
      },
      required: ["capsuleId", "action"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // Issues a room-scoped credential to a CLI and lets it act in the sandbox.
    consequence: "authority",
    consequenceForCall: workroomRuntimeConsequence,
  },
  {
    name: "approve_runtime_permission",
    description:
      "Claude Code's --permission-prompt-tool for a Workroom runtime session. Callable only with the session's own room credential; " +
      "answers {behavior: allow|deny} by the room's runtime policy, and holds anything that reaches past the sandbox for a room decision.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "The Claude Code tool asking to run." },
        input: { type: "object", description: "The tool call's input." },
        tool_use_id: { type: "string", description: "Claude's id for the call." },
      },
      required: ["tool_name", "input"],
    },
    requiredCapability: "manage_backlog",
    // Answers a question and records it on the room; it changes no state the room acts on.
    sideEffect: false,
  },
  {
    name: "rebind_workroom_shape",
    description:
      "Move a Workroom's pinned work shape (key@version) to the shape's current version (GPP §2.1.1). " +
      "dryRun (default true) returns the binding diff and whether it widens or narrows what the room can reach, and writes nothing. " +
      "Applying needs the room's accountable owner or a platform manager; a widening also needs a rationale. " +
      "A task run may preview but never apply. Refusals carry a code: not_authorized, target_not_current, not_an_upgrade, " +
      "key_change, stage_in_flight (retry after the running stage settles), rationale_required, rebind_conflict (re-read the room).",
    inputSchema: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        toVersion: { type: "string", description: "The shape's current version, e.g. 1.1.0." },
        toKey: { type: "string", description: "Optional; must equal the room's own shape key." },
        rationale: { type: "string", description: "Why the owner approves. Required to apply a widening." },
        dryRun: { type: "boolean", description: "Preview only (default true). Set false to apply." },
      },
      required: ["capsuleId", "toVersion"],
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
        commandId: COMMAND_ID_PROPERTY,
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
    consequenceForCall: (call) =>
      import("@/lib/work-capsules/scope-release-consequence").then((module) => module.scopeReleaseConsequenceForCall(call)),
  },
  {
    name: "record_workroom_evidence",
    description: "Append an evidence entry to a Workroom activity timeline.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: COMMAND_ID_PROPERTY,
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        kind: {
          type: "string",
          enum: ENUMS.evidenceKinds,
          description:
            "Evidence kind. For a Workroom stage, use a kind the stage brief names — the stage "
            + "advances only on evidence of a kind it declared; a generic kind like note does not advance it.",
        },
        stageKey: {
          type: "string",
          description:
            "The work-shape stage this evidence completes. REQUIRED for a Workroom stage to "
            + "advance: the drive earns a completing receipt from stage-scoped evidence and "
            + "never from a run's self-reported status (BI-76B35820).",
        },
        outcome: {
          type: "string",
          enum: ["completed", "blocked"],
          description:
            "REQUIRED with stageKey. \"completed\" when the stage's work is done — only this advances the stage. "
            + "\"blocked\" when you could not do it (source unreachable, tool missing, authority insufficient); say what blocked you in the summary.",
        },
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
      "Hand off a Workroom within its existing mandate: request records the receiver and next action; acknowledge transfers execution only after that receiver accepts. Omitting phase keeps the existing governed reassignment path.",
    inputSchema: {
      type: "object",
      properties: {
        commandId: COMMAND_ID_PROPERTY,
        capsuleId: { type: "string", description: "Semantic Workroom id (WC-*)." },
        capsuleIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Hand over a set of your rooms instead of one." },
        dryRun: { type: "boolean", description: "With capsuleIds: plan only (default true)." },
        planDigest: { type: "string", description: "The dry run's planDigest; required to apply." },
        phase: { type: "string", enum: ["request", "acknowledge"], description: "Request a same-mandate handoff or acknowledge it as the receiving assistant." },
        requestId: { type: "string", description: "Request activity id to acknowledge; returned by the request phase." },
        targetAgentId: { type: "string", description: "Semantic id of the already-admitted receiving assistant." },
        expectedExecutorKind: { type: "string", enum: ENUMS.executors, description: "Current executor kind read from get_workroom." },
        expectedExecutorRef: { type: "string", description: "Current executor session read from get_workroom." },
        toExecutorKind: { type: "string", enum: ENUMS.executors, description: "Executor taking over the work." },
        toExecutorRef: { type: "string", description: "Optional session/owner id for the receiving executor." },
        reason: { type: "string", description: "Why the handoff is happening." },
        handoffManifest: { type: "object", description: "Optional handoff context: next action, open risks, evidence digest, branch/worktree, suggested receiver." },
        expectedLeaseHolderPrincipalId: { type: ["string", "null"], description: "The lease holder you read from get_workroom. When given, the handoff is refused with lease_holder_changed if someone else now holds the lease." },
      },
      // The handler requires capsuleId, or capsuleIds for a batched handover.
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
    consequenceForCall: call => import("@/lib/work-capsules/bounded-handoff-tool").then(m => m.boundedHandoffConsequenceForCall(call)),
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
        commandId: COMMAND_ID_PROPERTY,
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
// BI-763D6E01: a call carrying `commandId` runs once; see receipted-tool.ts.
type WorkroomHandlers = Awaited<ReturnType<typeof HANDLERS>>;
type WorkroomHandler = (params: Record<string, unknown>, userId: string, context: ToolExecutionContext | undefined) => Promise<ToolResult>;
const receipted = (commandType: string, pick: (m: WorkroomHandlers) => WorkroomHandler) =>
  (params: Record<string, unknown>, userId: string, context: ToolExecutionContext | undefined) => Promise.all([HANDLERS(), import("@/lib/work-capsules/receipted-tool")])
    .then(([m, r]) => r.receiptedWorkroomTool(commandType, pick(m) as never)(params, userId, context as never));

export const workCapsulesPack: ToolPack = {
  packId: "work-capsules",
  definitions,
  handlers: {
    review_workroom_sensitivity: (params, userId) => import("@/lib/work-management/workroom-sensitivity-review.server").then(m => m.reviewWorkroomSensitivityTool(params, userId)),
    correct_workroom_sensitivity: (params, userId, context) => import("@/lib/work-management/workroom-sensitivity-review.server").then(m => m.correctWorkroomSensitivityTool(params, userId, context)),
    list_workrooms: (params, userId, context) => HANDLERS().then((m) => m.listWorkCapsulesTool(params, userId, context)),
    get_workroom: (params, userId, context) => HANDLERS().then((m) => m.getWorkCapsuleTool(params, userId, context)),
    create_workroom: (params, userId, context) => HANDLERS().then((m) => m.createWorkCapsuleTool(params, userId, context)),
    plan_workroom_worktree: (params, userId, context) => HANDLERS().then((m) => m.planCapsuleWorktreeTool(params, userId, context)),
    adopt_worktree: (params, userId, context) => HANDLERS().then((m) => m.adoptWorktreeTool(params, userId, context)),
    claim_backlog_item_for_work: (params, userId, context) => HANDLERS().then((m) => m.claimBacklogItemForWorkTool(params, userId, context)),
    declare_break_fix: (params, userId, context) =>
      import("@/lib/work-capsules/declare-break-fix-tool").then((m) => m.declareBreakFixTool(params, userId, context)),
    claim_workroom_scope: (params, userId, context) => receipted("claim-scope", (m) => m.claimCapsuleScopeTool)(params, userId, context),
    heartbeat_workroom: (params, userId, context) => receipted("heartbeat", (m) => m.heartbeatCapsuleTool)(params, userId, context),
    update_workroom_status: (params, userId, context) => HANDLERS().then((m) => m.updateWorkCapsuleStatusTool(params, userId, context)),
    release_workroom_scope: (params, userId, context) => receipted("release-scope", (m) => m.releaseCapsuleScopeTool)(params, userId, context),
    drive_workroom_runtime: (params, userId, context) =>
      import("@/lib/workroom-runtime/runtime-tools").then((m) => m.driveWorkroomRuntimeTool(params, userId, context)),
    approve_runtime_permission: (params, userId, context) =>
      import("@/lib/workroom-runtime/runtime-tools").then((m) => m.approveRuntimePermissionTool(params, userId, context)),
    resume_workroom_queue: (params, userId, context) =>
      Promise.all([import("@/lib/work-capsules/resume-queue-handler"), import("@/lib/work-capsules/receipted-tool")])
        .then(([m, r]) => r.receiptedWorkroomTool("resume-queue", m.resumeWorkroomQueueTool as never)(params, userId, context as never)),
    rebind_workroom_shape: (params, userId, context) =>
      import("@/lib/work-capsules/workroom-shape-rebind-handler").then((m) => m.rebindWorkroomShapeTool(params, userId, context)),
    record_workroom_evidence: (params, userId, context) => receipted("record-evidence", (m) => m.recordCapsuleEvidenceTool)(params, userId, context),
    reassign_workroom_executor: (params, userId, context) => Promise.all([
      HANDLERS(), import("@/lib/work-capsules/receipted-tool"), import("@/lib/work-capsules/bounded-handoff-tool"),
    ]).then(([m, r, handoff]) => r.receiptedWorkroomTool("reassign-executor", m.reassignCapsuleExecutorTool as never,
      { prepare: handoff.prepareBoundedHandoff })(params, userId, context as never)),
    start_external_work: (params, userId, context) => HANDLERS().then((m) => m.startExternalWorkTool(params, userId, context)),
    record_agent_activity: (params, userId, context) => receipted("record-activity", (m) => m.recordAgentActivityTool)(params, userId, context),
    // Legacy workroom names — callable, deliberately NOT advertised in `definitions`.
    list_work_capsules: (params, userId, context) => HANDLERS().then((m) => m.listWorkCapsulesTool(params, userId, context)),
    get_work_capsule: (params, userId, context) => HANDLERS().then((m) => m.getWorkCapsuleTool(params, userId, context)),
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
    review_workroom_sensitivity: ["admin_read"],
    correct_workroom_sensitivity: ["admin_write"],
    list_workrooms: ["work_capsule_read"],
    get_workroom: ["work_capsule_read"],
    create_workroom: ["work_capsule_write"],
    plan_workroom_worktree: ["work_capsule_write"],
    adopt_worktree: ["work_capsule_adopt"],
    claim_backlog_item_for_work: ["work_capsule_adopt"],
    declare_break_fix: ["work_capsule_write"],
    claim_workroom_scope: ["work_capsule_write"],
    heartbeat_workroom: ["work_capsule_write"],
    update_workroom_status: ["work_capsule_write"],
    release_workroom_scope: ["work_capsule_write"],
    rebind_workroom_shape: ["work_capsule_write"],
    resume_workroom_queue: ["work_capsule_write"],
    drive_workroom_runtime: ["work_capsule_write"],
    approve_runtime_permission: ["work_capsule_write"],
    record_workroom_evidence: ["workroom_evidence_write"],
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
    record_capsule_evidence: ["workroom_evidence_write"],
    reassign_capsule_executor: ["work_capsule_write"],
  },
};

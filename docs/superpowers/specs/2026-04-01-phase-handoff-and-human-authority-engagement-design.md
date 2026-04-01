# EP-BUILD-HANDOFF-002: Phase Handoff Documents & Human Authority Engagement

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-HANDOFF-002 |
| **IT4IT Alignment** | §5.3 Integrate → §5.4 Deploy → §5.5 Release |
| **Depends On** | EP-BUILD-HANDOFF (Phase 1 tool filtering — implemented), EP-CHG-MGMT (RFC lifecycle — implemented) |
| **Status** | Draft |
| **Created** | 2026-04-01 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

## Problem Statement

### Problem 1: No structured handoff between build phases

The Build Studio lifecycle (ideate → plan → build → review → ship) runs through a single agent conversation. When the AI auto-advances through multiple phases in one agentic loop call, the next phase inherits full chat history as context instead of a focused summary. This causes:

- **Token waste** — 15K+ tokens of ideate/plan conversation carried into the build phase where they're irrelevant
- **Context confusion** — the AI references design decisions from 20 messages ago instead of the structured evidence (designDoc, buildPlan, verificationOut)
- **No handoff accountability** — there is no record of what one phase concluded and handed to the next. If something breaks in build, there's no way to trace which plan decision led to it.

### Problem 2: Human authority never engaged for approvals

The platform has a complete approval infrastructure (RFC lifecycle, ChangePromotion, DelegationGrant, ApprovalRule, EmployeeProfile with authority chains) but the Build Studio never engages it. Today:

- `shipBuild()` creates a ChangePromotion with status `approved` — **auto-approved with no human decision**
- The RFC's `approvedById` field is populated but no one is notified
- The agent knows who to escalate to (`escalates_to: "HR-500"` for deploy) but has no mechanism to reach that person
- Emergency promotions bypass all gates without retrospective approval
- The HITL tier on agent configs (`hitl_tier_default: 1` = human approval required) is not enforced

### Problem 3: Humans may not be on the platform

The approval authority (HR-500 for deployments, manager for leave, etc.) may not be logged in when the AI needs a decision. Current notification channels:

- **In-app notification** — only works if the person checks the platform
- **Email** — exists for finance (invoices, bill approvals) but not for change management
- **Slack, Teams, SMS, phone** — not implemented

For emergency changes, waiting for someone to check a web app is not acceptable.

## Design

### Part 1: PhaseHandoff Document

#### Data Structure

```typescript
interface PhaseHandoff {
  id: string;                          // cuid
  buildId: string;                     // FK to FeatureBuild
  fromPhase: BuildPhase;
  toPhase: BuildPhase;
  fromAgentId: string;                 // Agent that completed the phase
  toAgentId: string;                   // Agent that will handle the next phase
  createdAt: Date;

  // Structured summary — NOT free-text chat history
  summary: string;                     // 2-3 sentence plain language summary
  decisionsMade: string[];             // Key decisions from this phase
  openIssues: string[];                // Known issues the next agent should address
  userPreferences: string[];           // User-expressed preferences (e.g., "no database changes")

  // Evidence pointers — what the phase produced
  evidenceFields: string[];            // e.g., ["designDoc", "designReview"]
  evidenceDigest: Record<string, string>; // { designDoc: "Single-page complaints tracker with in-memory state", designReview: "pass — meets requirements" }

  // Quality signals
  gateResult: PhaseGateResult;         // The gate check that allowed advancement
  tokenBudgetUsed: number;             // Tokens consumed during this phase
  toolsUsed: string[];                 // Which tools the agent actually called
  iterationCount: number;              // How many agentic loop iterations this phase took
}
```

#### Where It's Written

The `advanceBuildPhase()` function in `apps/web/lib/actions/build.ts` is the single point where phase transitions happen. Before advancing, it:

1. Reads the current build's evidence fields
2. Generates an `evidenceDigest` — one-line summary per field
3. Collects `toolsUsed` and `iterationCount` from the agentic loop result
4. Creates the PhaseHandoff record
5. Advances the phase

#### Where It's Read

The agentic loop in `apps/web/lib/agentic-loop.ts` reads the most recent PhaseHandoff for the build and injects it into the system prompt as structured context:

```
## Context from Previous Phase

Phase: ideate → plan (handed off by build-specialist)
Summary: Designed a single-page complaints tracker with in-memory state, status badges, and form validation.
Decisions: No database changes, use React useState, Tailwind CSS styling.
Open Issues: None.
User Preferences: "Keep it simple — one file, no API routes"

Evidence:
- designDoc: Single-page complaints tracker with in-memory state
- designReview: pass — meets all 4 requirements
```

This replaces the full chat history from the previous phase — focused, structured, and token-efficient.

#### Migration

```sql
CREATE TABLE "PhaseHandoff" (
  "id" TEXT NOT NULL DEFAULT gen_random_cuid(),
  "buildId" TEXT NOT NULL,
  "fromPhase" TEXT NOT NULL,
  "toPhase" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "toAgentId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "decisionsMade" TEXT[] NOT NULL DEFAULT '{}',
  "openIssues" TEXT[] NOT NULL DEFAULT '{}',
  "userPreferences" TEXT[] NOT NULL DEFAULT '{}',
  "evidenceFields" TEXT[] NOT NULL DEFAULT '{}',
  "evidenceDigest" JSONB NOT NULL DEFAULT '{}',
  "gateResult" JSONB NOT NULL DEFAULT '{}',
  "tokenBudgetUsed" INTEGER NOT NULL DEFAULT 0,
  "toolsUsed" TEXT[] NOT NULL DEFAULT '{}',
  "iterationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhaseHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhaseHandoff_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId"),
  CONSTRAINT "PhaseHandoff_fromAgentId_fkey" FOREIGN KEY ("fromAgentId") REFERENCES "Agent"("agentId"),
  CONSTRAINT "PhaseHandoff_toAgentId_fkey" FOREIGN KEY ("toAgentId") REFERENCES "Agent"("agentId")
);

CREATE INDEX "PhaseHandoff_buildId_idx" ON "PhaseHandoff"("buildId");
```

### Part 2: Human Authority Engagement

#### Authority Resolution

**Design Decision (2026-04-01):** The platform targets small businesses where the highest authority is easily identifiable — typically the business owner or CEO. Approval routes to that person, not through a multi-level chain.

When an AI Coworker needs human approval, the system resolves **who** by finding the highest-authority employee on the platform:

```
1. Find the platform's highest authority:
   - EmployeeProfile with platformRole = "HR-000" (CEO/Owner)
   - If multiple: the one who set up the platform (first admin)
   - If none configured: the currently logged-in user (self-approval)
2. For domain-specific actions, prefer the domain authority if one exists:
   - Deployment → HR-500 if assigned, else fall back to HR-000
   - Finance → by ApprovalRule threshold, else fall back to HR-000
3. Emergency: always HR-000 directly
```

##### Implementation: `resolveApprovalAuthority()`

New function in `apps/web/lib/approval-authority.ts`:

```typescript
interface ApprovalAuthority {
  employeeId: string;              // Who needs to approve
  employeeName: string;
  authorityDomain: string;         // Why they're the authority
  reachability: {
    onPlatform: boolean;           // Logged in within last 30 minutes
    workEmail: string | null;
    personalEmail: string | null;
    phoneNumber: string | null;
  };
  urgencyLevel: "standard" | "urgent" | "emergency";
}

async function resolveApprovalAuthority(
  actionType: string,
  changeType: "standard" | "normal" | "emergency",
  riskLevel: "low" | "medium" | "high" | "critical",
): Promise<ApprovalAuthority>
```

#### Change Impact Analysis

**Design Decision (2026-04-01):** Every promotion requires a change impact analysis before approval. This is standard ITSM practice and must be part of the RFC lifecycle.

The impact analysis is generated automatically when `deploy_feature` extracts the diff:

```
1. Parse the diff to identify:
   - New routes (pages users will see)
   - Modified routes (existing pages that change)
   - Schema changes (database migrations)
   - Deleted files (features being removed)

2. Resolve impacted users:
   - New routes → no existing users impacted (net new functionality)
   - Modified routes → query which user roles access those routes
   - Schema changes → identify which features depend on changed models
   - Deleted files → identify users of removed functionality

3. Generate impact report:
   - Blast radius: number of impacted users/roles
   - Risk assessment: low (new only) / medium (modifications) / high (deletions + schema)
   - Rollback complexity: simple (code only) / complex (schema migration)

4. Notify impacted users:
   - In-app notification: "A change to [feature] is scheduled for deployment"
   - For high-impact changes: AI Coworker relays the impact summary to the authority
```

The impact report is stored on the RFC (`ChangeRequest.impactReport`) and presented to the approving authority alongside the approval request.

#### The AI Chat as Primary Communication Channel

**Design Decision (2026-04-01):** The AI Coworker chat panel is the primary interface between humans and the AI workforce. There is no separate agent panel or avatar switch when a different specialist agent is involved.

When the operations agent needs human approval, the flow is:

```
1. Build-specialist (Software Engineer) completes the build
2. Operations agent determines approval is needed
3. The CURRENT AI Coworker relays the message to the user:

   "The Customer Complaint Tracker is ready to ship. I've prepared the
   deployment with the operations team. Here's what needs approval:

   Impact Analysis:
   - 1 new page: /complaints (customer case management)
   - 0 schema changes, 0 migrations
   - Risk: low (new functionality only, no existing features affected)
   - Rollback: simple (remove one file)

   This needs approval from [CEO Name] before I can deploy.
   [Approve] [Reject] [Schedule for Later]"

4. If the approver IS the current user → they approve right in the chat
5. If the approver is someone ELSE → the AI Coworker explains:

   "I need [CEO Name] to approve this deployment. They're not currently
   on the platform. I'll reach out to them now.
   
   Priority: on-platform notification first, then [configured channel]."
```

No new avatar, no agent switching visible to the user. The AI Coworker is the single voice that coordinates between specialist agents internally.

#### Engagement Channels (Priority Order)

**Design Decision (2026-04-01):** Channel priority follows: on-platform first, real-time messaging second, asynchronous third.

```
Priority 1 (On-Platform) — AI Coworker chat message + in-app notification with deepLink
  ↓ Authority not on platform (no session in last 30 min)
Priority 2 (Real-Time) — Slack/Teams message or SMS
  ↓ No real-time channel configured or no response in 15 min
Priority 3 (Async) — Email to work address
  ↓ Emergency only: email to personal address
```

For emergency changes, all configured channels fire simultaneously.

##### Channel Configuration

New model `NotificationChannel` to configure per-employee outbound channels:

```
NotificationChannel {
  id: cuid
  employeeId: FK to EmployeeProfile
  channelType: "slack" | "teams" | "sms" | "email" | "webhook"
  address: String              // Slack user ID, phone number, email, webhook URL
  priority: Int                // 1 = primary, 2 = fallback
  enabledForUrgency: String[]  // ["standard", "urgent", "emergency"]
  verified: Boolean            // Has the channel been confirmed working?
  verifiedAt: DateTime
  isActive: Boolean
}
```

##### Channel Adapters

Each channel type has an adapter in `apps/web/lib/notification-channels/`:

| Priority | Channel | Adapter | Dependencies |
| -------- | ------- | ------- | ------------ |
| 1 | **On-platform** | Built-in (Notification model + AI Coworker relay) | None |
| 2 | **Slack** | `slack-adapter.ts` | Incoming webhook URL |
| 2 | **Teams** | `teams-adapter.ts` | Incoming webhook URL |
| 2 | **SMS** | `sms-adapter.ts` | Twilio or webhook |
| 3 | **Email** | `email-adapter.ts` | nodemailer (existing) |
| 3 | **Webhook** | `webhook-adapter.ts` | Generic HTTP POST |

Each adapter implements:

```typescript
interface NotificationChannelAdapter {
  send(params: {
    recipientAddress: string;
    subject: string;
    body: string;
    urgency: "standard" | "urgent" | "emergency";
    deepLink: string;          // URL to approve/reject in the platform
    impactSummary: string;     // One-line blast radius summary
  }): Promise<{ sent: boolean; messageId?: string; error?: string }>;
}
```

#### Approval Request Flow

When an AI Coworker proposes an action requiring human approval:

```
1. AI calls tool (e.g., execute_promotion)
2. Tool handler checks: does this require human approval?
   - Check DelegationGrant: does the agent have a valid, unexpired grant?
   - If grant exists and valid → proceed (delegated authority)
   - If no grant → create ApprovalRequest

3. Run change impact analysis:
   a. Parse diff for new/modified/deleted routes and schema changes
   b. Resolve impacted users by role
   c. Generate impact report (blast radius, risk, rollback complexity)
   d. Store on RFC (ChangeRequest.impactReport)

4. Resolve approval authority:
   a. resolveApprovalAuthority() → finds highest authority (typically CEO/Owner)
   b. Check: is the authority the CURRENT user?
      - YES → present approval card in the AI chat with impact analysis
      - NO → continue to notification

5. Notify authority (priority order):
   a. In-app notification + AI Coworker relay message
   b. Check reachability (session active in last 30 min?)
      - On platform → done (they'll see it in their AI chat)
      - Off platform → send via real-time channel (Slack/Teams/SMS)
      - No real-time configured → send email
   c. For emergencies → all channels simultaneously

6. Notify impacted users:
   a. All users whose routes/features are affected get an in-app notification
   b. "A change to [feature] is scheduled — you may see brief downtime"

7. AI Coworker tells the requesting user:
   "[CEO Name] needs to approve this. They're [on the platform / being
   notified via Slack]. Here's the impact analysis while we wait: ..."

8. Approval arrives:
   - Authority approves in AI chat or via deepLink
   - ApprovalRequest status updated
   - AI Coworker continues the ship sequence

9. Escalation (if no response in configured timeframe):
   - AI Coworker informs user: "Still waiting for approval. Want me to
     try another channel or mark this as urgent?"
```

#### Emergency Path

For emergency changes (production outage, security incident):

1. AI detects urgency from user context ("production is down", "security breach")
2. `changeType` set to `emergency`
3. Authority resolution: HR-000 (CEO/Owner) directly
4. ALL configured notification channels fire simultaneously
5. AI Coworker in chat: "Emergency deployment initiated. [CEO Name] notified on all channels. Executing now — retrospective approval required within 24 hours."
6. RFC enters at `in-progress` — execution begins immediately
7. Retrospective approval required within 24 hours
8. If not retrospectively approved → auto-created incident report for governance review

### Part 3: Build Studio Integration

#### Phase Transition with Handoff + Authority Check

When `advanceBuildPhase()` is called for review → ship:

```
1. Write PhaseHandoff document (structured summary of review phase)
2. Run change impact analysis on the extracted diff
3. Check: does this transition require human approval?
   - ALL promotions require approval (the platform authority must sign off)
   - Standard change catalog match → present for acknowledgment, not full review
4. The AI Coworker presents the impact analysis and approval request:
   - If approver is the current user → approval card in chat
   - If approver is someone else → notify via configured channels
5. Phase stays at review until approved
6. On approval:
   a. Phase advances to ship
   b. Impacted users notified
   c. Ship tools become available
   d. AI Coworker continues with deployment sequence
```

#### PR-Based Contribution (Not Direct-to-Main)

**Design Decision (2026-04-01):** No code goes directly to main. Every contribution — whether from a human developer or the Build Studio AI — must go through a pull request. This is non-negotiable for security, code quality, and architectural review.

The current `promote.sh` pipeline extracts code from the sandbox and builds a new image directly. This must change to a PR-based flow:

```
Ship Phase (PR-Based):

1. deploy_feature → extract diff from sandbox
2. Create a feature branch:
   - Branch name: build/{buildId}/{slugified-title}
   - Commit the diff with structured commit message:
     "feat({area}): {title}\n\nBuild: {buildId}\nProduct: {productId}\nAgent: {agentId}"
3. Push branch to the git remote (origin)
4. Create a Pull Request via git hosting API (GitHub, GitLab, etc.):
   - Title: "feat: {feature title} (Build {buildId})"
   - Body: impact analysis, acceptance criteria, evidence chain
   - Labels: auto-generated (e.g., "ai-contributed", risk level)
   - Reviewers: resolved authority from approval chain
5. Security scan runs as PR check:
   - Static analysis for injection vulnerabilities (SQL, XSS, command injection)
   - Dependency audit (no new unvetted packages)
   - Secret detection (no API keys, passwords in diff)
   - Schema migration review (destructive ops flagged)
6. Human authority reviews the PR:
   - Code quality, architectural fit, security findings
   - Can request changes → AI Coworker addresses them in sandbox, pushes update
   - Approves → PR merged to main
7. On merge:
   - execute_promotion builds from the merged main branch
   - Production image built from reviewed, merged code
   - No unreviewed code reaches production
```

##### Why This Matters

- **Security**: AI-generated code may have injection vulnerabilities, insecure patterns, or accidental secret exposure. PR review catches these.
- **Architecture**: AI may create patterns that conflict with existing conventions. A human reviewer ensures consistency.
- **Accountability**: Every line of production code has a human reviewer on record.
- **Audit trail**: The PR is the change record — who wrote it, who reviewed it, what was discussed.

##### Consumer Mode vs Development Mode

- **Development mode** (H:\repo): PRs go to the project's GitHub/GitLab remote. Standard open-source contribution flow.
- **Consumer mode** (D:\DPF): PRs go to a local git repo or a configured remote. If no remote is configured, the PR is "local-only" — the diff is presented to the authority in the AI Coworker chat for review, and the promotion applies the approved diff directly.

#### UX Surface for New Functionality

When a build creates new pages or UI components, the ship phase must surface this in the platform UX. The `deploy_feature` tool already extracts the diff — it should also:

1. Parse new route files from the diff (e.g., `app/(shell)/complaints/page.tsx`)
2. Register them as navigation candidates in the platform menu system
3. The AI Coworker proposes menu placement to the user: "This feature adds a /complaints page. Where should it appear in navigation? Under Customer? As a top-level item?"
4. User approves placement → menu updated as part of the promotion

This ensures no feature ships without being discoverable in the UX.

## Implementation Plan

### Phase 2a: PhaseHandoff Document (Low Risk) — IMPLEMENTED

| Step | Task | Status |
|------|------|--------|
| 1 | Add PhaseHandoff model to Prisma schema | Done |
| 2 | Create migration | Done |
| 3 | Write PhaseHandoff on phase advance | Done |
| 4 | Read PhaseHandoff in agentic loop, inject into system prompt | Done |
| 5 | Add PhaseHandoff to Build Studio evidence panel | Done |

### Phase 2b: Change Impact Analysis + Authority Resolution (Medium Risk) — IMPLEMENTED

| Step | Task | Files | Status |
|------|------|-------|--------|
| 1 | Create `analyzeChangeImpact()` — parse diff, resolve impacted users | `apps/web/lib/change-impact.ts` (new) | Done |
| 2 | Create `resolveApprovalAuthority()` — find highest platform authority | `apps/web/lib/approval-authority.ts` (new) | Done |
| 3 | Wire impact analysis into `deploy_feature` tool handler | `apps/web/lib/mcp-tools.ts` | Done |
| 4 | Present approval card in AI Coworker chat with impact summary | `apps/web/lib/actions/agent-coworker.ts` | Done |
| 5 | Store impact report on RFC | `apps/web/lib/actions/build.ts` (shipBuild) | Done |

### Phase 2c: Notification Channels (Medium Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Add NotificationChannel model to schema + migration | `packages/db/prisma/schema.prisma` |
| 2 | Implement on-platform relay (AI Coworker message to authority's chat) | `apps/web/lib/notification-channels/platform-relay.ts` (new) |
| 3 | Implement Slack/Teams webhook adapter | `apps/web/lib/notification-channels/realtime-adapter.ts` (new) |
| 4 | Implement email adapter (extend existing nodemailer) | `apps/web/lib/notification-channels/email-adapter.ts` (new) |
| 5 | Implement channel dispatcher with priority logic | `apps/web/lib/notification-channels/dispatcher.ts` (new) |
| 6 | Add impacted-user notification on promotion approval | `apps/web/lib/actions/promotions.ts` |

### Phase 2d: UX Surface Discovery (Low Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Parse new routes from diff in `deploy_feature` | `apps/web/lib/mcp-tools.ts` |
| 2 | Propose navigation placement as part of ship phase | `apps/web/lib/mcp-tools.ts` |
| 3 | Register approved placement in menu configuration | `apps/web/lib/navigation-registry.ts` (new or existing) |

### Phase 2e: PR-Based Contribution Pipeline (High Risk) — IMPLEMENTED

| Step | Task | Files | Status |
|------|------|-------|--------|
| 1 | Create `submitBuildAsPR()` — branch, commit, push, open PR | `apps/web/lib/contribution-pipeline.ts` (new) | Done |
| 2 | Generate structured PR body (impact analysis, evidence, acceptance criteria) | Same file | Done |
| 3 | Add security scan as PR check (injection, secrets, deps) | `apps/web/lib/security-scan.ts` (new) | Done |
| 4 | Wire `deploy_feature` to create PR instead of direct promotion | `apps/web/lib/mcp-tools.ts` | Done |
| 5 | Handle PR review feedback loop (AI Coworker relays review comments, pushes fixes) | `apps/web/lib/actions/agent-coworker.ts` | Deferred |
| 6 | On merge: trigger `execute_promotion` from merged main branch | `apps/web/lib/actions/promotions.ts` | Deferred |
| 7 | Consumer mode fallback: local-only PR review in AI chat | `apps/web/lib/contribution-pipeline.ts` | Done |
| 8 | Add git remote operations (branch, push, apply patch) | `apps/web/lib/git-utils.ts` | Done |

## Success Criteria

1. Phase transitions produce a PhaseHandoff document visible in the Build Studio evidence panel
2. Next-phase agents receive structured context instead of full chat history
3. Every promotion includes a change impact analysis (blast radius, impacted users, risk level)
4. Impacted users are notified before deployment
5. The AI Coworker presents approval requests with impact summaries — no separate approval UI needed
6. Off-platform authorities are reached via real-time channels first, async second
7. Emergency changes trigger simultaneous all-channel notification with retrospective approval
8. No feature ships without a proposed UX navigation placement
9. Full audit trail in AuthorizationDecisionLog for every approval decision
10. **No code reaches production without a reviewed PR** — AI contributions go through the same review process as human contributions
11. Security scan results are attached to every PR (injection, secrets, dependency audit)

## Resolved Design Decisions

1. **Approval authority** — Routes to the highest authority on the platform (CEO/Owner for small businesses). Domain-specific authorities (HR-500 for deploy) are preferred when assigned, but fall back to HR-000. No multi-level chain for small business context.
2. **Agent-to-agent handoff UX** — No avatar switch. The current AI Coworker relays messages from specialist agents. The chat panel is the single interface between the human world and the AI workforce.
3. **Channel priority** — On-platform first (AI chat + notification), real-time messaging second (Slack/Teams/SMS), asynchronous third (email). Emergency = all simultaneously.
4. **Change impact analysis** — Required for every promotion. Standard ITSM practice. Impacted users notified.
5. **PR-based contribution** — Every code change goes through a PR, never direct to main. Applies to AI-generated code and human contributions equally. Security scan mandatory. Consumer mode uses local-only review when no git remote is configured.

## Open Questions

1. **Channel verification** — RESOLVED: Added to backlog as EP-NOTIFY-CHANNELS / BI-NOTIFY-002. Verify channels on setup and periodically. Mobile client (EP-MOBILE-CLIENT) will add push notification as an additional real-time channel.
2. **Retrospective approval timeout** — RESOLVED: If emergency approval lapses after 24 hours, escalate to second-in-command (next in management chain via `managerEmployeeId` or `escalatesTo`). If second also lapses, auto-create incident report and notify HR-000. No auto-rollback — the change is live and may be critical.
3. **Token budget tracking** — RESOLVED: Token spend is centrally tracked and attributed to the activity that consumed them (build phase, agent, tool call). This is a budgetary and operational concern — exhausting the token budget for a class of task means that class of AI Coworker work stops until the budget resets or is increased. Budget enforcement is per-agent-class, not per-phase.

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

When an AI Coworker proposes an action that requires human approval, the system must resolve **who** needs to approve it. The resolution follows this chain:

```
1. Tool → required grant → authority domain
2. Authority domain → responsible role (BusinessModelRole with matching authorityDomain)
3. Responsible role → assigned employee (EmployeeProfile with matching position/department)
4. If no employee assigned → escalate to role.escalatesTo
5. If escalation target also unassigned → escalate to HR-000 (CEO)
```

##### Authority Domain Mapping

| Action Category | Authority Domain | Default HR Role | Agent Escalation |
|----------------|-----------------|-----------------|------------------|
| Code promotion (deploy_feature, execute_promotion) | `deployment` | HR-500 | AGT-ORCH-400 → HR-500 |
| Release management (create_release_bundle, schedule_promotion) | `release` | HR-100 | AGT-ORCH-500 → HR-100 |
| Backlog changes (create_backlog_item, update_backlog_item) | `operations` | HR-200 | AGT-ORCH-300 → HR-200 |
| Policy changes (propose_leave_policy) | `policy` | HR-000 | AGT-ORCH-000 → HR-000 |
| Financial approvals (bill approval, expense claims) | `finance` | By ApprovalRule threshold | Manager chain |
| Emergency changes | `deployment` + `emergency` | HR-500, CC HR-000 | Immediate escalation |

##### Implementation: `resolveApprovalAuthority()`

New function in `apps/web/lib/approval-authority.ts`:

```typescript
interface ApprovalAuthority {
  employeeId: string;              // Who needs to approve
  employeeName: string;
  authorityDomain: string;         // Why they're the authority
  reachability: {
    onPlatform: boolean;           // Logged in within last 30 minutes
    workEmail: string | null;      // For email notification
    personalEmail: string | null;  // For urgent/emergency fallback
    phoneNumber: string | null;    // For emergency escalation
  };
  escalationChain: string[];       // Ordered list of fallback employee IDs
  urgencyLevel: "standard" | "urgent" | "emergency";
}

async function resolveApprovalAuthority(
  actionType: string,
  changeType: "standard" | "normal" | "emergency",
  riskLevel: "low" | "medium" | "high" | "critical",
): Promise<ApprovalAuthority>
```

#### Engagement Channels (Escalating Urgency)

When the AI needs human approval, it doesn't just create a database record — it actively reaches out through escalating channels:

```
Tier 1 (Standard) — In-app notification + deepLink
  ↓ No response in 15 minutes
Tier 2 (Urgent) — Email to work address
  ↓ No response in 30 minutes
Tier 3 (Emergency) — Email to personal address + SMS/webhook
  ↓ No response in 15 minutes
Tier 4 (Critical) — Phone call trigger + escalate to next authority
```

##### Channel Configuration

New model `NotificationChannel` to configure per-employee outbound channels:

```
NotificationChannel {
  id: cuid
  employeeId: FK to EmployeeProfile
  channelType: "email" | "sms" | "slack" | "teams" | "webhook" | "phone"
  address: String              // email address, phone number, webhook URL, Slack user ID
  priority: Int                // 1 = primary, 2 = fallback
  enabledForUrgency: String[]  // ["standard", "urgent", "emergency"]
  verified: Boolean            // Has the channel been confirmed working?
  verifiedAt: DateTime
  isActive: Boolean
}
```

##### Channel Adapters

Each channel type has an adapter in `apps/web/lib/notification-channels/`:

| Channel | Adapter | Dependencies | Config |
|---------|---------|-------------|--------|
| **Email** | `email-adapter.ts` | nodemailer (existing) | SMTP settings in .env |
| **SMS** | `sms-adapter.ts` | Twilio SDK or generic HTTP webhook | `TWILIO_SID`, `TWILIO_TOKEN` in .env |
| **Slack** | `slack-adapter.ts` | Slack Web API or incoming webhook | `SLACK_WEBHOOK_URL` in .env |
| **Teams** | `teams-adapter.ts` | Microsoft Teams incoming webhook | `TEAMS_WEBHOOK_URL` in .env |
| **Webhook** | `webhook-adapter.ts` | Generic HTTP POST | Per-employee webhook URL |
| **Phone** | `phone-adapter.ts` | Twilio Voice or PagerDuty | `TWILIO_SID` or `PAGERDUTY_KEY` |

Each adapter implements:

```typescript
interface NotificationChannelAdapter {
  send(params: {
    recipientAddress: string;
    subject: string;
    body: string;
    urgency: "standard" | "urgent" | "emergency";
    deepLink: string;          // URL to approve/reject in the platform
    replyOptions?: string[];   // For channels that support quick replies (Slack buttons, etc.)
  }): Promise<{ sent: boolean; messageId?: string; error?: string }>;
}
```

#### Approval Request Flow

When an AI Coworker proposes an action requiring human approval:

```
1. AI calls tool (e.g., execute_promotion)
2. Tool handler checks: does this require human approval?
   - Check DelegationGrant: does the agent have a valid, unexpired grant for this action?
   - Check HITL tier: is the agent's tier ≥ the action's required tier?
   - If grant exists and valid → proceed (delegated authority)
   - If no grant → create ApprovalRequest

3. Create ApprovalRequest:
   a. resolveApprovalAuthority() → finds the right human
   b. Create Notification (in-app) with deepLink to approval page
   c. Check reachability:
      - If onPlatform → done (notification visible)
      - If not onPlatform → send via configured channels (email, Slack, etc.)
   d. Start escalation timer

4. AI responds to user: "I've requested approval from [Name] ([Role]).
   They've been notified via [channel]. Expected response time: [based on urgency]."

5. Approval arrives:
   - Human clicks deepLink → reviews action → approves/rejects
   - Or: human replies via channel (Slack button, email reply) → webhook processes response
   - ApprovalRequest status updated
   - AI is notified → continues or aborts based on decision

6. Escalation (if no response):
   - Timer fires → escalate to next authority in chain
   - Repeat notification via higher-urgency channels
   - After full chain exhausted → notify AI of timeout, suggest retry or manual intervention
```

#### Emergency Path

For emergency changes (production outage, security incident):

1. AI detects urgency from user context ("production is down", "security breach")
2. `changeType` set to `emergency`
3. Authority resolution uses emergency escalation:
   - Primary: HR-500 (Deploy/Ops Lead)
   - CC: HR-000 (CEO)
   - Channels: ALL configured channels simultaneously (not tiered)
4. RFC enters at `in-progress` — execution begins immediately
5. Retrospective approval required within 24 hours
6. If not retrospectively approved → auto-created incident report for governance review

### Part 3: Build Studio Integration

#### Phase Transition with Handoff + Authority Check

When `advanceBuildPhase()` is called for review → ship:

```
1. Write PhaseHandoff document (from review agent to ship agent)
2. Check: does this transition require human approval?
   - review → ship with risk > low → YES
   - review → ship with standard change catalog match → NO (pre-approved)
3. If approval required:
   a. resolveApprovalAuthority("deployment", changeType, riskLevel)
   b. Create ApprovalRequest
   c. Notify authority via configured channels
   d. Phase stays at review until approved
   e. AI tells user: "Waiting for [Name] to approve the deployment"
4. If approved (or pre-approved):
   a. Phase advances to ship
   b. Ship agent receives PhaseHandoff context
   c. Ship agent has focused tool set (deploy, register, promote)
```

#### UX Surface for New Functionality

When a build creates new pages or UI components, the ship phase must surface this in the platform UX. The `deploy_feature` tool already extracts the diff — it should also:

1. Parse new route files from the diff (e.g., `app/(shell)/complaints/page.tsx`)
2. Register them as navigation candidates in the platform menu system
3. The ship agent proposes menu placement to the user: "This feature adds a /complaints page. Where should it appear in navigation? Under Customer? As a top-level item?"
4. User approves placement → menu updated as part of the promotion

This ensures no feature ships without being discoverable in the UX.

## Implementation Plan

### Phase 2a: PhaseHandoff Document (Low Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Add PhaseHandoff model to Prisma schema | `packages/db/prisma/schema.prisma` |
| 2 | Create migration | `packages/db/prisma/migrations/` |
| 3 | Write PhaseHandoff on phase advance | `apps/web/lib/actions/build.ts` |
| 4 | Read PhaseHandoff in agentic loop, inject into system prompt | `apps/web/lib/agentic-loop.ts` |
| 5 | Add PhaseHandoff to Build Studio evidence panel | `apps/web/components/build/EvidenceSummary.tsx` |

### Phase 2b: Human Authority Resolution (Medium Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Create `resolveApprovalAuthority()` | `apps/web/lib/approval-authority.ts` (new) |
| 2 | Add NotificationChannel model to schema | `packages/db/prisma/schema.prisma` |
| 3 | Create migration | `packages/db/prisma/migrations/` |
| 4 | Implement channel adapters (email first, then webhook) | `apps/web/lib/notification-channels/` (new) |
| 5 | Wire approval check into `advanceBuildPhase()` for review→ship | `apps/web/lib/actions/build.ts` |
| 6 | Create approval request UI (approve/reject via deepLink) | `apps/web/app/(shell)/ops/approvals/` (new) |

### Phase 2c: Engagement Escalation (Medium Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Implement escalation timer (cron or setTimeout in server action) | `apps/web/lib/approval-escalation.ts` (new) |
| 2 | Wire escalation into notification flow | `apps/web/lib/notification-channels/dispatcher.ts` (new) |
| 3 | Add emergency path (simultaneous all-channel notification) | Same dispatcher |
| 4 | Retrospective approval enforcement | `apps/web/lib/actions/change-management.ts` |

### Phase 2d: UX Surface Discovery (Low Risk)

| Step | Task | Files |
|------|------|-------|
| 1 | Parse new routes from diff in `deploy_feature` | `apps/web/lib/mcp-tools.ts` |
| 2 | Propose navigation placement as part of ship phase | `apps/web/lib/mcp-tools.ts` |
| 3 | Register approved placement in menu configuration | `apps/web/lib/navigation-registry.ts` (new or existing) |

## Success Criteria

1. Phase transitions produce a PhaseHandoff document visible in the Build Studio evidence panel
2. Next-phase agents receive structured context instead of full chat history
3. Promotion requests notify the designated authority via at least one out-of-band channel
4. Emergency promotions trigger simultaneous all-channel notification
5. Approvals can be completed via deepLink without logging into the full platform
6. No feature ships without a proposed UX navigation placement
7. Full audit trail in AuthorizationDecisionLog for every approval decision

## Open Questions

1. **Multi-approver CAB** — should critical/high-risk changes require quorum approval (2 of 3 authorities)? The ChangeApproval junction model was planned but not built.
2. **Channel verification** — how do we verify a Slack webhook or phone number is correct before relying on it for emergencies?
3. **Offline approval** — can a human approve via email reply (e.g., reply "APPROVE" to an email)? This requires inbound email parsing or a reply-to webhook.
4. **Agent-to-agent handoff UX** — should the chat panel visually indicate when a different agent takes over? (New avatar, name, introduction message?)
5. **Token budget tracking** — should each phase have a token budget limit that triggers escalation if exceeded?

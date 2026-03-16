# EP-FEEDBACK-001: Platform Improvement Feedback Loop — Design Spec

**Date:** 2026-03-16
**Goal:** Every AI agent can propose platform improvements during conversations. Proposals carry human attribution, go through governance stages, and feed the self-evolving platform cycle. This is the mechanism by which the platform improves itself through human-AI collaboration.

---

## 1. The Problem

Currently, when a user or agent identifies a friction point, missing feature, or UX issue, the only option is to manually create a backlog item. There's no structured way to:
- Capture WHO identified the issue (the human) and WHAT context they were in
- Track the improvement through a governance pipeline
- Associate the original requester with the outcome
- Automatically propose implemented improvements for community sharing

## 2. ImprovementProposal Schema

New Prisma model:

```prisma
model ImprovementProposal {
  id              String   @id @default(cuid())
  proposalId      String   @unique  // "IMP-XXXXX"
  title           String
  description     String   @db.Text
  category        String   // ux_friction | missing_feature | performance | accessibility | security | process
  severity        String   @default("medium") // low | medium | high | critical

  // Attribution — who was involved
  submittedById   String   // the human user who was in the conversation
  submittedBy     User     @relation(fields: [submittedById], references: [id])
  agentId         String   // which agent proposed it
  routeContext    String   // which page they were on
  threadId        String?  // link to the conversation where it was identified

  // Evidence — what was happening
  conversationExcerpt String? @db.Text  // relevant messages leading to the proposal
  observedFriction    String? @db.Text  // what the agent observed

  // Governance pipeline
  status          String   @default("proposed") // proposed | reviewed | prioritized | in_progress | implemented | verified | rejected
  reviewedById    String?
  reviewedBy      User?    @relation("ProposalReviews", fields: [reviewedById], references: [id])
  reviewedAt      DateTime?
  prioritizedAt   DateTime?
  backlogItemId   String?  // links to BacklogItem once prioritized
  buildId         String?  // links to FeatureBuild once implemented
  verifiedAt      DateTime?
  rejectionReason String?

  // Hive Mind
  contributionStatus String @default("local") // local | proposed_for_sharing | contributed

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status])
  @@index([submittedById])
  @@index([routeContext])
}
```

## 3. Agent Tool: propose_improvement

New MCP tool available to ALL agents:

```typescript
{
  name: "propose_improvement",
  description: "Propose a platform improvement based on what was observed in this conversation. Auto-attributes to the current user.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title for the improvement" },
      description: { type: "string", description: "Detailed description of what should be improved and why" },
      category: { type: "string", enum: ["ux_friction", "missing_feature", "performance", "accessibility", "security", "process"] },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      observedFriction: { type: "string", description: "What you observed that prompted this suggestion" },
    },
    required: ["title", "description", "category"],
  },
  requiredCapability: null, // anyone can propose improvements
  executionMode: "proposal", // requires human approval
}
```

On approval:
- Creates the ImprovementProposal record
- Auto-fills submittedById, agentId, routeContext, threadId from conversation context
- Captures the last 5 messages as conversationExcerpt
- Writes to AuthorizationDecisionLog

## 4. Agent Directive

All agent system prompts gain a common directive (added to PLATFORM_PREAMBLE):

```
IMPROVEMENT MINDSET:
When you observe friction, confusion, or a missing capability during a conversation,
proactively suggest a platform improvement using the propose_improvement tool.
Don't just solve the immediate problem — also think about how the platform could
be better so this problem doesn't recur. The user who approves your proposal is
automatically credited as the submitter.
```

This makes every conversation a potential improvement opportunity. The agent doesn't need to be asked — it notices friction and proposes fixes.

## 5. Governance Pipeline

```
proposed → reviewed → prioritized → in_progress → implemented → verified
                                                                    ↓
                                                          proposed_for_sharing → contributed
    ↘ rejected
```

| Stage | Who | What happens |
|-------|-----|-------------|
| **proposed** | Agent + User | Proposal created from conversation with auto-attribution |
| **reviewed** | Manager (HR-200+) | Reviews the proposal, adds context, confirms category/severity |
| **prioritized** | Manager | Creates a BacklogItem linked to the proposal, assigns to an epic |
| **in_progress** | Developer/Agent | Work begins (manual or via Build Studio) |
| **implemented** | Developer/Agent | Code/feature is complete |
| **verified** | Original submitter | Submitter confirms the improvement addresses their friction |
| **rejected** | Manager | Proposal declined with reason |

After verification, if the change involved code:
- **proposed_for_sharing** — platform suggests contributing to open source
- **contributed** — human approved, PR created or Feature Pack uploaded

## 6. Improvement Proposals Page

New route: `/ops/improvements` (or tab on the ops page)

Shows all proposals with:
- Filter by status, category, submitter
- Proposal cards with attribution, evidence excerpt, and governance stage
- Action buttons for stage transitions (review, prioritize, reject)
- Link to associated backlog item and build

## 7. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/improvement-data.ts` | Query functions for proposals |
| `apps/web/app/(shell)/ops/improvements/page.tsx` | Proposals review page |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | ImprovementProposal model |
| `apps/web/lib/mcp-tools.ts` | propose_improvement tool + handler |
| `apps/web/lib/agent-routing.ts` | Add improvement mindset to PLATFORM_PREAMBLE |

## 8. Connection to Hive Mind (EP-HIVEMIND-001)

When a proposal reaches "implemented" + "verified":
1. Platform checks if there's an associated FeatureBuild with a diff
2. If yes, offers to package as a Feature Pack
3. User approves → contribution pipeline kicks in
4. This is the bridge between EP-FEEDBACK-001 and EP-HIVEMIND-001

## 9. Not in Scope (v1)

- Automatic detection of duplicate proposals
- Voting/upvoting on proposals
- SLA tracking on review/prioritization times
- Integration with external issue trackers (GitHub Issues, Linear)

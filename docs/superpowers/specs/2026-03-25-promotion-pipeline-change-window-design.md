# Sandbox-to-Production Promotion Pipeline & Change Window Enforcement

**Status:** Draft (2026-03-25)
**Predecessor:** EP-SELF-DEV-003 (Sandbox Execution & DB Isolation), EP-CHG-MGMT (Change & Deployment Management), EP-CODEGEN-001 (Robust Sandbox Coding)

## Problem Statement

The Build Studio's ship phase creates a `ChangePromotion` record and wraps it in an RFC, but there are five critical gaps between "ready to ship" and "running in production":

### Gap 1: Disconnected Pipeline

The promotion flow is split across unconnected pieces:

| Step | Where it lives | What it does | What's missing |
|------|---------------|-------------|----------------|
| Ship phase | `build-agent-prompts.ts` | AI calls `register_digital_product_from_build` | No diff extraction, no backup |
| `deploy_feature` tool | `mcp-tools.ts` | Extracts git diff, stores on build record | Not called during ship phase |
| `shipBuild()` | `actions/build.ts` | Creates ProductVersion + ChangePromotion + RFC | Doesn't call `backupProductionDb()` or `applyPromotionPatch()` |
| `approvePromotion()` | `actions/promotions.ts` | Sets status to "approved" | Doesn't trigger deployment |
| `markDeployed()` | `actions/promotions.ts` | Sets status to "deployed" | UI-only state change, no actual deployment |
| `applyPromotionPatch()` | `sandbox-promotion.ts` | Applies git diff + runs migrations | Never called by any automated flow |
| `backupProductionDb()` | `sandbox-promotion.ts` | Creates pg_dump backup | Only called if someone manually orchestrates it |

**Result:** The actual code-to-production step (`applyPromotionPatch`) is an orphaned function. No UI, no tool, no automation calls it. Operators must manually run git apply + prisma migrate deploy.

### Gap 2: No Change Window Enforcement

The platform has a full deployment window system (`DeploymentWindow`, `BlackoutPeriod`, `BusinessProfile` with operating hours) and functions to check availability (`getAvailableWindows()`, `checkSchedulingConflicts()`). But:

- The ship phase does **not** check whether the current time falls within a deployment window
- `approvePromotion()` does **not** validate against deployment windows
- `markDeployed()` does **not** check for blackout periods
- The RFC created by `shipBuild()` is never scheduled against a window — it stays in `draft` status

### Gap 3: No Automated Deployment After Approval

When an operator approves a promotion in the `/ops` UI, nothing happens. The status changes to "approved" but there is no trigger to:
1. Back up the production database
2. Extract and apply the diff
3. Run migrations
4. Verify the deployment
5. Mark as deployed or roll back on failure

### Gap 4: Destructive Operations Only Warned, Not Blocked

`scanForDestructiveOps()` detects 6 destructive SQL patterns (DROP TABLE, DROP COLUMN, etc.) but only returns warnings. The caller (`extractAndCategorizeDiff`) doesn't block promotion based on these warnings. Destructive migrations can be promoted without review.

### Gap 5: No Post-Deployment Verification

After `applyPromotionPatch()` runs (if it were called), there is no:
- Health check on the production application
- Smoke test to verify the deployment worked
- Automatic rollback if the app is unhealthy
- Notification to the user of success/failure

### What Already Exists

**Promotion infrastructure (implemented but disconnected):**
- `sandbox-promotion.ts` — `backupProductionDb()`, `extractAndCategorizeDiff()`, `applyPromotionPatch()`, `scanForDestructiveOps()`, `getRestoreInstructions()`
- `actions/promotions.ts` — `approvePromotion()`, `rejectPromotion()`, `markDeployed()`, `getPromotions()`
- `version-tracking.ts` — `createProductVersionWithRFC()` (creates ProductVersion + ChangePromotion + RFC in single transaction)
- `rollback-strategies.ts` — `executeRollback()`, `rollbackRFC()`
- `actions/build.ts` — `shipBuild()` (creates product, version, promotion, RFC)

**Change management (implemented):**
- `actions/change-management.ts` — Full RFC lifecycle (draft → submitted → assessed → approved → scheduled → in-progress → completed)
- `actions/deployment-windows.ts` — `getAvailableWindows()`, `checkSchedulingConflicts()`, `createBlackoutPeriod()`
- `actions/operating-hours.ts` — Business hours setup with auto-derived deployment windows
- `change-executor.ts` — Ordered execution with health gates
- `PromotionsClient.tsx` — UI for viewing/approving promotions

**Data models (schema exists):**
- `ChangePromotion` — status: pending/approved/rejected/deployed/rolled_back
- `ChangeRequest` — RFC with full lifecycle timestamps
- `ChangeItem` — Links RFC to promotion
- `DeploymentWindow` — Recurring time slots with allowed change types and risk levels
- `BlackoutPeriod` — No-change windows with exceptions
- `BusinessProfile` — Operating hours and low-traffic windows
- `PromotionBackup` — Pre-deployment database backup record

---

## Design

### Section 1: Unified Promotion Pipeline

Connect the disconnected pieces into a single end-to-end pipeline that runs when a promotion is approved.

**New function: `executePromotion(promotionId: string)`**

Location: `apps/web/lib/sandbox-promotion.ts`

```
executePromotion(promotionId)
  |
  1. Validate promotion status is "approved"
  |
  2. Check deployment window — is now within an allowed window?
  |   - Call getAvailableWindows() with RFC type and risk level
  |   - If no window available → return error with next available window time
  |   - If blackout active → return error with blackout end time
  |
  3. Check scheduling conflicts — any other promotions in-progress?
  |   - Call checkSchedulingConflicts()
  |   - If conflict → return error with conflicting RFC details
  |
  4. Back up production database
  |   - Call backupProductionDb(buildId)
  |   - Link backup to ChangePromotion
  |   - If backup fails → abort, return error
  |
  5. Extract diff from sandbox
  |   - Call extractAndCategorizeDiff(containerId)
  |   - If sandbox not running → abort, return error
  |   - Scan migrations for destructive operations
  |   - If destructive ops found → abort, return error with warnings
  |     (promotion must be flagged "destructive_acknowledged" to proceed)
  |
  6. Update RFC status to "in-progress"
  |   - Record executedById and startedAt
  |
  7. Apply promotion patch
  |   - Call applyPromotionPatch(diffPatch)
  |   - Capture deployment log (stdout/stderr)
  |   - If fails → trigger rollback, return error
  |
  8. Post-deployment health check
  |   - Hit /api/health on production (up to 3 retries, 10s apart)
  |   - If unhealthy → trigger rollback, return error
  |
  9. Mark as deployed
  |   - Update ChangePromotion status to "deployed"
  |   - Update ChangeRequest status to "completed"
  |   - Store deployment log
  |   - Record completedAt
  |
  10. Return success with summary
```

**Rollback on failure (steps 7-8):**
```
If applyPromotionPatch() fails or health check fails:
  1. Restore database from backup: psql < backup.sql
  2. Revert code patch: git apply -R
  3. Update ChangePromotion status to "rolled_back"
  4. Update ChangeRequest status to "rolled-back"
  5. Record rollback reason and timestamp
  6. Return error with restore instructions
```

### Section 2: Change Window Enforcement

Enforce deployment window checking at three gates:

#### Gate 1: Ship Phase (advisory)

When `shipBuild()` creates the ChangePromotion + RFC, check available windows and report:
- If a window is available now: include in response message ("Promotion created. A deployment window is available now.")
- If no window now: include next window time ("Promotion created. Next deployment window: Tuesday 10pm-6am.")
- If blackout active: warn ("Promotion created. Blackout active until March 28. Emergency override available.")

This is advisory only — the promotion is still created. The enforcement happens at execution time.

#### Gate 2: Promotion Execution (enforced)

When `executePromotion()` is called (Section 1, step 2), block if:
- Current time is not within any matching `DeploymentWindow` for the RFC type and risk level
- A `BlackoutPeriod` is active and the RFC type is not in the exceptions list

**Override mechanism:** The `ChangePromotion` record gets a new nullable field `windowOverrideReason`. If this field is set (by an admin), the window check is bypassed. Emergency RFCs (`type: "emergency"`) always bypass window checks.

#### Gate 3: Approval UI (informational)

The `PromotionsClient.tsx` approval panel shows:
- Current deployment window status (available / next window at / blackout until)
- Scheduling conflicts with other promotions
- Destructive operation warnings (if migrations contain DROP/TRUNCATE/etc.)

This helps operators make informed approval decisions.

**Schema change:**
```prisma
model ChangePromotion {
  // ... existing fields ...
  windowOverrideReason  String?    // If set, bypasses deployment window check
  destructiveAcknowledged Boolean @default(false)  // Must be true if migrations contain destructive ops
}
```

### Section 3: Destructive Operation Blocking

Change `scanForDestructiveOps()` from advisory to enforced:

**Current behavior:** Returns warning strings, caller ignores them.

**New behavior in `executePromotion()`:**
1. Extract diff and categorize files
2. For each migration file, read its SQL content from the sandbox
3. Run `scanForDestructiveOps()` on each migration
4. If any destructive operations found AND `destructiveAcknowledged` is `false`:
   - Block promotion
   - Return error with the specific warnings
   - Show warnings in the approval UI
5. Admin must explicitly acknowledge via UI toggle (sets `destructiveAcknowledged = true`) before re-attempting

### Section 4: Ship Phase Integration

Update the ship phase to properly sequence: diff extraction → product registration → promotion creation.

**Current ship phase prompt:**
```
Silently call register_digital_product_from_build then create_build_epic.
```

**New ship phase prompt:**
```
Silently:
1. Call deploy_feature to extract the sandbox diff (required before shipping)
2. Call register_digital_product_from_build to register the product and create promotion
3. Call create_build_epic to set up tracking
Tell the user the deployment window status and next steps.
```

**Update `deploy_feature` tool** to also:
- Store the full diff patch on the `FeatureBuild` record (already does this)
- Scan for destructive operations and include warnings in the response
- Check deployment window availability and include in the response

**Update `register_digital_product_from_build` / `shipBuild()`** to:
- Verify `diffPatch` exists on the build record (was `deploy_feature` called first?)
- Include deployment window advisory in the response message

### Section 5: Automated Execution Trigger

Add a "Deploy" button to the `PromotionsClient.tsx` that calls `executePromotion()` when a promotion is approved and a deployment window is available.

**UI flow:**
```
Promotion status: "pending"
  → Operator reviews diff, destructive warnings, window status
  → [Approve] button → status becomes "approved"

Promotion status: "approved"
  → If deployment window available: [Deploy Now] button is enabled
  → If no window: [Deploy Now] disabled, shows "Next window: ..."
  → If blackout: [Deploy Now] disabled, shows "Blackout until: ..."
  → [Deploy Now] → calls executePromotion() → shows progress
  → On success: status becomes "deployed", shows summary
  → On failure: status becomes "rolled_back", shows error + restore instructions

Promotion status: "approved" (emergency)
  → [Emergency Deploy] button always enabled (bypasses window)
  → Requires window override reason text input
```

**New server action: `executePromotionAction(promotionId: string, overrideReason?: string)`**

Location: `apps/web/lib/actions/promotions.ts`

Calls `executePromotion()` from `sandbox-promotion.ts` and returns the result.

### Section 6: Post-Deployment Health Check

After `applyPromotionPatch()` succeeds, verify the production application is healthy:

```typescript
async function verifyProductionHealth(maxRetries = 3): Promise<{ healthy: boolean; error?: string }> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/health", {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { healthy: true };
    } catch { /* retry */ }
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 10_000));
  }
  return { healthy: false, error: "Production health check failed after 3 retries" };
}
```

If unhealthy: automatic rollback using the pre-deployment backup.

### Section 7: Deployment Window Auto-Scheduling

When a promotion is approved but no deployment window is available, offer to schedule it:

**New function: `schedulePromotion(promotionId: string, windowId: string, plannedStartAt: Date)`**

1. Find the next occurrence of the specified deployment window
2. Set `ChangeRequest.plannedStartAt` and `deploymentWindowId`
3. Create a `CalendarEvent` for visibility
4. Transition RFC to "scheduled" status
5. A background job (or manual trigger) executes the promotion at the scheduled time

For MVP, scheduled promotions require manual execution when the window arrives. The UI shows "Scheduled for Tuesday 10pm" and the operator clicks "Deploy Now" during the window.

Future: Automatic execution via cron/scheduled task.

---

## New & Modified Files

### New Functions

| Function | File | Purpose |
|----------|------|---------|
| `executePromotion()` | `apps/web/lib/sandbox-promotion.ts` | End-to-end promotion pipeline |
| `verifyProductionHealth()` | `apps/web/lib/sandbox-promotion.ts` | Post-deployment health check |
| `executePromotionAction()` | `apps/web/lib/actions/promotions.ts` | Server action wrapper for UI |
| `schedulePromotion()` | `apps/web/lib/actions/promotions.ts` | Schedule promotion for future window |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/sandbox-promotion.ts` | Add `executePromotion()`, `verifyProductionHealth()`, enforcement of destructive op blocking |
| `apps/web/lib/actions/promotions.ts` | Add `executePromotionAction()`, `schedulePromotion()` |
| `apps/web/lib/mcp-tools.ts` | Update `deploy_feature` to scan destructive ops and check windows |
| `apps/web/lib/build-agent-prompts.ts` | Update ship phase to call `deploy_feature` before registration |
| `apps/web/components/ops/PromotionsClient.tsx` | Add Deploy Now button, window status, destructive warnings |
| `packages/db/prisma/schema.prisma` | Add `windowOverrideReason`, `destructiveAcknowledged` to ChangePromotion |

---

## Migration

```sql
ALTER TABLE "ChangePromotion" ADD COLUMN "windowOverrideReason" TEXT;
ALTER TABLE "ChangePromotion" ADD COLUMN "destructiveAcknowledged" BOOLEAN NOT NULL DEFAULT false;
```

---

## Epic Placeholders (Future Work)

- **EP-AUTO-DEPLOY** -- Automatic promotion execution via cron when a scheduled window arrives (currently requires manual "Deploy Now" click)
- **EP-PROMOTE-STAGING** -- Staging environment promotion before production (currently promotes directly to production)
- **EP-PROMOTE-NOTIFY** -- Slack/email notifications for promotion status changes (created, approved, deployed, rolled back)
- **EP-MULTI-APPROVER** -- CAB (Change Advisory Board) review for high/critical risk promotions (currently single-approver)

---

## Acceptance Criteria

1. `executePromotion()` runs the full pipeline: validate → check window → check conflicts → backup → extract diff → scan destructive → apply patch → health check → mark deployed
2. If deployment window is not available, execution is blocked with next-window advisory
3. If blackout period is active, execution is blocked with blackout end time
4. Emergency promotions bypass window checks (with required override reason)
5. Destructive SQL operations block promotion until explicitly acknowledged
6. Post-deployment health check triggers automatic rollback on failure
7. `deploy_feature` tool response includes destructive operation warnings and window availability
8. Ship phase prompt sequences: deploy_feature → register_digital_product_from_build → create_build_epic
9. Promotions UI shows Deploy Now button (enabled/disabled based on window availability)
10. Deployment log (stdout/stderr) is captured and stored on ChangePromotion
11. On rollback: database restored from backup, code patch reverted, status set to rolled_back with reason

---

## End-to-End Flow

```
BUILD STUDIO                          OPERATIONS                          PRODUCTION

Build → Review → Ship
  |
  deploy_feature
  (extracts diff, scans destructive ops,
   checks deployment window)
  |
  register_digital_product_from_build
  (creates ProductVersion + ChangePromotion
   + wrapping RFC in draft status)
  |                                   |
  create_build_epic                   Operator sees promotion
  (tracking setup)                    in /ops promotions list
                                      |
                                      Reviews:
                                      - Diff summary
                                      - Destructive warnings
                                      - Window availability
                                      - Scheduling conflicts
                                      |
                                      [Approve] or [Reject]
                                      |
                                      If approved + window available:
                                      [Deploy Now]
                                      |
                                      executePromotion()
                                      |
                                      1. Backup production DB ──────────→ pg_dump saved
                                      2. Extract diff from sandbox
                                      3. Enforce destructive blocks
                                      4. git apply patch ───────────────→ Code updated
                                      5. prisma migrate deploy ─────────→ Schema updated
                                      6. Health check ──────────────────→ /api/health OK?
                                      |
                                      If healthy → "deployed"            Production live
                                      If unhealthy → auto-rollback ─────→ Restored from backup

                                      If no window available:
                                      [Schedule for window]
                                      → Picks next matching window
                                      → Creates calendar event
                                      → Operator clicks Deploy
                                        during window
```

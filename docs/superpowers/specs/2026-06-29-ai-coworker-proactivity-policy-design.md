# AI Coworker Proactivity Policy Design

| Field | Value |
| --- | --- |
| Date | 2026-06-29 |
| Status | Draft for review |
| Owner | Codex |
| Scope | Cross-surface AI coworker proactivity setting for interactive coworkers, scheduled activity, attention surfaces, field dispatch, Build Studio custodian behavior, and recurring operational monitoring |
| Related epics/items | `EP-ATTENTION-SURFACE`, `EP-PROACTIVE-OPS`, `EP-SCHEDULING-SURFACE`, `EP-COWORKER-INTERACTIVITY`, `EP-COST-001`, `BI-5B6F666F`, `BI-ACB04A21` |
| Related specs | `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-05-19-build-studio-stall-detection.md`, `2026-06-13-field-dispatch-capability-design.md`, `2026-05-31-archetype-aware-workspace-design.md`, `2026-06-18-coworker-decision-routing-governance-design.md`, `2026-05-30-build-studio-right-sizing-design.md` |
| Primary repo substrate | `apps/web/lib/tak/autonomous-work-run.ts`, `packages/db/prisma/schema.prisma`, `packages/validators/src/field-dispatch-policy.ts`, `packages/storefront-templates/src/operational-value-stream.ts`, `packages/storefront-templates/src/field-dispatch.ts`, `apps/web/components/agent/AgentPanelHeader.tsx`, `apps/web/components/agent/CoworkerProfilePanel.tsx` |

## 1. Purpose

DPF needs one governed way to answer: "How hard should this AI coworker stay on this?"

Today, proactivity is implicit. Build Studio has custodian-mode backlog items for stuck detection, scheduled coworker work runs through `ScheduledAgentTask`, field dispatch proposes confirmations and running-late notices, and workspace/attention surfaces collect things that need human input. Those are all variations of the same behavior question:

1. When should the coworker notice?
2. How early should it act before a deadline or customer promise is at risk?
3. How many times should it follow up?
4. How much AI/tool spend is justified?
5. When should it escalate to a human, another coworker, or the Attention Surface?
6. What authority boundary still applies?

The answer must vary by mission. A casual chat coworker should not nag. A todo reminder should be persistent but not exhausting. A compliance deadline should be watched closely, but advice must stay cited and approval-gated. A dispatcher coworker for AC, plumbing, roadside, or security response should be assertive because late communication costs revenue, reputation, and customer trust.

This spec defines a cross-surface `ProactivityPolicy` contract and a simple UX dial that resolves into detailed runtime policy.

Backlog ownership: this design is the active shared-primitive implementation slice for `BI-5B6F666F` under `EP-ATTENTION-SURFACE`. The shipped Build Studio pilot `BI-ACB04A21` under the closed `EP-BUILD-STUDIO-UX` is proof and input, not duplicated scope. Build Studio consumption in this design must compose with its existing proactive custodian UX: one plain-language status, one recommended action, bounded alternatives, and details behind disclosure.

## 2. Design Thesis

Show humans a simple behavior dial. Let the platform resolve the actual policy.

User-facing levels:

| Level | User meaning | Runtime intent |
| --- | --- | --- |
| `quiet` | Wait for me unless something is urgent or already approved. | Minimal unsolicited follow-up; only safety, compliance, or explicitly scheduled activity can interrupt. |
| `balanced` | Follow up when timing, commitments, or risk make it useful. | Default. Reasonable nudges, modest spend, bounded retries, and Attention Surface escalation when ignored. |
| `assertive` | Stay on this, warn earlier, and escalate sooner when allowed. | Earlier detection, higher persistence, more frequent checks, stronger escalation, and higher budget class within existing authority. |

The key rule: **proactivity changes persistence, timing, escalation, channel choice, and spend. It never grants new authority.**

Customer-visible sends, assignments, invoices, destructive changes, legal/tax advice, regulated actions, and risky operational changes still use DPF's existing action envelopes, HITL policy, tool grants, and decision-routing governance.

## 3. Current Substrate Inventory

### 3.1 Coworker and governance records

`Agent` already stores role identity, sensitivity, HITL default, escalation target, delegation targets, lifecycle stage, tool grants, skills, governance profile, execution config, and authority bindings. `AgentGovernanceProfile` already carries `autonomyLevel`, `hitlPolicy`, delegation permission, and max delegation risk band.

Design implication: proactivity belongs beside governance, not inside prompts only. The resolver should read coworker identity and governance posture, then return a runtime plan. It should not mutate `autonomyLevel`; autonomy answers "what can the coworker do?" while proactivity answers "how persistently should it pursue allowed work?"

### 3.2 Task-run substrate

`createAutonomousWorkRun()` maps triggers to `TaskRun.source`. Interactive work is `coworker`, Build Studio is `build`, deliberation is `skill`, and scheduled/external/radar/system-recovery/capacity-continuity become `proactive`. Non-interactive triggers start as `working`.

Design implication: proactivity should attach to `TaskRun.a2aMetadata` and eventually to visible task/run projections. A proactive run needs evidence of which policy produced it, not just the fact that it happened.

### 3.3 Scheduled activity

`ScheduledAgentTask` stores a cron schedule, owner, agent, route context, prompt, `lastRunAt`, `nextRunAt`, `lastStatus`, and latest `taskRunId`. `agentTaskDispatch` polls due tasks every five minutes. `executeScheduledAgentTask()` creates an agent thread, creates a `TaskRun`, executes the autonomous agentic loop, persists messages, and updates task/job rows.

Design implication: scheduled tasks are the first natural consumer of `ProactivityPlan`. The scheduler should not grow one-off cadence/escalation fields. It should ask the policy resolver what to do for this activity.

### 3.4 Outbound and attention records

`ScheduledOutboundAction` already has `autopilotPolicyId`, `scheduledByUserId`, `kind`, `targetId`, `scheduledFor`, and status fields. `BI-5B6F666F` and `EP-ATTENTION-SURFACE` establish a proactive "Needs you" lane separate from backlog.

Design implication: proactivity policy can govern outbound reminders and escalation into the Attention Surface without making every reminder a backlog item.

### 3.5 Field dispatch policy

`packages/validators/src/field-dispatch-policy.ts` is the strongest existing pattern. The pure policy proposes actions (`notify`, `assign`, `flag-unassignable`, `flag-attention`, `invoice`) and never mutates or sends. Runtime commits through governance. `field-dispatch-notifications.ts` maps event urgency: `confirm` and `complete` are routine, `on-my-way` is priority, `running-late` is urgent.

Design implication: proactivity should follow this split. Pure policy plans persistence and escalation. Runtime commits or proposes actions through existing governance.

### 3.6 Archetype value stream

`deriveOperationalValueStream()` already derives `loadBearingStageKeys`, `capacityUnit`, `demandSignature`, and trust gates from archetype/category/activation profile. `deriveFieldDispatchProfile()` derives dispatch applicability and per-vertical profile.

Design implication: proactivity defaults should be derived from archetype facts, not hand-authored per leaf. Emergency-reactive, slot-hours, field-dispatch, and load-bearing scheduling stages should bias toward `assertive`.

### 3.7 Coworker UI

The panel header already shows compact controls for sensitivity, Hands On/Hands Off, Advise/Act, External Access, Diagnostics, profile, skills, and provider info. `CoworkerProfilePanel` already shows skills, tools, sensitivity, id, and model requirements.

Design implication: the main proactivity control must stay compact. Advanced policy details belong in the profile/AI Operations/Scheduled Work surfaces, not as another row of header clutter.

## 4. Research and Benchmarking

### 4.1 NIST AI RMF

The NIST AI RMF frames AI risk management around Govern, Map, Measure, and Manage functions. The AI RMF Core is designed to support dialogue, understanding, and activities for trustworthy AI risk management, with Govern as a cross-cutting function. Sources: [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework), [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), [AI RMF 1.0 PDF](https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf).

Adopted pattern: proactivity policy must be governed and measurable. It should produce audit metadata, bounded risk behavior, and evidence for why the level was resolved.

Rejected pattern: prompt-level "be more proactive" instructions with no policy record.

### 4.2 OWASP AI Agent Security

OWASP's AI Agent Security Cheat Sheet emphasizes securing autonomous agents that reason, use tools, remember context, and take actions. It highlights least privilege, monitoring, human oversight for risky actions, and minimizing agent attack surface. Source: [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html). OWASP's MCP guidance similarly points toward authenticated, least-privilege tool access and auditability for agent-tool integration. Source: [OWASP MCP Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html).

Adopted pattern: increasing proactivity must never imply broader tools or bypass HITL. It changes scheduling and escalation around already-authorized work.

Rejected pattern: "assertive" as auto-accept or hidden action mode.

### 4.3 Microsoft agent orchestration patterns

Microsoft's agent orchestration guidance describes patterns where agents and humans can participate in a shared flow, supporting transparency and auditability. Microsoft's Semantic Kernel agent architecture also calls out human-in-the-loop participation where judgment or expertise is required. Sources: [AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns), [Semantic Kernel Agent Architecture](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-architecture).

Adopted pattern: proactivity should express when to involve humans, when to escalate, and when to keep working through a specialist/coworker path.

Rejected pattern: one monolithic agent loop trying to handle every proactivity case. Policy should be a shared resolver consumed by specialized workflows.

### 4.4 Temporal heartbeats and timeouts

Temporal treats heartbeats and timeouts as first-class execution controls. Heartbeat timeouts detect missing progress, and retries are policy-driven. Sources: [Detecting Activity Failures](https://docs.temporal.io/encyclopedia/detecting-activity-failures), [Activity Definition](https://docs.temporal.io/activity-definition), [Activity Timeouts for TypeScript SDK](https://docs.temporal.io/develop/typescript/activities/timeouts).

Adopted pattern: silence is a signal. DPF already has Build Studio stall detection; proactivity extends the idea from "is it alive?" to "how aggressively should this situation be watched and escalated?"

Rejected pattern: background polling with no explicit policy or heartbeat/attempt accounting.

### 4.5 Iconography and color accessibility

NN/g's icon-usability guidance says icons are often ambiguous without visible labels, even when they save space. W3C WCAG 2.2 guidance for use of color says color should not be the only way information is conveyed. Sources: [NN/g Icon Usability](https://www.nngroup.com/articles/icon-usability/), [WCAG Understanding SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

Lucide's `Gauge` and `CircleGauge` icons fit the dimension because they represent a dial, meter, speed, measure, and level. That maps to proactivity better than symbols that imply danger, alerts, or automatic permission. Sources: [Lucide Gauge](https://lucide.dev/icons/gauge), [Lucide CircleGauge](https://lucide.dev/icons/circle-gauge).

Adopted pattern: use a gauge/speedometer-style symbol plus the text label. The symbol communicates adjustable intensity; the label disambiguates that the dimension is proactivity, not safety, priority, or authority.

Rejected patterns:

- Alert/warning symbol: reads as an incident or danger state, not a user-controlled behavior posture.
- Flame/lightning symbol: reads as urgency, but can imply unsafe action or escalation.
- Pure traffic-light dots: compact, but color-only without a semantic shape.
- Three unrelated symbols for the three levels: creates recognition cost and makes the setting feel like three different modes instead of one adjustable dimension.

## 5. Core Concepts

### 5.1 Closed enum

```ts
export const PROACTIVITY_LEVELS = ["quiet", "balanced", "assertive"] as const;
export type ProactivityLevel = (typeof PROACTIVITY_LEVELS)[number];
```

User copy may say Quiet / Balanced / Assertive. The code uses lowercase hyphen-free values. Do not use synonyms such as `low`, `medium`, `aggressive`, or `not-proactive` in persisted policy.

### 5.2 Activity family

```ts
export const PROACTIVITY_ACTIVITY_FAMILIES = [
  "interactive-chat",
  "todo-follow-up",
  "scheduled-task",
  "field-dispatch-appointment",
  "build-studio-custodian",
  "technology-debt",
  "platform-health",
  "tax-compliance",
  "customer-communication",
  "finance-close",
  "security-incident",
] as const;
```

The list should start small in implementation. It is a policy axis, not a new workflow taxonomy. Adding a value requires updating the resolver and test matrix.

### 5.3 `ProactivityPolicy`

`ProactivityPolicy` is the durable configuration or catalog row. V1 can be code-owned plus operator overrides; V2 can persist first-class rows after evidence proves the shape.

```ts
type ProactivityPolicy = {
  policyId: string;
  level: ProactivityLevel;
  appliesTo: {
    agentId?: string;
    activityFamily?: ProactivityActivityFamily;
    archetypeCategory?: string;
    archetypeId?: string;
    routeContext?: string;
    riskBand?: "low" | "medium" | "high" | "critical";
  };
  planDefaults: {
    attentionWindowMinutes: number;
    followUpCadenceMinutes: number[];
    maxAttempts: number;
    spendClass: "minimal" | "standard" | "elevated";
    escalationTarget: "attention-surface" | "owner" | "role" | "dispatcher" | "platform-operator";
    channelPolicy: "in-app-only" | "preferred-channel" | "urgent-channel" | "multi-channel";
    actionBoundary: "advise" | "propose" | "preauthorized";
  };
  rationale: string;
  source: "system-default" | "archetype-default" | "org-override" | "user-override" | "coworker-proposal";
};
```

### 5.4 `ProactivityPlan`

`ProactivityPlan` is the runtime result for one task, event, conversation, or scheduled activity.

```ts
type ProactivityPlan = {
  resolvedLevel: ProactivityLevel;
  policyId: string;
  attentionWindowMinutes: number;
  followUpCadenceMinutes: number[];
  maxAttempts: number;
  spendClass: "minimal" | "standard" | "elevated";
  channelPolicy: "in-app-only" | "preferred-channel" | "urgent-channel" | "multi-channel";
  escalationTarget: string;
  actionBoundary: "advise" | "propose" | "preauthorized";
  explanation: string;
  evidenceRefs: Array<{ kind: string; id: string }>;
};
```

The plan is written into `TaskRun.a2aMetadata.proactivity` for work that creates a `TaskRun`, and into the relevant outbound/action metadata when no task run exists yet.

## 6. Resolution Order

The resolver answers: "Given this activity, what level and behavior should apply?"

Resolution order:

1. Explicit per-activity override accepted by a human.
2. User or org override for the coworker/activity.
3. Archetype-derived default.
4. Coworker role default.
5. Activity family default.
6. Platform fallback (`balanced`).

If two defaults conflict, choose the more assertive one only when the activity is time-sensitive, customer-visible, deadline-bound, or operationally load-bearing. Otherwise choose the less disruptive one.

The resolver must also intersect with governance:

- `hitlPolicy` and `maxDelegationRiskBand` constrain `actionBoundary`.
- Tool grants constrain available actions.
- Communication channel bindings constrain `channelPolicy`.
- Cost/budget policy constrains `spendClass`.
- Decision-routing governance constrains legal, tax, compliance, and business judgment responses.

Delegated coworker work is a separate resolution layer, not a V1 blocker. If a coworker delegates subtasks to other coworkers, the subtasks should still execute once legitimately delegated; proactivity does not decide whether the work exists. The initiating task may pass advisory context posture, including its proactivity level and golden-triangle cost/quality/time intent. The receiving coworker must then resolve that advisory context against its own local policy, mission, risk, authority, and quality floor. A time-priority caller can bias subtasks toward time, but a receiving coworker responsible for regulated, high-risk, or quality-critical work can override toward higher quality. `BI-424CFE7A` owns this propagation work.

Implementation status: PR #2524 adds the first shared substrate for `BI-424CFE7A`: `apps/web/lib/proactivity/delegated-posture.ts` resolves advisory caller proactivity and golden-triangle posture against receiver local policy, and `createAutonomousWorkRun` can persist the resolved result to `TaskRun.a2aMetadata.delegatedPosture`. This does not yet wire automatic propagation into every coworker handoff path.

## 7. Defaults

### 7.1 Activity defaults

| Activity family | Default level | Notes |
| --- | --- | --- |
| `interactive-chat` | `quiet` or `balanced` | Page/coworker specific. Chat should not create hidden background loops by default. |
| `todo-follow-up` | `balanced` | One or two follow-ups, then Attention Surface. |
| `scheduled-task` | `balanced` | Run on schedule, summarize, surface failures. |
| `field-dispatch-appointment` | `assertive` | Customer promise and revenue/reputation risk. |
| `build-studio-custodian` | `balanced`; `assertive` for blocked/stalled | Normal progress stays bounded; stuck work gets early attention. |
| `technology-debt` | `balanced` | Persistent review and backlog surfacing; no noisy nagging. |
| `platform-health` | `balanced`; `assertive` for degraded/offline | Service-impacting health can escalate. |
| `tax-compliance` | `balanced`; deadline reminders can be `assertive` | Advice remains cited and approval-gated. |
| `customer-communication` | `balanced`; urgent events `assertive` | Running late, failed send, high-value account, or emergency increases level. |
| `finance-close` | `balanced` | Recurring nudges; assertive only near cutoff. |
| `security-incident` | `assertive` | Detection/escalation high; containment actions still governed. |

### 7.2 Archetype defaults

Use existing archetype projections:

- `demandSignature = "emergency-reactive"` biases live service events to `assertive`.
- `capacityUnit = "slot-hours"` plus field dispatch biases appointment risk to `assertive`.
- `loadBearingStageKeys` containing `qualify` for appointment checkout or `deliver` for recurring service increases proactivity for schedule and service commitments.
- `trustGates` for regulated sectors increase detection proactivity but reduce automatic action.
- `FieldDispatchProfile.notificationEvents` containing `running-late` activates assertive late-arrival handling.

Examples:

| Archetype / category | Default policy |
| --- | --- |
| Trades and maintenance with field dispatch | `assertive` for appointment delay, assignment gap, failed customer update; `balanced` for back-office suggestions. |
| Automotive services / roadside / mobile repair | `assertive` for live service events; `balanced` for inventory and follow-up. |
| Security services | `assertive` for live incidents and shift coverage gaps; cautious action boundary for public-safety-sensitive data. |
| Healthcare/wellness | `balanced` for appointment readiness; assertive deadline/reminder detection; regulated evidence/action remains cautious. |
| Professional services | `balanced` for client deadlines and missing inputs; quiet for casual advice. |
| Software platform | `balanced` for tech debt and service health; assertive for outage/degraded customer-facing systems. |
| Retail/food/hospitality | `balanced` for stock/order/task follow-up; assertive for customer-impacting fulfillment exceptions. |
| Banking/financial/public sector | assertive detection for deadlines/incidents, cautious/cited/approved action boundary. |

### 7.3 Coworker role defaults

| Coworker role | Default |
| --- | --- |
| Dispatcher / scheduler | `assertive` for live appointments and assignment exceptions. |
| Compliance / finance / tax | `balanced`, with deadline-driven assertive reminders. |
| Build Studio / platform operator | `balanced`; stuck/stalled/degraded becomes `assertive`. |
| Marketing / storefront / customer success | `balanced` for campaigns and follow-ups; quiet for ideation chat. |
| General workspace coworker | `balanced` for commitments; quiet for advice. |
| Onboarding coworker | `balanced` during setup; quiet after setup is complete unless gaps block operation. |

## 8. UX Design

### 8.1 Coworker composer critical-settings dock

The primary coworker-chat placement is the existing golden-triangle priority dock just above the composer input (`CoworkerPriorityDock`). Proactivity is another critical behavior setting, so it should sit immediately to the right of the collapsed golden-triangle chip in the same strip.

Collapsed resting state:

`Priority  Higher Reasoning    Proactivity  Balanced`

The proactivity chip should be compact enough to fit in the available horizontal space to the right of the triangle. It is a sibling control, not a replacement for the triangle. Priority answers cost/quality/time posture; proactivity answers how persistently the coworker should pursue allowed work.

Recommended visual language:

| Level | Symbol treatment | Accent | Meaning |
| --- | --- | --- | --- |
| Quiet | Gauge needle low-left, calm fill/arc | Green | Minimum unsolicited follow-up. |
| Balanced | Gauge needle centered | Yellow | Normal default persistence. |
| Assertive | Gauge needle high-right, stronger fill/arc | Red | Aggressive monitoring, earlier warning, faster escalation. |

Use these colors as accents only, paired with the text label and accessible name. Color must not be the only signal. The red state should communicate stronger persistence, not danger or unauthorized action.

Preferred symbol: a compact gauge/speedometer icon, implemented with `Gauge` or `CircleGauge` from `lucide-react` where possible. If a level-specific needle position is required and the stock icon cannot express it, create a tiny local `ProactivityGaugeIcon` using the same stroke width and sizing conventions as Lucide. Keep it visually parallel to the golden triangle: compact, geometric, and meaningful at 14-16px.

Do not use warning triangles, alert circles, flame/lightning marks, or color-only dots for the main resting-state symbol.

Click opens a small segmented control:

`Quiet | Balanced | Assertive`

Plain-language helper copy:

- Quiet: "Wait for me unless something is urgent or already approved."
- Balanced: "Follow up when timing, commitments, or risk make it useful."
- Assertive: "Stay on this, warn earlier, and escalate sooner when allowed."

The control should use familiar segmented-button styling, theme tokens, and no hardcoded color. It must not crowd mobile. On narrow widths, fold it into the existing profile/settings disclosure or a second line inside the dock rather than forcing the composer/header to overflow.

### 8.2 Coworker panel header

The broader panel header may also show a read-only proactivity status when space allows, but editing should happen in the composer critical-settings dock and profile/settings surfaces. This keeps the behavior control close to where the operator is actively talking to the coworker.

### 8.3 Coworker profile

`CoworkerProfilePanel` gains a "Proactivity" section:

- current effective level,
- why it was chosen,
- default source (`system`, `archetype`, `org override`, `user override`, `coworker proposal`),
- activity-specific exceptions,
- advanced policy details for admins.

Advanced details include cadence, max attempts, spend class, channels, escalation target, and action boundary.

### 8.4 Scheduled Work / AI Operations

Scheduled work and AI Operations surfaces show the effective proactivity plan for recurring activity. Operators can filter for:

- assertive policies,
- policies with elevated spend,
- policies with multi-channel escalation,
- policies with repeated ignored attempts,
- coworker-proposed policy changes pending acknowledgement.

### 8.5 Attention Surface

The Attention Surface should render proactivity as one reason an item appears:

"Escalated because the customer appointment window is at risk and the dispatcher policy is Assertive."

Avoid raw policy ids in worker-facing copy.

## 9. AI-Suggested Policy Changes

Coworkers may recommend a proactivity adjustment when evidence shows the current level is wrong.

Allowed proposal examples:

- "Appointments are slipping and this archetype depends on same-day dispatch. I recommend switching appointment-delay monitoring to Assertive."
- "This todo has been ignored three times and is no longer urgent. I recommend moving it to Quiet and keeping it in Needs You."
- "This tax deadline is within seven days. I recommend Assertive reminders until filed."

The coworker must include:

1. current level,
2. proposed level,
3. activity scope (`this appointment`, `all field-dispatch appointment delays`, `this coworker`, etc.),
4. evidence,
5. expected behavior change,
6. spend/notification impact,
7. acknowledgement options.

The user may:

- apply once,
- apply for this activity type,
- apply for this coworker,
- dismiss,
- ask for details.

Accepted changes write an auditable policy override. Dismissed proposals should cool down to prevent repeated nagging about the same setting.

## 10. Runtime Flows

### 10.1 Field dispatch running-late

1. Job ETA slips or current appointment runs long.
2. Field dispatch policy emits a `notify` intent for `running-late`.
3. Proactivity resolver sees `field-dispatch-appointment`, field-dispatch profile, customer-visible urgency, and emergency/reactive or slot-hours context.
4. Resolver returns `assertive`.
5. Runtime starts earlier than the promised window threshold, proposes customer update, and escalates to dispatcher if approval/contact is blocked.
6. Action still goes through communication channel selection and proposal/approval unless an explicit automation policy exists.

### 10.2 Todo follow-up

1. A user or coworker creates a task with due date or promised follow-up.
2. Resolver returns `balanced`.
3. One or two follow-ups occur at policy cadence.
4. If ignored, item moves to Attention Surface; no endless notifications.
5. Coworker may suggest `quiet` if the task repeatedly loses relevance.

### 10.3 Tax/compliance deadline

1. Compliance monitor detects upcoming deadline or law-change review requirement.
2. Resolver returns `balanced`; deadline window may elevate reminders to `assertive`.
3. Coworker retrieves cited sources and creates an evidence-backed summary.
4. Filing, advice, or external submission remains HITL/approval-gated.
5. Missed or blocked actions escalate to owner/role and Attention Surface.

### 10.4 Technology debt / platform health

1. Health or debt signal is detected.
2. Resolver returns `balanced`.
3. Coworker creates review, backlog suggestion, or scheduled check.
4. Service-affecting degradation can elevate to `assertive`.
5. Repeated debt patterns route to proceduralization/backlog, not endless chat.

### 10.5 Build Studio custodian mode

1. Build is running normally: `balanced`.
2. Build is blocked, stalled, or missing progress evidence: `assertive`.
3. Coworker surfaces guided next action and can propose retry/abandon/escalate.
4. Recovery still follows Build Studio phase rules and governance.
5. Spend class remains bounded by Build Studio right-sizing and cost governance.
6. Do not fork the shipped Build Studio custodian implementation from `BI-ACB04A21`; consume or expose the shared `ProactivityPlan` at existing Build Studio progress/stall/escalation seams.

Implementation note: the Build Studio custodian prompt derivation consumes the shared `build-studio-custodian` proactivity resolver and attaches the resulting `ProactivityPlan` to the prompt object. The visible callout remains outcome-focused: one "why now" line, one recommended action, snooze/show-why alternatives, and no default exposure of internal build IDs or diagnostic queues.

User-facing rule: Build Studio and every other consuming surface should remain quiet while work is progressing, then surface one recommended action with bounded alternatives such as snooze/show why. Internal IDs, queues, branches, and diagnostic jargon remain hidden by default and appear only in engineer-oriented disclosures.

## 11. Data Model Strategy

### V1: code-owned defaults plus lightweight overrides

V1 should avoid a broad schema migration until the policy matrix has evidence. Implement:

- `apps/web/lib/proactivity/proactivity-types.ts`
- `apps/web/lib/proactivity/proactivity-policy.ts`
- `apps/web/lib/proactivity/proactivity-resolver.ts`
- `apps/web/lib/proactivity/proactivity-resolver.server.ts`
- `apps/web/lib/proactivity/proactivity-copy.ts`
- tests for archetype/coworker/activity fixtures

Persist accepted overrides in the narrowest existing suitable substrate if one exists after implementation sweep. If no suitable existing store exists, add a small dedicated table:

```prisma
model ProactivityOverride {
  id             String   @id @default(cuid())
  scopeKind      String   // user | organization | agent | activity | scheduled-task
  scopeId        String
  activityFamily String?
  level          String
  rationale      String?
  proposedByAgentId String?
  acknowledgedByUserId String?
  source         String   // user | org-admin | coworker-proposal
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  expiresAt      DateTime?

  @@index([scopeKind, scopeId])
  @@index([activityFamily])
  @@index([level])
}
```

Do not add a large generic rules engine in V1.

Implementation status, 2026-06-30: the implementation sweep found `UserFact` suitable for narrow user-scoped proactivity acknowledgements, so V1 does not add `ProactivityOverride`. Accepted coworker proposals persist `preference` facts keyed as `aiCoworkerProactivity:<scopeKey>`; dismissed proposals persist cooldown facts keyed as `aiCoworkerProactivityCooldown:<scopeKey>`. The pure resolver remains client-safe in `proactivity-resolver.ts`; the server-only resolver in `proactivity-resolver.server.ts` reads `UserFact`, applies the most-specific active acknowledgement by agent, route context, then activity family, and returns evidence refs plus cooldown suppression metadata. Scheduled task execution consumes the server resolver with `ownerUserId` so `TaskRun.a2aMetadata.proactivity` reflects the effective user-aware plan without bundling Prisma into client surfaces. Field-dispatch now follows the same boundary: `field-dispatch-runtime.ts` stays pure, while `field-dispatch-runtime.server.ts` applies acknowledged user overrides and cooldowns before producing customer notification proposal metadata and can persist those proposals as `AgentActionProposal` rows so the existing Attention Surface `agent-proposal` source renders them.

### V2: first-class policy rows

If operators start tuning many policies, promote system/archetype defaults to first-class catalog rows and add admin UI. Until then, typed code-owned policy is simpler, safer, and easier to test.

## 12. Architecture Boundaries

### Proactivity vs autonomy

Autonomy controls what the coworker may do. Proactivity controls how persistently it pursues allowed work.

### Proactivity vs priority

Priority answers "how important is this item?" Proactivity answers "how aggressively should the system follow up or escalate?" A low-priority recurring hygiene task may be balanced; a high-priority legal action may be assertive for reminders but still require approval.

### Proactivity vs notification preference

Notification preference controls channels a person accepts. Proactivity selects urgency/channel policy within those preferences and verified bindings.

### Proactivity vs Build Studio right-sizing

Right-sizing controls process intensity for development work. Proactivity controls monitoring/escalation behavior around the process.

### Proactivity vs delegated coworker execution

Delegation decides which coworker owns a subtask. Proactivity decides how persistently that coworker should monitor, follow up, and escalate within its authority. Subtasks execute according to the receiving coworker's local policy unless an initiating context supplies advisory posture that the receiver can safely honor. The receiving coworker's local risk and quality requirements must remain able to override caller proactivity and golden-triangle intent.

### Proactivity vs Attention Surface

The Attention Surface is where unresolved human-needed items land. Proactivity determines when and why an item gets moved there.

## 13. UX Fit Review

- Decision: `fits-with-guardrails`.
- Owning area: AI Workforce / Workspace / Platform AI, with contextual presence in coworker panel and Scheduled Work.
- Route family: existing coworker panel, coworker profile, AI Operations, Scheduled Work, Attention Surface. No new global dashboard.
- Primary persona: founder/operator, dispatcher/scheduler, platform operator.
- Navigation layer touched: contextual action and existing profile/settings details only.
- Reuse/convergence: reuse existing coworker header/profile patterns and scheduled/operations surfaces. Do not add another dashboard.
- Source truth: `ProactivityPlan` from resolver, recorded on `TaskRun.a2aMetadata.proactivity` and/or policy override rows.
- Empty/failure behavior: missing policy resolves to `balanced`; missing channel falls back to Attention Surface; denied grants reduce action boundary.
- AI boundary: coworker may propose a policy change, never silently broaden its behavior.
- Evidence before merge: resolver unit tests, UI route/component tests, no hardcoded colors, browser verification for coworker panel/profile, scheduled field-dispatch fixture, Build Studio stuck fixture.

## 14. Refactoring Budget

Reserve roughly 20 percent of implementation effort for refactoring.

Required refactoring targets:

1. Extract a shared `proactivity` module instead of adding one-off thresholds to Build Studio, scheduled tasks, or field dispatch.
2. Keep field-dispatch pure policy pure; proactivity wraps runtime behavior, not domain decision logic.
3. Avoid adding proactivity fields directly to multiple unrelated models until the resolver shape is proven.
4. Consolidate copy strings for Quiet/Balanced/Assertive so panel/profile/admin surfaces do not drift.
5. Add typed enums and tests before wiring UI.

## 15. Implementation Slices

### Slice 1: Policy resolver and tests

Files:

- Create `apps/web/lib/proactivity/proactivity-types.ts`
- Create `apps/web/lib/proactivity/proactivity-policy.ts`
- Create `apps/web/lib/proactivity/proactivity-resolver.ts`
- Create `apps/web/lib/proactivity/proactivity-copy.ts`
- Test `apps/web/lib/proactivity/proactivity-resolver.test.ts`

Acceptance:

- `trades-maintenance` + field-dispatch appointment delay resolves `assertive`.
- general todo follow-up resolves `balanced`.
- Build Studio blocked/stalled resolves `assertive`.
- interactive chat resolves `quiet` or `balanced` depending on route/coworker.
- regulated/tax/compliance deadline resolves assertive reminders but `actionBoundary = "propose"` or `advise`, not preauthorized.

### Slice 2: TaskRun and scheduled activity integration

Files:

- Modify `apps/web/lib/tak/autonomous-work-run.ts`
- Modify `apps/web/lib/actions/agent-task-scheduler.ts`
- Modify scheduled summary/projection helpers as needed

Acceptance:

- scheduled task runs write `a2aMetadata.proactivity`.
- failures and ignored attempts can escalate to Attention Surface according to plan.
- no scheduled task bypasses existing owner/tool/HITL checks.

Status, 2026-06-30: implemented for scheduled task execution with user-aware resolution. The shared pure resolver remains available for client and fixture callers; the server resolver applies acknowledged override/cooldown facts before scheduled work writes proactivity metadata. Failed scheduled work now projects into the existing Attention Surface when the stored proactivity plan is not quiet, using plain "why now" copy and one review action. Quiet user-overridden scheduled work stays out of the inbox by reading `TaskRun.a2aMetadata.proactivity` before falling back to default scheduled-task policy.

### Slice 2A: Delegated coworker posture substrate

Files:

- Create `apps/web/lib/proactivity/delegated-posture.ts`
- Test `apps/web/lib/proactivity/delegated-posture.test.ts`
- Modify `apps/web/lib/tak/autonomous-work-run.ts`

Acceptance:

- delegated coworker subtasks are never blocked solely because of the caller's proactivity setting.
- caller proactivity and golden-triangle priority are inherited as advisory context.
- receiver local policy can override caller posture for regulated, risk-sensitive, or quality-critical work.
- `TaskRun.a2aMetadata.delegatedPosture` records the resolved posture after generic metadata is merged, so callers cannot accidentally clobber the governed result.

### Slice 3: Coworker panel/profile UX

Files:

- Modify `apps/web/components/agent/AgentPanelHeader.tsx`
- Modify `apps/web/components/golden-triangle/CoworkerPriorityDock.tsx`
- Modify `apps/web/components/agent/CoworkerProfilePanel.tsx`
- Add small presentational component if needed: `ProactivityLevelControl.tsx`

Acceptance:

- compact level control renders beside the golden-triangle priority chip without crowding the composer dock.
- mobile folds control into profile/details.
- green/yellow/red accents map Quiet/Balanced/Assertive while preserving text labels and accessible names.
- copy uses shared proactivity copy.
- admin profile shows advanced details.
- no hardcoded colors.

### Slice 4: AI proposal/acknowledgement path

Files:

- Reuse `CoworkerActionEnvelope` or existing proposal substrate.
- Add action type such as `propose_proactivity_change` if needed.

Acceptance:

- coworker can propose a level change with evidence.
- accepted proposal creates override or activity-scoped setting.
- dismissed proposal cools down.
- all changes audit who proposed, who acknowledged, scope, prior level, new level, and rationale.

Status, 2026-06-30: implemented without a new table. Approved proactivity change proposals create scoped `UserFact` preference records; rejected proposals create scoped cooldown facts so the coworker does not immediately repeat the same suggestion. The runtime resolver now consumes those facts for scheduled work. Remaining work is to extend the same user-aware consumption into field-dispatch and Attention Surface projections.

### Slice 5: Field dispatch and Build Studio fixtures

Files:

- Field dispatch runtime caller, not pure validator functions.
- Build Studio custodian/stuck detection caller.
- Attention Surface projection.

Acceptance:

- running-late appointment produces assertive plan and early customer-update proposal.
- blocked Build Studio work produces assertive custodian guidance.
- normal Build Studio progress remains balanced.

Status, 2026-06-30: field-dispatch runtime has a server-only user-aware proposal builder and producer. Running-late customer updates still resolve assertive by default, but acknowledged user overrides can quiet or rebalance them, cooldown facts are carried into proposal metadata, and notification proposals persist through `AgentActionProposal` with deterministic IDs so `/workspace` and `/workspace/inbox` can project them through the existing `agent-proposal` attention source. Build Studio remains already composed through its shipped custodian pilot and shared resolver consumption; broader scheduled-work escalation projection remains open.

## 16. Verification

Required gates:

1. Unit tests for resolver matrix and copy.
2. Affected component tests for coworker panel/profile.
3. Typecheck for web package.
4. Production build.
5. UX verification on coworker panel/profile and at least one scheduled/proactive surface.
6. Field-dispatch fixture proof.
7. Build Studio blocked/stalled fixture proof.
8. Migration apply if a `ProactivityOverride` table is added.

Runtime-bound gates must run on canonical local install or shared local-CI convergence sandbox per AGENTS.md.

## 17. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Coworker becomes annoying | Default most work to `balanced`; cap attempts; route ignored work to Attention Surface instead of endless messages. |
| Assertive is mistaken for more authority | UI and resolver make `actionBoundary` explicit; governance still gates tools/actions. |
| Policy matrix becomes opaque | Show "why this level" in profile and scheduled work details. |
| Admin UI becomes too complex | Simple dial first; advanced details behind disclosure and admin-only where appropriate. |
| Cost blowout | `spendClass` intersects with AI cost governance; elevated spend only for assertive/time-critical cases. |
| Legal/tax/compliance overreach | Assertive detection/reminders, cautious action; cited sources and approval required. |
| Duplicated nag loops | Shared proactivity module and 20 percent refactoring budget. |
| Archetype defaults wrong | Start with fixtures for field dispatch, todos, Build Studio; add telemetry and coworker-proposed changes to refine. |

## 18. Open Decisions

1. Whether V1 override persistence can reuse an existing preference/config table or needs `ProactivityOverride`.
2. Whether the header control should be visible for every user or only when the user has authority to change the effective level. Recommendation: visible as status for all, editable only when permitted.
3. Whether `assertive` can ever imply preauthorized customer notifications. Recommendation: only when a separate automation policy exists and the communication event is low-risk and reversible enough.
4. Whether Build Studio custodian mode owns a specialized policy overlay. Recommendation: consume the shared resolver; do not fork.
5. Whether delegated coworkers should inherit initiating task posture. Recommendation: create a future context override model where caller posture is advisory and receiving coworker local policy can override. Backlog: `BI-424CFE7A`.

## 19. Recommendation

Implement the policy-matrix approach:

1. Simple visible dial: Quiet / Balanced / Assertive.
2. Shared `ProactivityPolicy` resolver by coworker, activity, archetype, risk, and authority.
3. Runtime `ProactivityPlan` written to task/outbound metadata.
4. AI-suggested changes through acknowledged, auditable proposals.
5. First fixtures: field-dispatch appointment delay, general todo follow-up, Build Studio stuck detection.

This gives DPF a consistent way for coworkers to be helpful without becoming noisy, and assertive where business outcomes genuinely depend on it.

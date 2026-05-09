# EP-WIKI-003: Importance Scoring and Reflection-Triggered Derivation

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-003 |
| **Builds on** | [EP-WIKI-001 — Platform Kernel Wiki + Per-Org Overlay](2026-05-09-platform-kernel-wiki-design.md) |
| **Depends on** | EP-WIKI-001 Phase 2 (ingest pipeline shipped) |
| **Status** | Draft (research follow-up) |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman + Claude (design partner) |
| **Inspiration** | Park et al., *Generative Agents: Interactive Simulacra of Human Behavior* (<https://arxiv.org/abs/2304.03442>) — memory stream + importance score + reflection tree; A-MEM (<https://arxiv.org/abs/2502.12110>) — memory evolution as a write-path step |

---

## 1. Problem

EP-WIKI-001 detects "summary pages without an extracted stance" via a daily lint check (`stance-extraction-needed`). The lint catches the gap *after* it has formed — the wiki's judgment surface lags reality.

The Generative Agents paper shows a more active pattern. Every memory carries an LLM-rated **importance score (1–10)**. When the cumulative importance of new memories about a topic exceeds a threshold, a **reflection** fires: the system retrieves the relevant memories, synthesizes a higher-level statement *with citations to the supporting memories*, and writes the reflection back as a new memory. Reflections themselves carry importance and can trigger further reflections.

Mapped onto our wiki: when enough material accumulates about an entity, the runtime should **actively construct** a `summary` or `stance` page on that entity, with citations. The judgment lens grows itself rather than waiting for a human to notice it's incomplete.

This is the right pattern for the "what would Mark do?" surface — the kernel exists because people want judgment, not summaries. Demand-driven derivation produces stances when the evidence demands them.

---

## 2. Design

### 2.1 Importance on Sources and Revisions

Add to `RawSource` and `WikiPageRevision`:

```prisma
importance Int? // 1–10, LLM-scored at create time
```

Scoring at ingest:
- A source's importance is rated against the canonical entity registry: "How important is this source to the entities it touches? 1 = trivial, 10 = paradigm-shifting."
- A revision's importance is rated against the page's prior body: "How much new judgment does this revision add? 1 = typo fix, 10 = stance reversal."

Single LLM call per source/revision. Use median of 3 calls when calibration is fragile (anchor examples in the prompt help).

### 2.2 Reflection Triggers

New model:

```prisma
model WikiReflectionTrigger {
  id                       String   @id @default(cuid())
  organizationId           String?
  entityPageId             String   // the page we'd reflect *on*
  accumulatedImportance    Int      @default(0)
  threshold                Int      @default(15)
  lastReflectedAt          DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  entityPage               WikiPage @relation(fields: [entityPageId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([entityPageId])
}
```

On every ingest:
1. For each entity slot the source touches, find or create a `WikiReflectionTrigger` for `(organizationId, entityPageId)`.
2. Add `source.importance` to `accumulatedImportance`.
3. If `accumulatedImportance >= threshold`, enqueue a reflection job.

### 2.3 Reflection Job

`apps/web/lib/wiki/reflection.ts` (Inngest async function):

1. Pull all sources whose ingest contributed to this trigger since `lastReflectedAt`.
2. Run an LLM synthesis pass: "Given these sources and the existing entity page, propose a `summary` or `stance` page that captures the underlying position. Cite each contributing source and any existing wiki pages you generalize from."
3. Write the proposal as a new `WikiPage` (status `draft`, `pageKind = "stance" | "summary"`, `WikiPageSource[]` populated, plus links to derived-from wiki pages — see EP-WIKI-001 §13 P14).
4. Reset trigger: `accumulatedImportance = 0`, `lastReflectedAt = now()`.
5. Notify the agent-coworker for review.

Reflections themselves are revisions and carry importance, so a reflection on entity A may contribute to a reflection trigger on entity B.

### 2.4 Lint Replacement

| Old EP-WIKI-001 lint | Replacement |
|----------------------|-------------|
| `stance-extraction-needed` | Removed. Demand-driven reflection produces stances proactively. |

New lint check: `reflection-overdue` — a `WikiReflectionTrigger` with `accumulatedImportance > 2 × threshold` and no recent reflection (queue stuck or budget exhausted). Severity: warn.

### 2.5 Threshold Tuning

Default `threshold = 15`. Tunable per org via admin UI; per page via an explicit set on the trigger row. Rationale: at importance 5 average, ~3 sources trigger; at importance 8 average, ~2 sources trigger. The 1–10 scale is forgiving here.

---

## 3. Why This Is Better

- **Demand-driven, not schedule-driven.** Reflections fire when evidence demands them, not when a daily cron runs.
- **Citations all the way up.** Reflections cite both their sources and any wiki pages they generalize from — the provenance chain is complete (one of the patterns we explicitly want, EP-WIKI-001 §13 P14).
- **Recursive judgment.** Reflections trigger reflections. The kernel's stance pages can themselves evolve toward meta-stances ("Mark's view on how to apply X across portfolios") without any human intervention.
- **Aligns with the kernel's purpose.** People ask "what would Mark do?" and the system actively constructs the answer instead of relying on a human to write it.

---

## 4. Risks

- **Importance calibration drifts across LLM versions.** Mitigation: anchor examples in the scoring prompt; keep a small evaluation set of human-rated sources and re-calibrate when scores diverge. Long-term: distill to a small in-house model.
- **Threshold gaming.** A noisy stream of low-importance sources can stall reflection. Mitigation: `reflection-overdue` lint surfaces stuck triggers.
- **Hallucinated stances.** A reflection on thin evidence produces a page that *sounds* like a position but isn't grounded. Mitigation: same publish gate as ingest — `WikiPageSource[]` non-empty, no dangling `[[...]]`. Reflections on triggers below 2 sources are blocked.
- **Reflection storms.** A single high-importance source touching N entities fires N reflection jobs at once. Mitigation: rate-limit per `organizationId` (e.g. 5 reflections/hour); prioritize by accumulated importance.
- **Reflections themselves carry importance.** A reflection on entity A scoring 9 contributes 9 to triggers on entities it touches. Bound recursion depth (`reflectionDepth Int @default(0)` on revisions, max 3).

---

## 5. Out of Scope

- **Importance distillation to a small model.** Worth a follow-up once we see the calibration shape.
- **Cross-tenant reflection.** A pattern Mark sees across customer overlays could become a kernel update — but the privacy/governance model for that is a separate spec.
- **Reflection across time.** "Mark's stance evolved from X to Y between 2024 and 2026" pages — needs EP-WIKI-002 (bi-temporal) shipped first.

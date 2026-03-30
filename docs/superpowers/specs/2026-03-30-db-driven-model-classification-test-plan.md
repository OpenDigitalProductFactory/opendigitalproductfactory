# EP-INF-012b: Test Plan — DB-Driven Model Classification & Capability Matching

**Date:** 2026-03-30
**Spec:** `2026-03-30-db-driven-model-classification-design.md`
**Testing approach:** TDD — these tests define the expected outcomes and should be written BEFORE implementation code.

---

## Test Layers

| Layer | Framework | Purpose | Location |
| ----- | --------- | ------- | -------- |
| Unit | vitest | Pure function logic — classification, matching, filtering, re-seed safety | `apps/web/lib/routing/*.test.ts` |
| Integration | vitest + Prisma | DB queries, seed behavior, upsert safety | `packages/db/src/__tests__/` |
| E2E | Playwright | Full-stack agent routing through the running platform | `e2e/ep-inf-012b-*.spec.ts` |

---

## Section 1: ModelFamilyRule — Classification from DB

### Unit Tests (`apps/web/lib/routing/model-family-rules.test.ts`)

**1.1 Basic matching**

```
TEST: "prefix rule matches model ID"
  GIVEN: ModelFamilyRule { pattern: "gpt-5", matchType: "prefix", qualityTier: "frontier" }
  WHEN: classifyModel("gpt-5.4")
  THEN: returns { qualityTier: "frontier" }

TEST: "regex rule matches model ID"
  GIVEN: ModelFamilyRule { pattern: "claude.*opus", matchType: "regex", qualityTier: "frontier" }
  WHEN: classifyModel("claude-opus-4-6")
  THEN: returns { qualityTier: "frontier" }

TEST: "prefix match is case-insensitive"
  GIVEN: ModelFamilyRule { pattern: "GPT-5", matchType: "prefix" }
  WHEN: classifyModel("gpt-5.4")
  THEN: matches

TEST: "higher priority rule wins over lower"
  GIVEN:
    ModelFamilyRule { pattern: "gpt-4o-mini", priority: 200, qualityTier: "adequate" }
    ModelFamilyRule { pattern: "gpt-4o", priority: 100, qualityTier: "strong" }
  WHEN: classifyModel("gpt-4o-mini")
  THEN: returns { qualityTier: "adequate" } (priority 200 matched first)

TEST: "returns null for unknown model"
  GIVEN: no matching ModelFamilyRule
  WHEN: classifyModel("brand-new-model-v1")
  THEN: returns null

TEST: "returns dimension scores from matched rule"
  GIVEN: ModelFamilyRule { pattern: "claude.*opus", scores: { reasoning: 95, codegen: 92, ... } }
  WHEN: classifyModel("claude-opus-4-6")
  THEN: returns scores with reasoning=95, codegen=92

TEST: "returns modelClass and modalities from matched rule"
  GIVEN: ModelFamilyRule { pattern: "dall-e", modelClass: "image_gen", outputModalities: ["image"] }
  WHEN: classifyModel("dall-e-3")
  THEN: returns { modelClass: "image_gen", outputModalities: ["image"] }
```

**1.2 Fallback to hardcoded maps**

```
TEST: "falls back to FAMILY_TIERS when DB is empty"
  GIVEN: no ModelFamilyRule rows in DB
  WHEN: classifyModel("gpt-5.4") with fallback enabled
  THEN: returns { qualityTier: "frontier" } from hardcoded FAMILY_TIERS

TEST: "falls back to FAMILY_REGISTRY when DB is empty"
  GIVEN: no ModelFamilyRule rows in DB
  WHEN: getBaselineForModel("claude-opus-4-6") with fallback enabled
  THEN: returns baseline with reasoning=95 from hardcoded FAMILY_REGISTRY
```

### Integration Tests (`packages/db/src/__tests__/model-family-rules-seed.test.ts`)

**1.3 Seed and re-seed safety**

```
TEST: "seedModelFamilyRules inserts new rules"
  GIVEN: empty ModelFamilyRule table
  WHEN: seedModelFamilyRules() runs
  THEN: all entries from model-family-rules.json are inserted with source="seed"

TEST: "re-seed updates source=seed rows with improved data"
  GIVEN: existing rule { pattern: "gpt-5", source: "seed", scores: { reasoning: 85 } }
  WHEN: seedModelFamilyRules() runs with updated JSON { reasoning: 90 }
  THEN: scores updated to { reasoning: 90 }

TEST: "re-seed updates source=discovered rows"
  GIVEN: existing rule { pattern: "gpt-6", source: "discovered", scores: { reasoning: 80 } }
  WHEN: seedModelFamilyRules() runs with { reasoning: 92 }
  THEN: scores updated to { reasoning: 92 }

TEST: "re-seed NEVER overwrites source=admin rows"
  GIVEN: existing rule { pattern: "gpt-5", source: "admin", qualityTier: "strong" }
  WHEN: seedModelFamilyRules() runs with { qualityTier: "frontier" }
  THEN: row unchanged, still { qualityTier: "strong", source: "admin" }

TEST: "re-seed does not delete rules removed from JSON"
  GIVEN: existing rule { pattern: "retired-model", source: "seed" }
  WHEN: seedModelFamilyRules() runs, "retired-model" not in JSON
  THEN: row still exists (rules are additive-only)

TEST: "seed file contains all entries from FAMILY_TIERS and FAMILY_REGISTRY"
  GIVEN: model-family-rules.json loaded
  THEN: every prefix in FAMILY_TIERS has a corresponding entry
  AND: every regex pattern in FAMILY_REGISTRY has a corresponding entry
  AND: no duplicates on (pattern, matchType)
```

---

## Section 2: Async Classification Pipeline

### Unit Tests (`apps/web/lib/routing/classification-pipeline.test.ts`)

**2.1 Job creation**

```
TEST: "unmatched model during profiling creates a classification job"
  GIVEN: model "brand-new-v1" with no matching ModelFamilyRule
  WHEN: profileModelsInternal() processes this model
  THEN: ModelProfile created with qualityTier="adequate", qualityTierSource="auto"
  AND: ModelClassificationJob created with status="pending"

TEST: "matched model during profiling does NOT create a classification job"
  GIVEN: model "gpt-5.4" with matching ModelFamilyRule
  WHEN: profileModelsInternal() processes this model
  THEN: ModelProfile created with tier from rule
  AND: no ModelClassificationJob created

TEST: "re-discovery of a previously failed job resets retry count"
  GIVEN: ModelClassificationJob { modelId: "new-v1", status: "failed", retryCount: 3 }
  WHEN: profileModelsInternal() re-discovers "new-v1"
  THEN: job updated to { status: "pending", retryCount: 0 }
```

**2.2 Retry policy**

```
TEST: "failed job increments retryCount"
  GIVEN: job { status: "researching", retryCount: 0 }
  WHEN: classifyModelViaAgent() throws an error
  THEN: job updated to { status: "failed", retryCount: 1 }

TEST: "job with retryCount < 3 is eligible for retry"
  GIVEN: job { status: "failed", retryCount: 2 }
  WHEN: processClassificationJobs() runs
  THEN: job picked up and status set to "researching"

TEST: "job with retryCount >= 3 is NOT picked up for retry"
  GIVEN: job { status: "failed", retryCount: 3 }
  WHEN: processClassificationJobs() runs
  THEN: job NOT picked up (stays "failed")

TEST: "backoff is respected between retries"
  GIVEN: job { status: "failed", retryCount: 1, lastAttemptAt: 2 minutes ago }
  WHEN: processClassificationJobs() runs (backoff for retry 2 = 20 min)
  THEN: job NOT picked up yet (backoff not elapsed)

TEST: "backoff elapsed allows retry"
  GIVEN: job { status: "failed", retryCount: 1, lastAttemptAt: 25 minutes ago }
  WHEN: processClassificationJobs() runs
  THEN: job picked up for retry
```

**2.3 Classification result application**

```
TEST: "successful classification updates ModelProfile"
  GIVEN: job completes with { tier: "frontier", scores: {...}, modelClass: "chat" }
  WHEN: result is applied
  THEN: ModelProfile updated with qualityTier="frontier", qualityTierSource="discovered"
  AND: dimension scores updated

TEST: "successful classification creates ModelFamilyRule"
  GIVEN: job completes with { familyPrefix: "gpt-6", tier: "frontier" }
  AND: no existing rule for "gpt-6"
  WHEN: result is applied
  THEN: ModelFamilyRule created with { pattern: "gpt-6", source: "discovered" }

TEST: "classification does NOT overwrite admin family rule"
  GIVEN: existing ModelFamilyRule { pattern: "gpt-6", source: "admin", qualityTier: "strong" }
  WHEN: classification job resolves with { qualityTier: "frontier" }
  THEN: rule unchanged, still { qualityTier: "strong", source: "admin" }

TEST: "classification upgrades low-confidence discovered rule"
  GIVEN: existing ModelFamilyRule { pattern: "gpt-6", source: "discovered", confidence: "low" }
  WHEN: classification job resolves with confidence: "medium"
  THEN: rule updated with new scores and confidence: "medium"

TEST: "classification does NOT downgrade same-confidence discovered rule"
  GIVEN: existing ModelFamilyRule { pattern: "gpt-6", source: "discovered", confidence: "medium" }
  WHEN: new classification job resolves with confidence: "medium"
  THEN: rule unchanged (existing same-confidence data preserved)
```

**2.4 Concurrency**

```
TEST: "two concurrent processClassificationJobs() do not pick up the same job"
  GIVEN: 2 pending jobs
  WHEN: processClassificationJobs() invoked twice concurrently
  THEN: each invocation processes a different job (no duplicates)
```

---

## Section 3: Agent Capability Matching

### Unit Tests (`apps/web/lib/routing/capability-matching.test.ts`)

**3.1 Required capabilities filter**

```
TEST: "agent requiring toolUse excludes models without tool support"
  GIVEN: endpoint { capabilities: { toolUse: false } }
  AND: contract { requiredCapabilities: { toolUse: true } }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0 (hard exclude)

TEST: "agent requiring structuredOutput excludes models without it"
  GIVEN: endpoint { capabilities: { structuredOutput: false } }
  AND: contract { requiredCapabilities: { structuredOutput: true } }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0 (hard exclude)

TEST: "agent with empty requiredCapabilities accepts any model"
  GIVEN: endpoint { capabilities: { toolUse: false } }
  AND: contract { requiredCapabilities: {} }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (not excluded)

TEST: "agent with no requiredCapabilities field accepts any model"
  GIVEN: contract without requiredCapabilities field
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (backward compatible)
```

**3.2 Model class filter**

```
TEST: "requiredModelClass=chat excludes image_gen models"
  GIVEN: endpoint { modelClass: "image_gen" }
  AND: contract { requiredModelClass: "chat" }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0

TEST: "requiredModelClass=chat INCLUDES reasoning models"
  GIVEN: endpoint { modelClass: "reasoning" }
  AND: contract { requiredModelClass: "chat" }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (reasoning is a specialization of chat)

TEST: "requiredModelClass=chat INCLUDES code models"
  GIVEN: endpoint { modelClass: "code" }
  AND: contract { requiredModelClass: "chat" }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (code is a specialization of chat)

TEST: "requiredModelClass=chat excludes embedding models"
  GIVEN: endpoint { modelClass: "embedding" }
  AND: contract { requiredModelClass: "chat" }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0

TEST: "requiredModelClass=chat excludes speech models"
  GIVEN: endpoint { modelClass: "speech" }
  AND: contract { requiredModelClass: "chat" }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0

TEST: "requiredModelClass=null accepts any model class"
  GIVEN: endpoint { modelClass: "image_gen" }
  AND: contract { requiredModelClass: null }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0
```

**3.3 Modality filter**

```
TEST: "requiredModalities input=text excludes audio-only input models"
  GIVEN: endpoint { inputModalities: ["audio"] }
  AND: contract { requiredModalities: { input: ["text"] } }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns 0

TEST: "requiredModalities input=text,image accepts multimodal models"
  GIVEN: endpoint { inputModalities: ["text", "image", "audio"] }
  AND: contract { requiredModalities: { input: ["text", "image"] } }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (endpoint has all required modalities)

TEST: "null requiredModalities accepts any model"
  GIVEN: contract { requiredModalities: null }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0
```

**3.4 Preferred dimensions (soft boost)**

```
TEST: "preferred dimensions boost ranking score for models meeting threshold"
  GIVEN:
    endpointA { codegen: 90 }
    endpointB { codegen: 60 }
  AND: contract { preferredDimensions: { codegen: 85 } }
  WHEN: rankByCostPerSuccess([A, B], contract)
  THEN: A ranks higher than B (boosted by meeting preferred threshold)

TEST: "preferred dimensions do NOT hard-exclude models below threshold"
  GIVEN: endpoint { codegen: 60 }
  AND: contract { preferredDimensions: { codegen: 85 } }
  WHEN: estimateSuccessProbability(endpoint, contract)
  THEN: returns > 0 (soft preference, not hard filter)
```

### Integration Tests (`packages/db/src/__tests__/agent-model-config-seed.test.ts`)

**3.5 Seed safety for AgentModelConfig**

```
TEST: "seed sets requiredModelClass=chat for agent rows with configuredById=NULL"
  GIVEN: existing row { agentId: "coo", configuredById: null, requiredModelClass: null }
  WHEN: seedAgentModelDefaults() runs
  THEN: row updated with requiredModelClass="chat", requiredCapabilities={ toolUse: true }

TEST: "seed does NOT overwrite admin-configured rows"
  GIVEN: existing row { agentId: "coo", configuredById: "user-123", requiredModelClass: null }
  WHEN: seedAgentModelDefaults() runs
  THEN: row unchanged

TEST: "migration default for requiredModelClass is NULL (not chat)"
  GIVEN: existing AgentModelConfig row before migration
  WHEN: migration runs
  THEN: requiredModelClass = NULL (backward compatible, no filtering)
```

---

## Section 4: Contribution Feedback

### Unit Tests (`apps/web/lib/routing/contribution-feedback.test.ts`)

**4.1 Contribution mode gate**

```
TEST: "fork_only mode does not create contribution artifact"
  GIVEN: PlatformDevConfig { contributionMode: "fork_only" }
  WHEN: classification job completes
  THEN: no backlog item created, no PR proposed

TEST: "selective mode creates backlog item for admin review"
  GIVEN: PlatformDevConfig { contributionMode: "selective" }
  WHEN: classification job completes for "gpt-6" as "frontier"
  THEN: BacklogItem created with title containing "gpt-6" and "frontier"
  AND: no PR proposed yet (awaits admin approval)

TEST: "contribute_all mode auto-proposes PR"
  GIVEN: PlatformDevConfig { contributionMode: "contribute_all" }
  WHEN: classification job completes
  THEN: propose_file_change called with patch to model-family-rules.json

TEST: "contribution artifact includes research provenance"
  GIVEN: classification job with researchSummary and sourceUrls
  WHEN: contribution JSON is generated
  THEN: JSON includes notes field with summary
  AND: JSON includes sourceUrls for verification
```

---

## Section 5: E2E — Full Stack Validation

### Playwright Tests (`e2e/ep-inf-012b-classification.spec.ts`)

**5.1 Agent routing with capability matching**

```
TEST: "build-specialist routes to a tool-capable model only"
  GIVEN: platform running with multiple active models (some without tool support)
  WHEN: send "Create a hello world feature" on /build
  THEN: response received (no error)
  AND: portal logs show selected model has toolUse=true

TEST: "ea-architect routes to a model with structured output"
  GIVEN: platform running
  WHEN: send "What views exist?" on /ea
  THEN: response received
  AND: portal logs show selected model has structuredOutput=true

TEST: "onboarding-coo routes to basic tier model"
  GIVEN: platform running
  WHEN: send "Help me set up" on /setup
  THEN: response received
  AND: portal logs show model is basic or adequate tier
```

**5.2 Model-assignment admin page**

```
TEST: "model-assignment page shows all 11 agents with seeded tiers"
  WHEN: navigate to /platform/ai/model-assignment
  THEN: table shows 11 rows
  AND: build-specialist shows "Frontier"
  AND: coo shows "Strong"
  AND: ops-coordinator shows "Adequate"
  AND: onboarding-coo shows "Basic"

TEST: "changing agent tier persists and takes effect"
  WHEN: change ops-coordinator tier to "strong" and click Save
  THEN: "Saved" confirmation appears
  AND: reload page shows ops-coordinator at "Strong"
  AND: subsequent message on /ops routes to a strong-tier model
```

**5.3 Provider discovery with unknown model**

```
TEST: "discovery of unknown model creates provisional profile and classification job"
  GIVEN: provider configured with a model not in ModelFamilyRule
  WHEN: discovery/sync runs
  THEN: ModelProfile created with qualityTier="adequate"
  AND: ModelClassificationJob created with status="pending"
  AND: no error on the provider detail page
```

---

## Test Data Requirements

### Fixtures needed:

1. **Mock ModelFamilyRule set** — subset of seed rules for fast unit tests
2. **Mock EndpointManifest factory** — extend existing `makeEndpoint()` in cost-ranking.test.ts with modelClass, capabilities, modalities
3. **Mock RequestContract factory** — extend existing `makeContract()` with requiredCapabilities, requiredModelClass, requiredModalities, preferredDimensions
4. **Test provider with known models** — for e2e: ensure at least one model per class (chat, image_gen, embedding) is discoverable

### Environment:

- Unit tests: no DB, no network. Pure function testing with mocked data.
- Integration tests: test DB (Prisma with SQLite or test PostgreSQL). Real seed functions against real schema.
- E2E tests: running platform at localhost:3000 with admin credentials from D:\DPF\.env. Requires `MSYS_NO_PATHCONV=1` and `DPF_ADMIN_PASSWORD` env var.

---

## Acceptance Criteria Summary

The implementation is complete when ALL of the following pass:

- [ ] All ModelFamilyRule unit tests pass (matching, priority, fallback)
- [ ] All re-seed safety tests pass (source-aware merge, admin rows never overwritten)
- [ ] All capability matching unit tests pass (toolUse, modelClass, modalities, preferredDimensions)
- [ ] Reasoning and code models are NOT excluded when agent requires "chat"
- [ ] Classification pipeline creates jobs for unknown models, respects retry policy
- [ ] Classification results create ModelFamilyRule entries (source-aware, no admin overwrite)
- [ ] Contribution feedback respects all three contribution modes
- [ ] E2E: all 11 agents route successfully on a running platform
- [ ] E2E: model-assignment page shows correct seeded tiers
- [ ] E2E: admin can change an agent's tier and it takes effect
- [ ] Migration default for requiredModelClass is NULL (not "chat")
- [ ] Existing platform installations upgrade without behavior change

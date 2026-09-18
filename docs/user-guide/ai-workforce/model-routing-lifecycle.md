---
title: "Model Routing & Lifecycle"
area: ai-workforce
order: 3
---

## How Models Enter the System

Models reach the routing pool through two paths: static seed data at install time, and dynamic discovery at runtime.

### Path 1: Static Seed (Install Time)

During container startup, `docker-entrypoint.sh` runs the following sequence:

```
[1/5] prisma migrate deploy           Schema and tables
[2/5] sync-provider-registry.ts       Providers from providers-registry.json
[3/5] seed.ts                         Agents, roles, model profiles, agent routing config
[4/5] detect-hardware.ts              Hardware profile for local AI
[5/5] source volume bootstrap          Sandbox workspace git init
```

**Step 2** syncs the provider registry from `packages/db/data/providers-registry.json`. This creates or updates `ModelProvider` rows with connection details, auth methods, pricing, and `modelRestrictions` (an allowlist of model ID patterns the provider credential can access). Provider status and credentials are preserved on re-sync.

**Step 3** seeds model profiles from `packages/db/data/model-profiles.json`. These are pre-evaluated profiles with hand-tuned dimension scores (codegen, reasoning, toolFidelity, etc.) and `profileSource: "evaluated"`. Only models known to work with the default credential tier are included. The seed also:
- Ensures Haiku 4.5 is set to `active` (Haiku 3.0 to `degraded`)
- Creates `AgentModelConfig` rows with default tier and budget settings for each agent
- Leaves provider and model pins empty so routing can adapt to the eligible pool

Pre-evaluated profiles are protected from being overwritten by dynamic discovery.

### Path 2: Dynamic Discovery (Runtime)

**Local models (automatic):** The local LLM provider (Docker Model Runner / Ollama) is checked on every page load of the AI Workforce providers page and during first-run bootstrap. If the provider is reachable, the platform calls its `/v1/models` endpoint, creates `DiscoveredModel` rows, and profiles them automatically using quality tier baselines from `FAMILY_TIERS`.

**Cloud providers (manual):** Cloud provider models are discovered when an admin clicks "Discover Models" on the provider detail form. This calls the provider's model list API (e.g., Anthropic `/v1/models`), creates discovery records, then profiles each model. Models that don't match the provider's `modelRestrictions` allowlist are automatically retired with the reason "Model not accessible with provider credential type."

There is currently no scheduled automatic discovery for cloud providers that support normal model listing APIs. If a provider releases a new model family, it will not appear until an admin manually triggers discovery.

Non-discoverable providers are handled differently. For providers such as Codex that cannot use `/v1/models`, the platform uses a curated known-model catalog plus a scheduled catalog reconciliation pass. The reconciler checks official provider documentation for candidate model IDs and deprecation signals, reseeds the runtime model catalog from the curated entries, and reports any new official candidates that are not yet approved for routing. Documentation makes a model a candidate; runtime probe and seeded metadata make it routable.

## Quality Tiers

Every model is assigned a quality tier based on its model ID prefix. The tier system replaces opaque 0-100 scores as the primary configuration surface for admins.

| Tier | Examples | Use Case |
|------|----------|----------|
| **Frontier** | Claude Opus 4.x, Claude Sonnet 4.x, GPT-5, o1/o3/o4 | Build Studio, complex code generation, multi-step tool orchestration |
| **Strong** | Claude Haiku 4.x, Gemini 2.5 Pro, GPT-4o | Admin tasks, compliance, finance, most agent work |
| **Adequate** | Claude 3 Haiku, Gemini 2.5 Flash, GPT-4o-mini | Basic conversation, simple queries |
| **Basic** | Llama, Phi, Qwen, Mistral, DeepSeek (local models) | Local-only, no cloud cost, limited capabilities |

Tier assignment uses longest-prefix matching against the model ID. For example, `claude-haiku-4-5-20251001` matches the prefix `claude-haiku-4` and is assigned the `strong` tier.

Each tier maps to baseline dimension scores and minimum thresholds:

| Tier | Baseline Scores | Minimum Thresholds (for agent config) |
|------|----------------|--------------------------------------|
| Frontier | codegen: 90, toolFidelity: 90, reasoning: 90 | codegen >= 85, toolFidelity >= 85, reasoning >= 85 |
| Strong | codegen: 75, toolFidelity: 75, reasoning: 75 | codegen >= 70, toolFidelity >= 70, reasoning >= 70 |
| Adequate | codegen: 55, toolFidelity: 55, reasoning: 55 | codegen >= 50, toolFidelity >= 50, reasoning >= 50 |
| Basic | codegen: 35, toolFidelity: 35, reasoning: 35 | No minimums |

Pre-evaluated profiles (from `model-profiles.json`) may have scores that differ from the tier baselines. These manually tuned scores are more accurate and are preserved across discovery cycles.

## Agent Model Configuration

Each agent has an `AgentModelConfig` row that controls which models it can use:

| Field | Purpose |
|-------|---------|
| `minimumTier` | The lowest quality tier the agent will accept (e.g., "frontier" for build-specialist) |
| `budgetClass` | Cost strategy: `minimize_cost`, `balanced`, or `quality_first` |
| `pinnedProviderId` | Exceptional preference override for a specific eligible provider (optional) |
| `pinnedModelId` | Exceptional preference override for a specific eligible model (optional) |

Default configurations are seeded during installation. Admins can override them via
the platform UI. The normal posture is unpinned: seed and first-run bootstrap leave
pins empty, and startup emits a `[pin-audit]` warning when a persisted pin exists.
Use a pin only when a provider/model dependency is intentional and documented; use
tier, capability, sensitivity, residency, and budget controls for normal routing.
The seed respects existing rows -- if an admin has already configured an agent, the
seed will not overwrite it.

### Default Agent Tiers

| Agent | Minimum Tier | Budget | Pinned To |
|-------|-------------|--------|-----------|
| build-specialist | strong | quality_first | (auto) |
| coo | strong | balanced | (auto) |
| platform-engineer | strong | balanced | (auto) |
| admin-assistant | strong | balanced | (auto) |
| ea-architect | adequate | balanced | (auto) |
| onboarding-coo | basic | minimize_cost | (auto) |

## How Routing Selects a Model

When an agent needs to call an LLM, the routing pipeline runs in this order:

1. **Load AgentModelConfig** for the agent. If a DB row exists, use its tier and budget. Otherwise, fall back to code defaults.
2. **Convert tier to minimum dimensions.** For example, `frontier` becomes `{ codegen: 85, toolFidelity: 85, reasoning: 85 }`.
3. **Load all endpoint manifests.** Query `ModelProfile` where `modelStatus` is `active` or `degraded`, joined with `ModelProvider` where `status` is `active` or `degraded`.
4. **Screen the task payload before dispatch.** The provider setup facts are not a one-time approval for every future request. Before an LLM call leaves the install, DPF screens the actual system prompt, messages, tool-call arguments, and tool results for sensitive data classes such as customer and employee records, financial and clinical data, student/youth records, legal privilege, criminal-justice information, safety cases, credentials, source code, regulated decisions, and unknown governed data. [Sensitive-data policy packs](./sensitive-data-policy-packs.md) compile every detected class into the shared data-policy engine; there is no second vertical policy authority. Classification requires value-shaped evidence or a governed field/path hint: ordinary instruction prose such as “let me know,” role vocabulary such as “employee,” and static schema vocabulary such as a parameter named `password` do not prove that source code, an employee record, or a password value is present. Static tool declarations remain part of the tamper-evident payload hash and are revalidated before dispatch. The screen records only hashes, data classes, pack/policy versions, and transformation status; it does not store raw prompt content or detected secret values.
5. **Compile data-policy constraints into the request.** If the payload is public or ordinary internal work, the low-cost eligible providers can remain available. If the payload contains confidential, restricted, or unknown governed data, the data-governance decision can narrow allowed providers, deny external services, require local/private routing, require masking or tokenization, or stop for human review. Provider cost, model quality, capacity, and pins cannot loosen that result.
6. **Hard filter (V2 pipeline).** Exclude models that fail any of:
   - Provider is outside `RequestContract.allowedProviders`
   - Provider is present in `RequestContract.deniedProviders` (deny wins if both lists contain it)
   - Status not active/degraded
   - Model class not `chat` or `reasoning`
   - Sensitivity clearance doesn't cover the request
   - Missing required capability (e.g., tool use)
   - Any dimension score below the minimum threshold

   preferred endpoint replaces the cost/quality winner only when it remains in the
   eligible candidate set. A pin cannot override provider allow/deny, sensitivity,
   residency, capability, model-class, status, or other hard exclusions. If its
   target is unavailable or excluded, routing records a warning and keeps the
   V2-selected route.

7. **Revalidate at the dispatch seam.** Immediately before every provider attempt—including retries and fallbacks—DPF screens the actual payload again and compares its safe hash, policy outcome, obligations, destination, and asset/classification/authority versions with the route-time receipt. If anything changed, the call stops and must be routed again. A tool-stripping reroute receives a new receipt for the reduced payload rather than reusing evidence for content that is no longer being sent.

Provider allow/deny constraints are request-level hard policy, distinct from the provider registry's `modelRestrictions` discovery allowlist. An explicitly empty `allowedProviders` list means no provider is eligible; routing returns no endpoint rather than treating the empty list as “allow any.” Cost, quality, provider health, capacity, and pin preferences only rank the providers that remain after the hard filter.

### The work changes which providers are eligible

DPF evaluates the work being done, not only the company and provider name. The activity contract can identify governed data assets and fields, the approved processing purpose, and a bounded workload class. The company archetype and its current value-stream stage supply conservative defaults only when governed activity detail is not already available.

That means one connected provider can be available for public marketing copy and unavailable for patient, student, financial-customer, public-sector, source-code, or credential work in the same company. Governed data classification always wins over an archetype or activity default. Missing or conflicting classification on high-risk work requires review and cannot be relaxed by cost, model quality, occupation, or a provider pin.

An employee's occupation focuses the explanations and recommendations they see. It does not grant data access, expand coworker or tool authority, or make a blocked provider eligible.

When a caller declares that sensitive details are replaceable, the PDP can authorize DPF to omit, redact, partially reveal, tokenize, or aggregate matched values before contract inference, preview construction, memory projection, tool-result serialization, and provider dispatch. The transformed payload is screened again, while its receipt keeps the source data classes, protection state, and current policy versions. Stable tokens have an opaque, short-lived rehydration handle; the token map stays only inside the controlled runtime and is never written to route logs, memory, previews, vector storage, receipts, or exception text.

If the exact value is material to correctness—or the classifier cannot prove a safe transform—DPF does not mask around the restriction. The task remains on an eligible internal, local, or enterprise route, or is blocked with a short explanation and next action. Response rehydration remains masked until the separate actor, role, purpose, and surface authorization gate approves it.

### Evidence belongs to the connected account

Provider claims are not vendor-wide. A business agreement, BAA, DPA, no-training term, regional entitlement, or router allowlist applies only to the connected account it was reviewed for. It does not make a personal API key, an individual subscription, or a second tenant for the same vendor suitable.

Open **Platform → AI Operations → Providers & Routing**, choose a provider, and review **Provider trust evidence**. Each claim shows whether its evidence is current, missing, expired, rejected, conflicting, or replaced, along with its age, expiry, and safest next action. Operator declarations expire after 90 days unless stronger reviewed evidence replaces them. Expiry removes the claim from restricted-work eligibility immediately; it does not unnecessarily block separately governed public work.

Every governed route may carry a privacy-safe suitability receipt. The receipt records policy and input versions, the selected provider and any router-selected underlying provider, the connection's channel/account posture, exclusions, obligations, and explanation codes. It deliberately excludes prompts, messages, credentials, vendor account identifiers, organization identifiers, evidence documents, and free-text explanations.

For activity-governed work, the same suitability projection used during provider setup is bound into the live `RequestContract` before `routeEndpointV2` selects a model. Existing operator restrictions can only become narrower: provider allowlists intersect, denials accumulate, and the stricter residency rule wins. A preferred provider/model, cost tuning, model health, or fallback cannot restore a connection removed by this gate.

Open the route decision on the provider detail page or **Platform → Audit → Route Decisions** to see **Provider suitability evidence**. It shows the hashed connection reference, execution channel, account class, compiler/policy versions, processing-region obligation, and explanation codes. Workload-class detail is aggregated only after at least five similar decisions; smaller cohorts remain hidden.

### Continuous review and rollout

DPF watches the provider catalog, account attestations, contract and regional-entitlement expiry, conflicting/rejected evidence, repeated route failures, and differences between the observed connection and its attested channel, account class, plan, endpoint, or credential kind. These observations create an owner attention item with a direct repair link. Expired, rejected, or mismatched evidence continues to fail closed for restricted work.

Telemetry is advisory. It may lower a recommendation, request review, or tune ordering among connections that are already allowed. It cannot override a data-policy decision, contract boundary, residency requirement, operator denial, or missing account evidence.

The rollout is cumulative and ordered: compiler shadow → admin preview → onboarding recommendation → selected regulated/technical verticals → restricted OpenRouter → evidence enforcement → continuous tuning. The default installation enforces account evidence while leaving tuning advisory. Dental/healthcare, retail, credit-union, training/education, and software-platform journeys use the same work-context derivation and compiler; there is no vertical-specific policy engine.

## How Routing Adapts Over Time

| Event | What Happens |
|-------|-------------|
| Admin connects a new provider | Provider goes `active`. Admin must click "Discover Models" to populate model profiles. |
| Admin clicks "Discover Models" | Calls provider's model list API, creates discovery records, profiles using quality tiers. |
| Model restricted by `modelRestrictions` | Profiling auto-retires it with reason "Model not accessible with provider credential type." |
| New model pulled into Docker Model Runner | Discovered automatically on next providers page load. |
| Model returns inference errors | Fallback chain tries the next model. After repeated failures, model status degrades to `retired` — unless the error looks like infrastructure/capacity (timeouts, connection failures, a busy engine) or a credential gap, or unless retiring would strand a sensitivity class (see below). |
| Model times out under load | Not retired. Capacity and admission timeouts describe a busy engine, not a broken model — a local engine holding a large model can exceed its admission budget from load or a cold weight-load alone. |
| Retiring would strand a sensitivity class | Not retired. The model is marked `degraded` instead and a warning names the exposed class. |
| Model disappears from provider API | After 2+ discovery cycles without seeing it, model is retired. |
| Pre-evaluated profile re-profiled | Metadata is updated but dimension scores are NOT overwritten (`profileSource: "evaluated"` is protected). |
| Admin overrides AgentModelConfig | Takes effect immediately. Seed will not overwrite admin-configured rows on next restart. |
| Provider evidence expires or is rejected | The affected claim stops authorizing restricted work; the provider detail page shows the repair action. |
| Provider evidence is replaced | The prior revision remains an audit record but no longer authorizes work. |
| Provider posture drifts from its attestation | The owner receives an attention item; restricted routing stays blocked until the posture or evidence is reviewed. |
| A workload cohort is small | Provider/model totals remain available, but workload-class detail stays hidden until the privacy threshold is met. |

## Provider-Specific Notes

### Anthropic (OAuth Subscription)

The `anthropic-sub` provider uses OAuth authorization code flow. The subscription tier determines which models are accessible via the API:

- **Haiku models**: Generally available on all subscription tiers
- **Sonnet / Opus models**: Require Team or Enterprise subscription tiers for API access

The `modelRestrictions` field in `providers-registry.json` is set to `["claude-haiku-*", "claude-3-haiku-*"]` to reflect this. Models discovered outside this allowlist are automatically retired during profiling.

If you have a Team or Enterprise subscription with Sonnet/Opus API access, update the restrictions via the admin UI or directly in the database.

### ChatGPT (OpenAI Subscription)

The ChatGPT provider uses Server-Sent Events (SSE) for the Responses API. Known issue: some models (e.g., `gpt-5.4`) may return empty responses through the SSE adapter. The quality gate catches these and returns a fallback response. If you see "I wasn't able to help with that" messages consistently, check the portal logs for `[quality-gate] Response too short` entries.

### Docker Model Runner (Local)

Local models are automatically discovered and profiled. They are assigned the `basic` quality tier by default, which means they will only be selected for agents configured with `minimumTier: "basic"` (e.g., the onboarding assistant). To use local models more broadly, adjust agent tiers downward or improve local model dimension scores via profiling.

## Troubleshooting

**All coworker responses say "I wasn't able to help":**
- Check portal logs: `docker logs dpf-portal-1 | grep quality-gate`
- If you see `Response too short (0 chars)`, the selected model is returning empty responses
- Check which provider is being selected: `docker logs dpf-portal-1 | grep agentic-loop`
- Verify the provider has valid credentials and the model is accessible

**Agent uses wrong model:**
- Check `AgentModelConfig` in the database
- `pinnedProviderId` / `pinnedModelId` are exceptional preferences within the
  request's hard provider, residency, sensitivity, status, model-class, and
  capability constraints; they are empty by default
- If no pin is set, routing selects based on dimension scores and budget class

**Models missing after connecting a provider:**
- Discovery is manual for cloud providers. Go to AI Workforce > Providers > select the provider > click "Discover Models"
- After discovery, click "Profile Models" to assign quality tiers and dimension scores
- Models outside the provider's `modelRestrictions` allowlist will be automatically retired

**Every request in one sensitivity class fails with "No AI model can handle this request right now":**
- That message names cloud sign-in as the likely cause, but it is emitted whenever routing finds no eligible endpoint — for any reason. Check the router's own verdict before re-authenticating anything: `docker logs dpf-portal-1 | grep -A25 "no eligible endpoints"` prints the contract inputs and the rejection reason for every candidate.
- Routing filters candidates on `retiredAt IS NULL`, **not** on `modelStatus`. A profile can therefore read `active` in the admin UI and still be invisible to routing. Compare the router's excluded-endpoint count against the profiles the manifest query would return — an endpoint missing from the rejection list never became a candidate at all.
- Auto-retirement will not strand a class on its own (see the lifecycle table), but a row stranded before that guard existed is healed at boot.

**One coworker conversation got slower and less capable, but others are fine:**
- The conversation is being kept on a local model. Every message in a thread is re-read on each reply, so something written earlier keeps counting — even when it has nothing to do with what you are asking now. A single mention of a governed subject (payroll, an invoice, a customer's contact details) can hold a whole thread there.
- The coworker panel says so directly, under its header: it names what kind of information is involved and whether the cause is earlier in the conversation or in what you just asked.
- When the cause is earlier, the notice offers **Continue without the earlier messages**. This keeps the conversation and everything you can read in it; the coworker simply stops re-reading the earlier part, so it is no longer sent to a model and normal routing resumes. It applies to the summary and recall of those messages too, not only the messages themselves.
- When the cause is what you are currently discussing, no such option appears — setting the past aside would not change anything while the same subject is live, and the notice says so rather than offering a control that would not work.
- If the cause is the coworker's own setup (its instructions, tools, or connected data) rather than anything in the conversation, the notice says that too. Nothing you write will change it, and a new conversation carries the same setup over.
- This is working as intended, not a fault: information that is sent to a model really does leave this machine, so DPF keeps that work local. The remedy narrows what is sent — it never relaxes the rule.

**A provider is active but restricted work is blocked:**
- Open the provider detail page and review **Provider trust evidence**.
- Confirm the evidence is attached to the same connected account that will execute the work.
- Follow the displayed next action for missing, expired, rejected, conflicting, or replaced evidence.
- Do not copy evidence from another key, subscription, tenant, or provider account; DPF will not transfer those rights.

**Local model not appearing:**
- Visit the AI Workforce providers page to trigger automatic discovery
- Verify Docker Model Runner is running: `docker model list` should return available models
- Check that the local provider status is `active` (not `unconfigured`) — the provider ID in the database is `ollama` for historical reasons, even when using Docker Model Runner

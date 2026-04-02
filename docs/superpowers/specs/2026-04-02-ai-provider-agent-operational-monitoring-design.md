# AI Provider & Agent Operational Monitoring

**Date:** 2026-04-02
**Status:** Draft
**Epic:** EP-FULL-OBS (extends platform operational health monitoring)
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md` (Prometheus/Grafana stack, metrics registry, alert pipeline)
- `apps/web/lib/routing/pipeline-v2.ts` (routing pipeline, failover chain)
- `apps/web/lib/routing/rate-tracker.ts` (in-memory rate tracking)
- `apps/web/lib/routing/fallback.ts` (fallback dispatch, rate-limit recovery)
- `apps/web/lib/inference/ai-provider-priority.ts` (priority ranking, auto-disable)
- `apps/web/lib/govern/provider-oauth.ts` (OAuth token refresh, credential management)

**IT4IT Alignment:** SS5.7 Operate — Detect to Correct. Extends infrastructure monitoring to the AI inference layer, which is now a critical platform dependency. Provider failures, credential expiry, and rate exhaustion are operational events that require the same detect-diagnose-correct flow as container or database outages.

## Problem Statement

The platform's AI provider infrastructure has grown from a single local model to a multi-provider routing pipeline with OAuth tokens, API keys, rate limits, failover chains, and per-task quality scoring. But the operational visibility into this infrastructure is near-zero:

1. **Credential failures are silent.** OAuth tokens expire, API keys are rotated externally, and the platform discovers this only when a user's request fails mid-conversation. The `CredentialEntry.tokenExpiresAt` field exists but nothing checks it proactively.

2. **Provider failures don't update provider health.** The `ModelProvider.recentFailureRate` field exists but is **never written to**. A provider could fail 100% of requests and its status stays `"active"` in the routing pipeline.

3. **Rate limits are tracked in-memory only.** The rate tracker learns from response headers and manages sliding windows, but this data evaporates on restart. There's no persistent history and no alerting.

4. **No proactive health checks for remote providers.** Only Ollama gets health checks (via `/v1/models`). Anthropic, OpenAI, Azure, Gemini — all fly blind until a user request hits them.

5. **Agent quality degradation has no operational signal.** The `EndpointTaskPerformance` model tracks scores and detects regressions, but these aren't surfaced as operational alerts. An agent could silently degrade for days.

6. **No credential lifecycle management.** No warning before API keys expire. No tracking of when credentials were last rotated. No audit trail of credential changes.

**The risk:** As more providers are added and agents become critical business tools, any of these silent failures can cascade. A provider auth failure during an active Build Studio session or a portfolio analysis could lose user work with no explanation.

---

## Design Summary

Three layers of AI provider monitoring, each building on the existing infrastructure:

1. **Prometheus Metrics & Alerts** — new metrics for credential health, provider status, rate utilization, and routing decisions. Alert rules that fire into the existing `PortfolioQualityIssue` pipeline.

2. **Provider Health Probes** — scheduled lightweight checks for every active provider, analogous to the container health probes but for API endpoints. Detect outages before users hit them.

3. **Automatic Status Management** — close the loop between failure detection and routing. Update `recentFailureRate`, degrade providers automatically, refresh credentials proactively.

### Key Principles

- **Close the feedback loop** — failure data already exists in Prometheus counters; wire it back to the `ModelProvider` model so routing adapts automatically.
- **Proactive, not reactive** — detect credential expiry, rate exhaustion, and provider degradation before users are affected.
- **No new infrastructure** — uses the existing Prometheus/Grafana stack, `/api/metrics` endpoint, and alert webhook pipeline.
- **Provider-agnostic** — monitoring works the same for local (Ollama, Model Runner), cloud (Anthropic, OpenAI), and custom providers.

---

## Section 1: New Prometheus Metrics

### 1.1 Credential Health Metrics

Add to `lib/operate/metrics.ts`:

```typescript
// Credential expiry countdown — set during token refresh and credential checks
export const credentialExpirySeconds = new Gauge({
  name: "dpf_credential_expiry_seconds",
  help: "Seconds until credential expires (negative = already expired)",
  labelNames: ["provider", "auth_method"] as const,
  registers: [metricsRegistry],
});

// Credential refresh attempts
export const credentialRefreshTotal = new Counter({
  name: "dpf_credential_refresh_total",
  help: "Credential refresh attempts",
  labelNames: ["provider", "status"] as const, // status: success | failure
  registers: [metricsRegistry],
});
```

### 1.2 Provider Status Metrics

```typescript
// Provider operational status (1=active, 0.7=degraded, 0=inactive/disabled)
export const providerStatus = new Gauge({
  name: "dpf_provider_status",
  help: "Provider operational status",
  labelNames: ["provider", "status_label"] as const,
  registers: [metricsRegistry],
});

// Provider failure rate (rolling)
export const providerFailureRate = new Gauge({
  name: "dpf_provider_failure_rate",
  help: "Rolling failure rate for provider (0-1)",
  labelNames: ["provider"] as const,
  registers: [metricsRegistry],
});

// Provider health probe results
export const providerHealthProbe = new Gauge({
  name: "dpf_provider_health_probe",
  help: "Health probe result (1=healthy, 0=unhealthy)",
  labelNames: ["provider"] as const,
  registers: [metricsRegistry],
});

export const providerHealthProbeLatency = new Histogram({
  name: "dpf_provider_health_probe_duration_seconds",
  help: "Health probe latency",
  labelNames: ["provider"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});
```

### 1.3 Rate Limit Metrics

```typescript
// Rate limit utilization (0-100%)
export const rateLimitUtilization = new Gauge({
  name: "dpf_rate_limit_utilization_percent",
  help: "Rate limit utilization percentage",
  labelNames: ["provider", "model", "dimension"] as const, // dimension: rpm | tpm | rpd
  registers: [metricsRegistry],
});

// Rate limit exhaustion events
export const rateLimitExhausted = new Counter({
  name: "dpf_rate_limit_exhausted_total",
  help: "Rate limit exhaustion events",
  labelNames: ["provider", "model"] as const,
  registers: [metricsRegistry],
});
```

### 1.4 Routing Decision Metrics

```typescript
// Routing decisions by outcome
export const routingDecisions = new Counter({
  name: "dpf_routing_decisions_total",
  help: "Routing pipeline decisions",
  labelNames: ["outcome"] as const, // outcome: selected | fallback | no_candidates | error
  registers: [metricsRegistry],
});

// Fallback chain usage
export const fallbackUsage = new Counter({
  name: "dpf_fallback_usage_total",
  help: "Fallback chain activations",
  labelNames: ["provider", "reason"] as const, // reason: error | rate_limit | timeout
  registers: [metricsRegistry],
});
```

### 1.5 Agent Performance Metrics

```typescript
// Agent task quality score (current average)
export const agentQualityScore = new Gauge({
  name: "dpf_agent_quality_score",
  help: "Current average quality score for agent task type",
  labelNames: ["endpoint", "task_type", "phase"] as const, // phase: learning | practicing | innate
  registers: [metricsRegistry],
});

// Agent regression events
export const agentRegressions = new Counter({
  name: "dpf_agent_regressions_total",
  help: "Agent quality regression events",
  labelNames: ["endpoint", "task_type"] as const,
  registers: [metricsRegistry],
});
```

---

## Section 2: Alert Rules

Add to `monitoring/prometheus/alerts.yml`:

```yaml
  - name: dpf_ai_providers
    rules:
      # ─── Credential Alerts ─────────────────────────────────
      - alert: CredentialExpiringSoon
        expr: dpf_credential_expiry_seconds > 0 and dpf_credential_expiry_seconds < 86400
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }} credential expires in {{ $value | humanizeDuration }}"

      - alert: CredentialExpired
        expr: dpf_credential_expiry_seconds < 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.provider }} credential has expired"

      - alert: CredentialRefreshFailing
        expr: rate(dpf_credential_refresh_total{status="failure"}[15m]) > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.provider }} credential refresh is failing"

      # ─── Provider Health ───────────────────────────────────
      - alert: ProviderAuthFailing
        expr: rate(dpf_ai_inference_errors_total{error_type="auth"}[5m]) > 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.provider }} authentication failing -- check credentials"

      - alert: ProviderHighFailureRate
        expr: dpf_provider_failure_rate > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }} failure rate above 50%"

      - alert: ProviderDown
        expr: dpf_provider_health_probe == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "{{ $labels.provider }} health probe failing -- provider may be down"

      # ─── Rate Limits ───────────────────────────────────────
      - alert: RateLimitApproaching
        expr: dpf_rate_limit_utilization_percent > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }}/{{ $labels.model }} rate limit at {{ $value }}%"

      - alert: RateLimitExhausted
        expr: increase(dpf_rate_limit_exhausted_total[5m]) > 0
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.provider }}/{{ $labels.model }} rate limit exhausted"

      # ─── Agent Quality ─────────────────────────────────────
      - alert: AgentQualityRegression
        expr: increase(dpf_agent_regressions_total[1h]) > 0
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.endpoint }} quality regressed on {{ $labels.task_type }}"

      - alert: AgentQualityLow
        expr: dpf_agent_quality_score < 2.5
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.endpoint }}/{{ $labels.task_type }} quality score below 2.5"
```

---

## Section 3: Provider Health Probes

### 3.1 Probe Strategy

Each active provider gets a lightweight health probe that tests reachability without consuming inference tokens:

| Provider Type | Probe Method | Endpoint | Expected Response |
|--------------|-------------|----------|-------------------|
| OpenAI-compatible | GET `/v1/models` | Provider's base URL | 200 with model list |
| Anthropic (direct) | GET `/v1/models` | `api.anthropic.com` | 200 (or 401 = reachable but auth needed) |
| Anthropic (OAuth) | GET `/v1/models` | Provider's base URL | 200 with beta headers |
| Ollama | GET `/v1/models` | Local endpoint | 200 (existing check) |
| Docker Model Runner | GET `/v1/models` | `model-runner.docker.internal` | 200 |
| Custom | HEAD on base URL | Provider's base URL | Any 2xx/4xx = reachable |

**Key distinction:** A 401 response means the provider is **reachable** but credentials need attention. A timeout or connection refused means the provider is **down**. Both are useful signals but different severities.

### 3.2 Probe Implementation

File: `apps/web/lib/operate/provider-health-probes.ts`

```typescript
type ProbeResult = {
  providerId: string;
  reachable: boolean;
  authenticated: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
};

async function probeProvider(provider: {
  providerId: string;
  baseUrl: string;
  authMethod: string;
}): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const headers = await buildAuthHeaders(provider); // reuse existing auth
    const res = await fetch(`${provider.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    return {
      providerId: provider.providerId,
      reachable: true,
      authenticated: res.status !== 401 && res.status !== 403,
      latencyMs: Date.now() - start,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      providerId: provider.providerId,
      reachable: false,
      authenticated: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown",
    };
  }
}
```

### 3.3 Probe Schedule

Probes run as a scheduled platform task:

```
Job: provider-health-probes
Schedule: every 5 minutes
Logic:
  1. Query all providers where status IN ('active', 'degraded')
  2. For each provider, run probeProvider() concurrently (max 5 at a time)
  3. Update Prometheus metrics:
     - dpf_provider_health_probe = 1 (reachable) or 0 (unreachable)
     - dpf_provider_health_probe_duration_seconds = latencyMs / 1000
  4. If not reachable and status = 'active':
     - Update ModelProvider.status = 'degraded'
     - Create PortfolioQualityIssue (issueType: "provider_unreachable")
  5. If reachable and status = 'degraded':
     - Update ModelProvider.status = 'active'
     - Auto-resolve the quality issue
  6. If not authenticated:
     - Create PortfolioQualityIssue (issueType: "provider_auth_failure")
```

### 3.4 Credential Expiry Probe

Separate from reachability probes — checks credential lifecycle:

```
Job: credential-expiry-check
Schedule: every 1 hour
Logic:
  1. Query all CredentialEntry records with tokenExpiresAt != null
  2. For each credential:
     a. Calculate seconds until expiry
     b. Set dpf_credential_expiry_seconds gauge
     c. If expiry < 24 hours:
        - Attempt proactive token refresh
        - Record dpf_credential_refresh_total{status}
     d. If expiry < 0 (already expired):
        - Set CredentialEntry.status = 'expired'
        - Create PortfolioQualityIssue (issueType: "credential_expired", severity: "error")
  3. For API key providers (no expiry date):
     - No automatic check (keys don't have expiry metadata)
     - Auth failures during inference trigger the alert via dpf_ai_inference_errors_total{error_type="auth"}
```

---

## Section 4: Automatic Status Management

### 4.1 Failure Rate Tracking

The `ModelProvider.recentFailureRate` field exists but is never updated. Wire it to inference outcomes:

File: Instrument in `lib/inference/ai-inference.ts` `callProvider()` (or the dispatch layer)

```
After each inference call:
  1. Record outcome (success/failure) in a sliding window (last 20 calls)
  2. Compute failure rate = failures / total
  3. Update ModelProvider.recentFailureRate (throttled: max once per minute per provider)
  4. Set dpf_provider_failure_rate gauge
  5. If failure rate > 0.7 for 5+ consecutive calls:
     - Update ModelProvider.status = 'degraded'
     - Routing pipeline already applies 0.7 multiplier to degraded providers
  6. If failure rate drops below 0.3 after degradation:
     - Update ModelProvider.status = 'active'
```

### 4.2 Rate Limit Metric Export

The in-memory rate tracker already has utilization data. Export it to Prometheus:

File: Instrument in `lib/routing/rate-tracker.ts`

```
After each recordRequest():
  1. Get current utilization via checkModelCapacity()
  2. Set dpf_rate_limit_utilization_percent{provider, model, dimension}
  3. If utilization >= 100%:
     - Increment dpf_rate_limit_exhausted_total{provider, model}
```

### 4.3 Proactive Token Refresh

File: Extend `lib/govern/provider-oauth.ts`

Current behavior: tokens refresh on-demand during inference calls (5-minute buffer).

New behavior:
- The `credential-expiry-check` job (Section 3.4) attempts refresh 24 hours before expiry
- If refresh fails, it retries with exponential backoff (1h, 2h, 4h, 8h)
- If refresh fails within 1 hour of expiry, escalate to critical alert
- On successful refresh, update `credentialExpirySeconds` gauge and reset quality issue

---

## Section 5: Routing Decision Observability

### 5.1 Routing Decision Logging

Instrument `routeEndpointV2()` in `pipeline-v2.ts`:

```
After routing decision:
  1. Increment dpf_routing_decisions_total{outcome}
     - "selected": normal selection
     - "fallback": primary excluded, fallback used
     - "no_candidates": pipeline returned empty (all filtered)
     - "error": pipeline threw exception
  2. If fallback chain activated:
     - Increment dpf_fallback_usage_total{provider, reason}
```

### 5.2 Routing Decision Grafana Dashboard Panel

A dedicated "AI Provider Routing" section in the System Health dashboard:

| Panel | Query | What It Shows |
|-------|-------|---------------|
| Routing success rate | `rate(dpf_routing_decisions_total{outcome="selected"}[5m]) / rate(dpf_routing_decisions_total[5m])` | Are requests finding providers? |
| Fallback frequency | `rate(dpf_fallback_usage_total[5m])` | How often are primary providers failing? |
| Provider failure rates | `dpf_provider_failure_rate` | Per-provider failure rate gauges |
| Credential countdown | `dpf_credential_expiry_seconds` | Time until each credential expires |
| Rate limit utilization | `dpf_rate_limit_utilization_percent` | Per-provider rate headroom |

---

## Section 6: System Health Dashboard Integration

### 6.1 AI Providers Section

The existing `AiCoworkerHealthPanel` in the System Health dashboard gains a provider-level breakdown:

```
─── AI Providers ──────────────────────────────────────────────────
┌────────────────────────────────────────────────────────────────┐
│  Provider          │ Status │ Failure Rate │ Credential │ Rate │
│  docker-model-run  │   UP   │     0%       │    N/A     │  12% │
│  anthropic         │   UP   │     2%       │   OK 47d   │  34% │
│  openai            │  WARN  │    15%       │   OK 12d   │  78% │
│  groq              │  DOWN  │   100%       │  EXPIRED   │   0% │
└────────────────────────────────────────────────────────────────┘
```

Each row shows:
- **Status**: UP (green) / WARN (amber) / DOWN (red) — from health probe
- **Failure Rate**: from `dpf_provider_failure_rate`
- **Credential**: days until expiry, "EXPIRED", or "N/A" for no-auth providers
- **Rate**: current rate limit utilization percentage

### 6.2 Agent Quality Section

Below the provider table, an agent quality summary:

```
─── Agent Quality ─────────────────────────────────────────────────
│  Agent/Task                     │ Score │ Phase      │ Trend    │
│  portfolio-advisor / analysis   │  4.2  │ innate     │ ▁▂▃▄▅   │
│  ops-coordinator / backlog      │  3.8  │ practicing │ ▃▃▃▄▃   │
│  ea-architect / modeling        │  2.1  │ learning   │ ▅▄▃▂▁ ! │
└──────────────────────────────────────────────────────────────────
```

Regression indicators (`!`) when an agent drops from a higher phase.

---

## Section 7: Instrumentation Points

### 7.1 Files to Modify

| File | Change | Metrics |
|------|--------|---------|
| `lib/operate/metrics.ts` | Add 10 new metric definitions (Section 1) | All new metrics |
| `lib/inference/ai-inference.ts` | Update `recentFailureRate` after each call | `dpf_provider_failure_rate` |
| `lib/routing/rate-tracker.ts` | Export utilization to Prometheus after `recordRequest()` | `dpf_rate_limit_utilization_percent`, `dpf_rate_limit_exhausted_total` |
| `lib/routing/pipeline-v2.ts` | Record routing decisions | `dpf_routing_decisions_total` |
| `lib/routing/fallback.ts` | Record fallback activations | `dpf_fallback_usage_total` |
| `lib/govern/provider-oauth.ts` | Record refresh attempts, set expiry gauge | `dpf_credential_refresh_total`, `dpf_credential_expiry_seconds` |
| `lib/tak/orchestrator-evaluator.ts` | Set quality score gauge, increment regression counter | `dpf_agent_quality_score`, `dpf_agent_regressions_total` |
| `monitoring/prometheus/alerts.yml` | Add 10 new alert rules (Section 2) | N/A |

### 7.2 New Files

| File | Purpose |
|------|---------|
| `lib/operate/provider-health-probes.ts` | Provider reachability and auth probes |
| `lib/operate/credential-expiry-check.ts` | Proactive credential expiry scanning and token refresh |
| `lib/operate/provider-failure-tracker.ts` | Sliding window failure rate computation, status management |
| `components/monitoring/ProviderStatusTable.tsx` | Provider health table for System Health dashboard |
| `components/monitoring/AgentQualityTable.tsx` | Agent quality summary for System Health dashboard |

---

## Section 8: Implementation Sequence

| Phase | Scope | Deliverables |
|-------|-------|-------------|
| **1** | Metrics & alerts | 10 new Prometheus metrics in `metrics.ts`. 10 new alert rules in `alerts.yml`. |
| **2** | Failure rate tracking | Instrument `callProvider()` to update `recentFailureRate`. Sliding window tracker. Automatic status degradation/recovery. |
| **3** | Credential monitoring | Expiry gauge set during token refresh. `credential-expiry-check` scheduled job. Proactive refresh 24h before expiry. |
| **4** | Provider health probes | `provider-health-probes` scheduled job. Probe all active providers every 5 minutes. Auto-degrade unreachable providers. |
| **5** | Rate limit export | Instrument `rate-tracker.ts` to export utilization to Prometheus. |
| **6** | Routing observability | Instrument `pipeline-v2.ts` and `fallback.ts` with routing decision and fallback metrics. |
| **7** | Agent quality metrics | Instrument `orchestrator-evaluator.ts` with quality score gauge and regression counter. |
| **8** | Dashboard integration | `ProviderStatusTable` and `AgentQualityTable` components in System Health dashboard. |

### Validation Criteria

1. **Phase 1:** `curl /api/metrics` includes all new metric names. Alert rules load in Prometheus without errors.
2. **Phase 2:** After 5 consecutive failures to a provider, its `recentFailureRate` > 0.7 and status transitions to `"degraded"`. After recovery, status returns to `"active"`.
3. **Phase 3:** OAuth token scheduled for refresh 24 hours before expiry. `dpf_credential_expiry_seconds` gauge visible in Prometheus. Alert fires when < 24h remaining.
4. **Phase 4:** Health probes run every 5 minutes. Unreachable provider auto-degrades. Recovery auto-restores.
5. **Phase 5:** Rate limit utilization visible per provider/model in Prometheus. Alert fires at 80%.
6. **Phase 6:** Routing decision counts visible. Fallback activations logged with reason.
7. **Phase 7:** Agent quality scores visible as gauges. Regression events create alerts.
8. **Phase 8:** System Health dashboard shows provider table and agent quality table with live data.

---

## Appendix A: Provider Failure Cascade Scenario

Demonstrates the full detect-diagnose-correct flow:

```
1. Anthropic OAuth token expires
   ├─ credential-expiry-check fires 24h before (proactive refresh attempted)
   ├─ If refresh fails: CredentialExpiringSoon alert → PortfolioQualityIssue
   ├─ If ignored: CredentialExpired alert at expiry
   └─ Token expires

2. Next inference call to Anthropic fails with auth error
   ├─ aiInferenceErrors.inc({error_type: "auth"})
   ├─ ProviderAuthFailing alert fires (2 min sustained)
   ├─ Failure rate tracker: recentFailureRate climbs
   ├─ After 5 failures: status → "degraded"
   └─ Routing pipeline applies 0.7 multiplier (prefers other providers)

3. Routing adapts automatically
   ├─ OpenAI or local model selected as primary
   ├─ Anthropic moves to end of fallback chain
   ├─ dpf_routing_decisions_total{outcome="fallback"} increments
   └─ User experience: slower but uninterrupted

4. Operator sees in System Health dashboard
   ├─ Provider table: Anthropic = WARN, Credential = EXPIRED
   ├─ Alert banner: "Anthropic authentication failing"
   ├─ Quality issue in Operations console
   └─ Operator re-authenticates via Platform > AI Workforce > Provider detail

5. After re-authentication
   ├─ Health probe confirms reachable + authenticated
   ├─ Status → "active", failure rate resets
   ├─ Quality issue auto-resolved
   └─ Routing restores normal priority
```

## Appendix B: Relationship to Product-Centric Refactoring

When the product-centric navigation refactoring (EP-PROD-NAV) lands, the AI provider monitoring surfaces described here will move from the current System Health tab under Operations to the **Foundational/Platform Services/AI Workforce** digital product's lifecycle view. The metrics, alerts, and components are product-agnostic — they attach to whatever navigation structure exists.

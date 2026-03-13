# Docker Ollama OOTB Local AI — Design Spec

## Goal

Bundle Ollama as a Docker Compose sidecar so the platform ships with local AI inference out of the box. Zero configuration — `docker compose up` starts Ollama, auto-detects GPU, pulls a default model, and the platform auto-discovers, activates, and profiles it on first page load.

## Architecture

Ollama joins the existing docker-compose.yml as a third service alongside PostgreSQL and Neo4j. The entrypoint script handles GPU detection and default model provisioning. The web app's AI Providers page passively health-checks the bundled Ollama instance on each render, auto-activating it and triggering model discovery + profiling when it comes online.

**API surfaces**: Ollama exposes two API namespaces on the same port:
- **Native API** (`/api/...`): Ollama-specific endpoints — `/api/tags` (list models), `/api/pull` (download), `/api/ps` (running models + GPU info). Used for health checks, model management, and hardware discovery.
- **OpenAI-compatible API** (`/v1/...`): Drop-in replacement for OpenAI SDK calls — `/v1/models`, `/v1/chat/completions`. Used by the platform's existing model discovery and inference code.

The registry `baseUrl` (`http://localhost:11434/v1`) points at the OpenAI-compatible endpoint. Health checks and hardware enrichment use the native API at the root URL (`http://localhost:11434`).

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Inference runtime | Ollama | Simplest setup, best model library UX, GPU auto-detection, standalone client for power users |
| Model provisioning | Auto-pull on first boot | Image stays small, models always fresh, persisted via named volume |
| GPU detection | Runtime auto-detection | Survives hardware migrations without config changes; admin already configures GPU passthrough in Docker |
| Health monitoring | Passive check on page load | Simple, gives instant feedback, avoids background polling complexity |
| Auto-profiling | Yes, on first discovery | True zero-config; admin sees friendly model cards immediately; local inference is free |
| Web app container | Deferred (high-priority backlog) | Focus this spec on local AI; app Dockerfile is its own effort |

---

## Section 1: Docker Infrastructure

### docker-compose.yml — Ollama Service

```yaml
ollama:
  image: ollama/ollama
  ports:
    - "${OLLAMA_HOST_PORT:-11434}:11434"
  volumes:
    - ollama_models:/root/.ollama
    - ./scripts/ollama-entrypoint.sh:/ollama-entrypoint.sh:ro
  entrypoint: ["/bin/bash", "/ollama-entrypoint.sh"]
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
  healthcheck:
    test: ["CMD", "curl", "-sf", "http://localhost:11434/api/tags"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s

# Add to existing top-level volumes:
volumes:
  ollama_models:
```

**Notes:**
- **Host port**: Defaults to `11434` but configurable via `OLLAMA_HOST_PORT` env var. If the host already runs Ollama locally, set `OLLAMA_HOST_PORT=11435` in `.env` to avoid port conflict.
- **GPU passthrough**: Best-effort via `deploy.resources.reservations.devices`. Works if NVIDIA Container Toolkit is installed. On Docker Compose v2 without the toolkit, the `deploy` block is ignored. On some Docker Desktop versions, the `devices` section may error if the NVIDIA runtime is explicitly requested but unavailable. If GPU passthrough causes errors on a CPU-only host, the admin can comment out or remove the `deploy` block — Ollama still works in CPU-only mode.
- **`ollama_models`** named volume persists downloaded models across container restarts — models only download once.
- **`curl` dependency**: The `ollama/ollama` Docker image includes `curl`. The healthcheck and entrypoint both rely on it.

### scripts/ollama-entrypoint.sh

```bash
#!/bin/bash
set -e

# 1. Start Ollama server in background
ollama serve &
OLLAMA_PID=$!

# 2. Wait for Ollama to be ready (max 60s)
echo "Waiting for Ollama to start..."
READY=false
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" = false ]; then
  echo "ERROR: Ollama failed to start within 60 seconds."
  exit 1
fi

# 3. Check if models already loaded (persisted volume)
MODEL_COUNT=$(ollama list 2>/dev/null | tail -n +2 | wc -l)

if [ "$MODEL_COUNT" = "0" ]; then
  echo "No models found. Detecting hardware..."

  # 4. Runtime GPU detection
  GPU_DETECTED=false
  if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    GPU_DETECTED=true
    echo "GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'unknown')"
  fi

  # 5. Pull appropriate default model
  if [ "$GPU_DETECTED" = true ]; then
    echo "Pulling llama3:8b (GPU-optimized default)..."
    ollama pull llama3:8b
  else
    echo "Pulling phi3:mini (CPU-optimized default)..."
    ollama pull phi3:mini
  fi

  echo "Default model ready."
else
  echo "$MODEL_COUNT model(s) already available."
fi

# 6. Foreground the Ollama process
wait $OLLAMA_PID
```

### Environment Variables

Add to `.env.example`:

```env
# Host port for Ollama (change if local Ollama already uses 11434)
OLLAMA_HOST_PORT=11434

# Internal Docker network URL for Ollama (server-side only; leave unset for local dev)
OLLAMA_INTERNAL_URL=http://ollama:11434
```

For local development outside Docker, **leave `OLLAMA_INTERNAL_URL` unset** — the `getOllamaBaseUrl()` helper falls back to `http://localhost:11434`. The setup scripts should only copy `OLLAMA_INTERNAL_URL` into `.env.local` when running in Docker Compose mode.

### Setup Scripts

Update `scripts/setup.sh` and `scripts/setup.ps1`:
- Add Ollama readiness polling after `docker compose up -d` (same pattern as PostgreSQL: poll until health check passes)
- Display status: "Waiting for Ollama... (first run may take a few minutes to download default model)"

---

## Section 2: Platform Integration

### Page-Load Health Check

In the `/platform/ai` server component (`PlatformAiPage`), add a bundled-provider health check step that runs alongside the existing auto-sync logic:

**Function: `checkBundledProviders()`**
- Queries the bundled Ollama provider (`providerId === "ollama"`)
- Pings `{getOllamaBaseUrl()}/api/tags` with 3-second timeout (native API, NOT the `/v1` endpoint)
- **Reachable + status !== "active"**: Set status to `"active"`, run internal `discoverModelsInternal()`, then `profileModelsInternal()` for unprofiled models
- **Unreachable + status === "active"**: Set status to `"inactive"`
- **Unreachable + status === "unconfigured"**: Leave as-is

**Auth model**: `checkBundledProviders()` is internal server-side logic that runs during page render, NOT a user-invoked server action. It must **not** go through the `requireManageProviders()` auth guard. Extract the core discovery/profiling logic from `discoverModels()` and `profileModels()` into internal functions (`discoverModelsInternal()`, `profileModelsInternal()`) that the existing server actions delegate to. `checkBundledProviders()` calls the internal functions directly.

**Scope**: Initially only the bundled Ollama provider. Other local providers (LM Studio, vLLM, etc.) that admins install separately continue to use the manual "Test connection" flow.

**Performance**: The 3-second timeout with `AbortSignal.timeout(3000)` ensures the page doesn't hang if Ollama is down. The health check runs in parallel with the existing data fetches.

### Docker Networking

The web app reaches Ollama via different URLs depending on context:
- **Server-side (Next.js server component / server action)**: Uses `OLLAMA_INTERNAL_URL` env var (`http://ollama:11434` in Docker Compose network)
- **Provider detail page / admin URL**: Uses the registry `baseUrl` (`http://localhost:11434/v1`) or admin-configured `endpoint` override

The helper resolves the **root** Ollama URL (without `/v1` suffix) for health checks and native API calls:

```typescript
/** Returns the root Ollama URL for native API calls (health, /api/tags, /api/ps). */
function getOllamaBaseUrl(provider?: Pick<ProviderRow, "providerId" | "baseUrl" | "endpoint">): string {
  if (process.env.OLLAMA_INTERNAL_URL) {
    return process.env.OLLAMA_INTERNAL_URL;
  }
  // Strip /v1 suffix if present (baseUrl points at OpenAI-compatible endpoint)
  const raw = provider?.endpoint ?? provider?.baseUrl ?? "http://localhost:11434";
  return raw.replace(/\/v1\/?$/, "");
}
```

For OpenAI-compatible calls (model listing, inference), the existing `baseUrl` (`http://localhost:11434/v1`) and `getTestUrl()` helper continue to work unchanged.

### Auto-Profiling on First Discovery

When `checkBundledProviders()` discovers models on the bundled Ollama for the first time:

1. `discoverModelsInternal("ollama")` runs — populates `DiscoveredModel` records
2. If any unprofiled models exist, `profileModelsInternal("ollama")` runs automatically
3. Profiling uses the cheapest active provider (which may be Ollama itself if it's the only active provider)
4. No confirmation prompt — this is the OOTB zero-config path; local inference has no API cost

**Guard**: Only auto-profile if the discovered model count is reasonable (< 20). If someone has 50+ models loaded in Ollama, skip auto-profiling and let the admin trigger it manually. This prevents unexpectedly long page loads.

---

## Section 3: InfraCI Graph Enrichment

### Ollama CI Node

Extend `packages/db/scripts/init-neo4j.ts` to register an Ollama infrastructure CI node. Uses `syncInfraCI()` with the existing merge-key pattern:

```
ciId: "CI-ollama-01"
name: "Ollama"
ciType: "ai-inference"
status: "discovered"       // updated to "active"/"inactive" by health check
```

Relationship: `(:InfraCI {ciId: "CI-ollama-01"}) -[:DEPENDS_ON]-> (:InfraCI {ciId: "CI-docker-host-01"})`

### Extending `syncInfraCI()` for Hardware Properties

The existing `syncInfraCI()` function only accepts `ciId`, `name`, `ciType`, `status`, and `portfolioSlug`. Extend it with optional properties:

```typescript
interface InfraCIExtendedProps {
  baseUrl?: string;
  gpu?: string;       // e.g., "NVIDIA RTX 4090" or "CPU-only"
  vramGb?: number;    // null for CPU-only
  modelCount?: number;
}
```

These properties are SET on the Neo4j node alongside the existing ones. The function signature becomes:
`syncInfraCI(ciId, name, ciType, status, portfolioSlug?, extendedProps?)`

### GPU Property Enrichment

When the page-load health check finds Ollama active, it queries `/api/ps` (native API — reports loaded models and GPU layer allocation). This data is written to the Ollama InfraCI node:
- `gpu`: GPU name string (e.g., "NVIDIA RTX 4090") or "CPU-only"
- `vramGb`: Total VRAM in GB (null for CPU-only)
- `modelCount`: Number of discovered models

This data updates each time the AI Providers page renders with Ollama active, keeping the infrastructure inventory fresh.

### VRAM-to-Parameter Mapping

Rough guideline for "max model size" display (assumes Q4 quantization):

| VRAM (GB) | Max Parameters | Example Models |
|---|---|---|
| 4 | ~3B | phi3:mini, gemma:2b |
| 8 | ~7B | llama3:8b, mistral:7b |
| 16 | ~13B | llama3:13b, codellama:13b |
| 24 | ~20B | mixtral:8x7b (partial offload) |
| 48+ | ~70B | llama3:70b |

Formula: `maxParams ≈ vramGb * 0.85` (B parameters, Q4). This is approximate — actual capacity varies by model architecture and quantization level.

### Provider Detail Page

On the Ollama provider detail page, display the hardware info from the InfraCI node:
- "Running on NVIDIA RTX 4090 (24GB VRAM)" or "Running on CPU"
- "This host can run models up to ~13B parameters" (derived from VRAM using the mapping above)

---

## Section 4: Testing Strategy

### Unit Tests
- `checkBundledProviders()`: Mock fetch responses for reachable/unreachable scenarios; verify status transitions (unconfigured→active, active→inactive, unconfigured stays)
- `getOllamaBaseUrl()`: Test env var override, `/v1` stripping, fallback to localhost
- `discoverModelsInternal()` / `profileModelsInternal()`: Verify they work without auth context

### Integration Tests
- Docker Compose health check: `docker compose up ollama` → verify health check passes
- Entrypoint model detection: `ollama list` returns model count correctly after pull
- Entrypoint GPU detection: Test with and without `nvidia-smi` available
- Entrypoint timeout: Verify error exit when Ollama fails to start within 60s
- Model auto-pull: Verify volume persistence (restart container, check model still present)

### InfraCI Enrichment Tests
- Verify `syncInfraCI()` extended props are written to Neo4j
- Verify GPU/VRAM/modelCount properties update on subsequent health checks
- Verify "CPU-only" fallback when `/api/ps` returns no GPU layers

### Manual Verification
- Fresh `docker compose up -d` → visit `/platform/ai` → Ollama should show as "active" with profiled models
- Stop Ollama container → refresh page → Ollama shows "inactive"
- Restart Ollama → refresh page → shows "active" again
- Provider detail page shows hardware info (GPU name or "CPU", VRAM, max model size)

---

## Section 5: Scope Boundaries

### In Scope
- Ollama service in `docker-compose.yml` with health check + GPU passthrough + configurable host port
- `scripts/ollama-entrypoint.sh`: GPU detection, auto-pull default model, wait-for-healthy with timeout
- `OLLAMA_INTERNAL_URL` + `OLLAMA_HOST_PORT` env vars
- `getOllamaBaseUrl()` helper for native API URL resolution (strips `/v1`, prefers internal URL)
- Page-load health check for bundled Ollama: auto-activate, auto-discover, auto-profile (bypasses auth guard via internal functions)
- `syncInfraCI()` extended with optional hardware properties
- Ollama CI node in Neo4j infra graph with GPU/VRAM properties
- Hardware capability display on provider detail page with VRAM-to-parameter mapping
- Update `scripts/setup.sh` and `scripts/setup.ps1` for Ollama readiness
- `ollama_models` named volume in compose

### Deferred (Future Specs)
- **In-app model pull UI** — Browse Ollama library and pull models from the provider detail page without leaving the platform
- **OAuth browser flow** — "Connect with Provider" button for Azure/Gemini (separate spec)
- **Next.js app containerization** — Dockerfile for the web app (HIGH PRIORITY — add to backlog before MVP)
- **Model recommendation engine** — Use InfraCI VRAM data to suggest optimal models for the host hardware
- **Multi-provider health polling** — Extend passive health check to all local providers, not just bundled Ollama

---

## Backlog Items

### High Priority (pre-MVP)
- **BI-PLAT-001**: Containerize Next.js web app — Dockerfile + `web` service in docker-compose for full single-command deployment

### Normal Priority
- **BI-PLAT-002**: In-app Ollama model pull UI — Browse library, trigger pulls, show download progress from provider detail page
- **BI-PLAT-003**: Model recommendation engine — Use VRAM/RAM data from InfraCI to recommend models and warn about hardware mismatches

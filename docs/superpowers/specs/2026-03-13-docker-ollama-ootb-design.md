# Docker Ollama OOTB Local AI — Design Spec

## Goal

Bundle Ollama as a Docker Compose sidecar so the platform ships with local AI inference out of the box. Zero configuration — `docker compose up` starts Ollama, auto-detects GPU, pulls a default model, and the platform auto-discovers, activates, and profiles it on first page load.

## Architecture

Ollama joins the existing docker-compose.yml as a third service alongside PostgreSQL and Neo4j. The entrypoint script handles GPU detection and default model provisioning. The web app's AI Providers page passively health-checks the bundled Ollama instance on each render, auto-activating it and triggering model discovery + profiling when it comes online.

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
    - "11434:11434"
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
```

**Notes:**
- GPU passthrough is best-effort via `deploy.resources.reservations.devices`. Works if NVIDIA Container Toolkit is installed; Docker Compose silently ignores the `deploy` block on machines without GPU support.
- `ollama_models` named volume persists downloaded models across container restarts — models only download once.
- Port `11434` is exposed for direct Ollama client access from the host (power users).

### scripts/ollama-entrypoint.sh

```bash
#!/bin/bash
set -e

# 1. Start Ollama server in background
ollama serve &
OLLAMA_PID=$!

# 2. Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is ready."
    break
  fi
  sleep 2
done

# 3. Check if models already loaded (persisted volume)
MODEL_COUNT=$(curl -sf http://localhost:11434/api/tags | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")

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

Add to `.env.example` and `apps/web/.env.local`:

```env
# Internal Docker network URL for Ollama (used by web app server-side)
OLLAMA_INTERNAL_URL=http://ollama:11434
```

When running outside Docker (dev on host), this defaults to `http://localhost:11434` (the existing registry `baseUrl`).

### Setup Scripts

Update `scripts/setup.sh` and `scripts/setup.ps1`:
- Add Ollama readiness polling after `docker compose up -d` (same pattern as PostgreSQL: poll until health check passes)
- Display status: "Waiting for Ollama... (first run may take a few minutes to download default model)"

---

## Section 2: Platform Integration

### Page-Load Health Check

In the `/platform/ai` server component (`PlatformAiPage`), add a bundled-provider health check step that runs alongside the existing auto-sync logic:

**Function: `checkBundledProviders()`**
- Queries all local providers with `category === "local"`
- For each, pings `{OLLAMA_INTERNAL_URL || baseUrl}/api/tags` with 3-second timeout
- **Reachable + status !== "active"**: Set status to `"active"`, run `discoverModels()`, then `profileModels()` for unprofiled models
- **Unreachable + status === "active"**: Set status to `"inactive"`
- **Unreachable + status === "unconfigured"**: Leave as-is

**Scope**: Initially only the bundled Ollama provider (identified by `providerId === "ollama"`). Other local providers (LM Studio, vLLM, etc.) that admins install separately continue to use the manual "Test connection" flow.

**Performance**: The 3-second timeout with `AbortSignal.timeout(3000)` ensures the page doesn't hang if Ollama is down. The health check runs in parallel with the existing data fetches.

### Docker Networking

The web app reaches Ollama via different URLs depending on context:
- **Server-side (Next.js server component / server action)**: Uses `OLLAMA_INTERNAL_URL` env var (`http://ollama:11434` in Docker Compose network)
- **Provider detail page / admin URL**: Uses the registry `baseUrl` (`http://localhost:11434`) or admin-configured `endpoint` override

The existing `getTestUrl()` helper and all server actions need to prefer `OLLAMA_INTERNAL_URL` when available and the target provider is `ollama`. This is implemented as a helper:

```typescript
function getOllamaUrl(provider: Pick<ProviderRow, "providerId" | "baseUrl" | "endpoint">): string {
  if (provider.providerId === "ollama" && process.env.OLLAMA_INTERNAL_URL) {
    return process.env.OLLAMA_INTERNAL_URL;
  }
  return provider.endpoint ?? provider.baseUrl ?? "http://localhost:11434";
}
```

### Auto-Profiling on First Discovery

When `checkBundledProviders()` discovers models on the bundled Ollama for the first time:

1. `discoverModels("ollama")` runs — populates `DiscoveredModel` records
2. If any unprofiled models exist, `profileModels("ollama")` runs automatically
3. Profiling uses the cheapest active provider (which may be Ollama itself if it's the only active provider)
4. No confirmation prompt — this is the OOTB zero-config path; local inference has no API cost

**Guard**: Only auto-profile if the discovered model count is reasonable (< 20). If someone has 50+ models loaded in Ollama, skip auto-profiling and let the admin trigger it manually. This prevents unexpectedly long page loads.

---

## Section 3: InfraCI Graph Enrichment

### Ollama CI Node

Extend `packages/db/scripts/init-neo4j.ts` to register an Ollama infrastructure CI node:

```
(:InfraCI {
  name: "Ollama",
  type: "ai-inference",
  status: "discovered",  // or "active"/"inactive" based on health
  baseUrl: "http://ollama:11434",
  gpu: null,              // populated by health check
  vramGb: null,           // populated by health check
  modelCount: 0           // populated by health check
})
-[:DEPENDS_ON]->(:InfraCI {name: "Docker Host"})
```

### GPU Property Enrichment

When the page-load health check finds Ollama active, it queries `/api/ps` (which reports loaded models and GPU layer allocation). This data is written to the Ollama InfraCI node:
- `gpu`: GPU name string (e.g., "NVIDIA RTX 4090") or "CPU-only"
- `vramGb`: Total VRAM in GB (null for CPU-only)
- `modelCount`: Number of discovered models

This data updates each time the AI Providers page renders with Ollama active, keeping the infrastructure inventory fresh.

### Provider Detail Page

On the Ollama provider detail page, display the hardware info from the InfraCI node:
- "Running on NVIDIA RTX 4090 (24GB VRAM)" or "Running on CPU"
- "This host can run models up to ~13B parameters" (derived from VRAM)

---

## Section 4: Testing Strategy

### Unit Tests
- `ollama-entrypoint.sh`: Not unit-testable (shell script), but tested via integration
- `checkBundledProviders()`: Mock fetch responses for reachable/unreachable scenarios; verify status transitions (unconfigured→active, active→inactive, unconfigured stays)
- `getOllamaUrl()`: Test env var override vs. fallback

### Integration Tests
- Docker Compose health check: `docker compose up ollama` → verify health check passes
- Entrypoint GPU detection: Test with and without `nvidia-smi` available
- Model auto-pull: Verify volume persistence (restart container, check model still present)

### Manual Verification
- Fresh `docker compose up -d` → visit `/platform/ai` → Ollama should show as "active" with profiled models
- Stop Ollama container → refresh page → Ollama shows "inactive"
- Restart Ollama → refresh page → shows "active" again

---

## Section 5: Scope Boundaries

### In Scope
- Ollama service in `docker-compose.yml` with health check + GPU passthrough
- `scripts/ollama-entrypoint.sh`: GPU detection, auto-pull default model, wait-for-healthy
- `OLLAMA_INTERNAL_URL` env var for Docker networking
- Page-load health check for bundled Ollama: auto-activate, auto-discover, auto-profile
- Ollama CI node in Neo4j infra graph with GPU/VRAM properties
- Hardware capability display on provider detail page
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

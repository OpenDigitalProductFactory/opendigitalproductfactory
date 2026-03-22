---
title: "Local AI (Docker Model Runner / Ollama)"
area: ai-workforce
order: 5
lastUpdated: "2026-03-22"
updatedBy: "Claude (COO)"
---

## Overview

Docker Model Runner provides local AI inference using models that run directly on your machine via Docker Desktop. Data never leaves your computer, making it suitable for all sensitivity levels including confidential and restricted data.

## How It Works

Docker Desktop 4.40+ includes a built-in Model Runner that provides an OpenAI-compatible API at `http://model-runner.docker.internal/v1`. The platform detects this automatically — no configuration needed.

## Setup

The local provider is pre-configured and activates automatically when Docker Model Runner is reachable. No API key or sign-in is required.

### Pulling Models

Models must be pulled before they can be used:

```
docker model pull ai/llama3.2:1B-Q8_0
```

To see available models:

```
docker model list
```

After pulling a model, visit the External Services page. The platform discovers and profiles new models automatically on page load.

## Model Discovery and Profiling

When you visit the External Services page or click "Sync Models & Profiles", the platform:

1. Queries Docker Model Runner for available models
2. Creates a DiscoveredModel entry for each
3. Profiles the model with routing scores (capability tier, cost, task suitability)
4. Makes the model available for routing

This also happens at container startup during the seed process — models are discovered and profiled without needing a page visit.

## Sensitivity Clearance

Local models are automatically granted full sensitivity clearance: public, internal, confidential, and restricted. This is because data processed by local models never leaves your machine.

## Cost Model

Local inference uses a "compute" cost model instead of per-token pricing. The cost is based on electricity consumption (GPU power draw). In practice, local models are effectively free for development use.

## Using Ollama Instead (BYOP)

If you already have an Ollama instance running on your machine or local network, you can point this provider at it instead of Docker Model Runner.

1. Go to External Services and click the local provider
2. Change the Base URL from `http://model-runner.docker.internal/v1` to your Ollama endpoint (e.g., `http://host.docker.internal:11434/v1` if running Ollama on the host)
3. Click Save, then Test Connection
4. Click "Sync Models & Profiles" to discover your Ollama models

The platform auto-detects whether the endpoint is Docker Model Runner or Ollama and adjusts its model discovery accordingly (`/v1/models` for Docker Model Runner, `/api/tags` for legacy Ollama).

Note: Only one local model can be actively loaded at a time in Ollama. Swapping between models takes 30+ seconds due to VRAM reload.

## Limitations

- Model quality depends on your hardware (GPU, VRAM)
- Smaller local models (1B-8B parameters) have lower capability than cloud providers
- No prompt caching or extended context features
- Only one model can be actively loaded at a time (swapping takes 30+ seconds due to VRAM reload)

## Troubleshooting

- "Docker Model Runner not reachable" — ensure Docker Desktop 4.40+ is running with Model Runner enabled
- "No models discovered" — pull at least one model with `docker model pull` (Docker Model Runner) or `ollama pull` (Ollama)
- "Test Connection 404" — the model list endpoint changed format. Ensure you are running the latest platform version
- "No eligible endpoints" — after pulling a model, visit External Services to trigger discovery and profiling
- "Ollama connection refused" — if running Ollama on the host, use `http://host.docker.internal:11434/v1` as the base URL (not `localhost`)

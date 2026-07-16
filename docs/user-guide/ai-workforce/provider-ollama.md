---
title: "Local AI — Docker Model Runner"
area: ai-workforce
order: 5
---

## Overview

Docker Model Runner is the default local AI runtime. It provides inference using models that run directly on your machine via Docker Desktop 4.40+. Data never leaves your computer, making it suitable for all sensitivity levels including confidential and restricted data.

If you prefer to use Ollama instead, see [Using Ollama Instead (BYOP)](#using-ollama-instead-byop) below.

## How It Works

Docker Desktop 4.40+ includes a built-in Model Runner that provides an OpenAI-compatible API at `http://model-runner.docker.internal/v1`. The platform detects this automatically — no configuration needed.

## Setup

The local provider is pre-configured and activates automatically when Docker Model Runner is reachable. No API key or sign-in is required.

### Pulling Models

Models must be pulled before they can be used:

```
docker model pull ai/gemma4
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

## Local Multimodal Input (Vision + Audio)

Docker Model Runner can serve a **local multimodal-input model** — Gemma 4 12B (`ai/gemma4:12B`) — that accepts **text, image, and audio** input and returns text. This brings vision and audio understanding onto the same on-machine substrate as text inference. The image or audio you send is processed entirely on your machine — **zero egress** — so the multimodal model inherits the same full sensitivity clearance (public through restricted) as any local model.

### Pulling the multimodal model

The model is pulled with the same zero-click flow as any other local model — no sign-in, no API key:

```
docker model pull ai/gemma4:12B
```

The download is roughly 7.54 GB. Once pulled, the platform discovers and profiles it automatically on the next External Services visit (or at container-startup seed) and tags it with the `imageInput` and `audioInput` capabilities.

### How routing selects it (no provider pinning)

There is **no provider or model pin**. A request that needs vision or audio declares a capability floor — `imageInput` or `audioInput` — and the router selects any active model whose profile satisfies that floor. Because Gemma 4 12B is profiled with `capabilities.imageInput = true` and `capabilities.audioInput = true`, it is chosen automatically when — and only when — a request carries image or audio content. Text-only requests are unaffected and continue to route by the usual text and tool-fidelity capability scores.

These multimodal tags start as **bootstrap priors** (low profile confidence): the local-model family detector recognises the Gemma multimodal family and seeds `imageInput`/`audioInput` so routing works on a fresh install, and the activation-time capability evaluation then measures and calibrates the real scores. The capability flag is the routing contract — no model id is ever hard-coded into a request.

### What is not affected

- **Code generation** continues to route to the code tier (for example `qwen3-coder`), a text/tool model with no vision or audio capability — the multimodal model is never selected for code-gen.
- **Embeddings** are served by embedding models (nomic / bge / e5 family), which are never multimodal-routable.
- Adding the multimodal model changes nothing about existing text routing; it only becomes reachable when a request explicitly needs an image or audio modality.

### Vision feeds the WWMD cognitive-load rubric

The first production consumer of local vision is UI evaluation. When `evaluate_page` audits a rendered route it captures a screenshot; that screenshot is routed to the vision-capable local model, which returns a structured visual assessment (cognitive load, visual density, estimated control count). Those signals merge into the WWMD `human_cognitive_load` decision rubric — giving the rubric real visual input for the first time and closing the "structural is not functional" gap on UI review, entirely on-machine.

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

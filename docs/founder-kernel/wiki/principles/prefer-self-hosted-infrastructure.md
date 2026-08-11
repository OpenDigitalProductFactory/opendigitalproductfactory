---
title: Prefer Self-Hosted Infrastructure
pageKind: principle
status: published
abstract: Run platform services on your own hardware first. Use external APIs only when no viable self-hosted alternative exists.
principleTier: core
principleDirection: Own the infrastructure stack. Self-hosted services over third-party APIs for any platform capability that has a viable open-source equivalent.
principleDimensionVector: {"long_term_maintainability": 0.9, "governance_compliance": 0.8, "capacity_utilization": 0.7, "blast_radius": -0.7, "cost_efficiency": 0.75, "operational_independence": 0.9, "vendor_lock_in": -0.85}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: DPF positions itself as a sovereign AI-native platform. Operators who adopt DPF should understand that the platform's default posture is to own its capabilities, not rent them — and that external APIs are explicitly opt-in, not the default.
sources: []
---

## Rule

When a platform capability (speech-to-text, text-to-speech, embeddings, image processing, inference, etc.) has a viable open-source, self-hosted equivalent, use it. Run it on your own hardware behind your own Docker network. Reach external SaaS APIs only when no self-hosted path meets the quality or latency bar — and treat that dependency as a gap to close, not a permanent choice.

## Why

Every external API dependency is a lever someone else controls: pricing, rate limits, model changes, deprecation, data retention policies, outage windows. At platform scale, those levers compound. Owning the infrastructure stack means the platform's capabilities are bounded only by hardware, not by a vendor's quarterly pricing review or an upstream API outage.

DPF is designed to run in enterprise environments where data sovereignty is non-negotiable. Healthcare, finance, and government operators cannot route sensitive data through third-party APIs. A self-hosted default is the only architecture that serves that market without re-engineering for each customer.

The pattern is also economically correct over time. Third-party per-call pricing may look cheap at zero scale. At the scale of a platform serving hundreds of decisions per day, a self-hosted model on existing hardware costs less per inference than any commercial API. The hardware cost is largely sunk; the marginal inference cost approaches zero.

## Applies To

Any new service capability introduced to the platform stack: AI inference (STT, TTS, embeddings, image models), search engines, analytics, identity services, storage. The principle applies to the default, not to every possible configuration — operators may choose to route to external APIs via environment-variable overrides, but the out-of-the-box path should work on local hardware.

Does NOT apply when:
- No viable open-source alternative exists at the required quality level (use the external API and file a tracking item to revisit when the open-source field catches up)
- The capability is inherently external (e.g. third-party OAuth identity providers — the point is to federate identity, not own it)
- The operator explicitly opts in to a managed API to trade infrastructure burden for simplicity

## How To Apply

For every new AI/ML platform service:
1. Research the open-source landscape first (`research-and-use-standards`). Find the leading models with permissive licenses (MIT, Apache 2.0).
2. Check whether a Docker-ready server image exists. If it exposes an OpenAI-compatible endpoint, the adapter cost is near zero.
3. Size the hardware requirement. If it fits on the existing GPU stack alongside current services, self-host by default.
4. Write an adapter that matches the existing provider interface. External APIs become opt-in providers behind the same adapter contract — not the primary path.
5. Add the service as an opt-in Docker Compose profile (e.g. `--profile tts`) following the same pattern as `dpf-stt`.

## Reference Implementations

- **Speech-to-text**: `dpf-stt` — speaches/faster-whisper on `dpf-stt:9000`, opt-in via `--profile stt`, CUDA-accelerated, OpenAI-compatible `/v1/audio/transcriptions` endpoint. External alternatives (Deepgram, AssemblyAI, OpenAI Whisper API) are never the default.
- **Text-to-speech**: `dpf-tts` — Chatterbox (Resemble AI, MIT license) on `dpf-tts:8000`, zero-shot voice cloning from a reference audio clip, no per-call cost, no training job required. Cartesia and ElevenLabs are opt-in adapters for operators who prefer managed APIs.

## Decision Dimensions

- `long_term_maintainability: 0.9` — self-hosted services are not subject to upstream deprecation, breaking API changes, or provider exit. The platform's capabilities age with the hardware, not with a vendor's roadmap.
- `governance_compliance: 0.8` — data sovereignty: sensitive voice, text, and decision data never leaves your network by default. Enterprise and regulated-industry operators require this without exception.
- `capacity_utilization: 0.7` — owned hardware is largely a sunk cost. Marginal inference cost on existing GPU infrastructure approaches zero at scale; per-call API pricing compounds indefinitely.
- `blast_radius: -0.7` — reduces blast radius from external dependencies. A vendor outage, rate-limit event, or pricing change cannot take down a self-hosted capability. External adapters are opt-in, not the default failure path.

## Examples

- **Positive:** The TTS feature ships with Chatterbox on `dpf-tts:8000` as the default. Cartesia is an adapter that activates when `TTS_PROVIDER=cartesia` is set in the environment. An operator who wants managed TTS can enable it; an operator who wants full data sovereignty does nothing.
- **Counterexample:** Designing the TTS feature with Cartesia as the primary provider and "self-hosted" as a future stretch goal. The first install ships data to an external API. Every operator who wants self-hosting has to wait for that stretch goal to ship.

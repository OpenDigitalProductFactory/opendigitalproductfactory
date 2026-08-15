---
title: Never Assume — Verify
pageKind: principle
status: published
abstract: Ambiguous terms and requests must be resolved by inspecting the environment, not by matching against project context or prior knowledge.
principleTier: commandment
principleDirection: Inspect observable state before acting on any term or request that could refer to more than one thing.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.7, "speed_to_value": -0.2, "evidence_confidence": 0.85, "evidence_density": 0.75}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Assumption-driven errors cause irreversible actions and eroded trust. Adopters need to know agents will verify before acting.
---

## Rule

When a request uses a term that could refer to more than one thing — a project component, an installed application, an external service, a database record — inspect the environment to establish what the user means before taking any action. Observable state (installed apps, running processes, actual files, live DB records) takes precedence over pattern-matching against project context or training knowledge. A wrong action taken confidently is more costly than one verification step taken first.

## Why

Assumptions collapse ambiguity silently. The agent acts, the user sees an outcome they did not intend, and trust is damaged — sometimes alongside real state (deleted files, wrong startup entries, misconfigured services). The cost of verifying is one tool call and a few seconds. The cost of a wrong assumption can be minutes of recovery, confusion, or a subtler error that goes unnoticed until it causes a downstream failure. Catastrophic outcomes in complex systems almost always trace back to a chain of unchecked assumptions, each individually plausible, collectively wrong.

## Applies To

All agents and humans acting on the DPF platform or its codebase. Applies to: interpreting user requests, naming ambiguous targets (apps, services, DB records, config keys), choosing which of multiple matching items to act on, and inferring intent from partial context. Does NOT mean asking the user to clarify everything — it means checking observable state first. If inspecting the environment resolves the ambiguity, act on what you find. Only escalate to the user when inspection does not resolve it.

## How To Apply

1. **Spot the ambiguity.** Before acting, ask: could this term refer to more than one thing given what I know?
2. **Inspect first.** Check the file system, running processes, database, or installed apps — whichever surfaces are relevant — to see what actually exists.
3. **Act on what you find.** If inspection resolves the ambiguity, proceed. Name what you found so the user can verify you acted on the right thing.
4. **Escalate only if inspection is inconclusive.** If multiple candidates survive inspection and context does not distinguish them, ask the user one targeted question: "I found X and Y — which did you mean?"

## Decision Dimensions

- `schema_grounding: 0.9` — assumptions about DB/schema state are especially dangerous; always query live state.
- `long_term_maintainability: 0.7` — agents that verify build a reliable track record; agents that assume accumulate subtle errors.
- `speed_to_value: -0.2` — verification adds a step. The cost is real but small compared to recovery from a wrong action.

## Examples

- **Positive:** User says "configure codex to auto start." Agent finds both a DPF Codex CLI adapter in the codebase AND an OpenAI Codex desktop app installed at `AppData\Local\OpenAI\Codex\bin\codex.exe`. Agent acts on the installed app — the concrete, observable artifact — not the project reference.
- **Counterexample:** Agent matches "codex" against project context, assumes it means the DPF CLI integration, configures a Docker Compose startup entry for the wrong target. User has to correct it after the fact.
- **Positive:** User says "update the seed." Agent queries live DB for current seed state before writing any migration, rather than assuming the last-read schema is current.

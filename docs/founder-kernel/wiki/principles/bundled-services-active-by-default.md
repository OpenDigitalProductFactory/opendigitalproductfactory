---
title: Bundled Services Active By Default
pageKind: principle
status: published
abstract: Platform-bundled services seed as active. Reserve the "unconfigured" / detect-and-register flow for genuinely external add-ons.
principleTier: core
principleDirection: Anything the installer ships and the platform needs to function is seeded `status: active` and visible/usable immediately. Don't make the admin click Register to approve plumbing.
principleDimensionVector: {"human_cognitive_load": -0.7, "speed_to_value": 0.6, "schema_grounding": 0.4, "long_term_maintainability": 0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - data-model
  - mcp
principlePublic: true
principlePublicRationale: Customer installs expect bundled MCP servers, coworkers, and integrations to work the moment the install is up. Making them click Register first contradicts the zero-click-provider-setup principle and adds friction to core flows.
sources: []
---

## Rule

Platform-bundled services — MCP servers, coworkers, integrations shipped in the installer — must be seeded with `status: "active"` and visible/usable immediately. They are internal plumbing the platform requires to function, not optional third-party add-ons. Reserve the "unconfigured" / "detect and register" flow for genuinely external things the admin chose to add (user-installed Claude plugins, third-party MCP subscriptions, BYO API keys).

## Why

On a fresh install Mark saw "5 new MCP services detected. Review and register." for OpenAI Codex, Filesystem MCP, PostgreSQL MCP, GitHub MCP, and Browser-Use — all bundled by the installer itself. The seed had them as `unconfigured` with the comment "admin activates via Platform > Integrations." Forcing the admin to click Register five times to approve what the platform just installed adds friction to core flows that depend on these services (Build Studio, review-phase verification, hive contribution), contradicts the zero-click-provider-setup principle, and confuses the operator about what is bundled versus what they explicitly added.

## Applies To

In-platform coworkers managing seed data, external coding agents writing migrations and entrypoint SQL, and humans operating fresh installs. Symmetric. Applies to MCP servers in `packages/db/src/seed.ts`, coworkers, default skills, default tool grants, and any other plumbing the installer ships.

## How To Apply

- When seeding anything the platform needs to function, default `status` to `"active"`. Bundled means active.
- Reserve the "unconfigured" / "detect and register" flow for genuinely external things — Claude plugins the admin installed, third-party MCP subscriptions, BYO API providers.
- The `DetectedServicesBanner` (or equivalent post-install notification) should only fire for those genuinely-external things, not for bundled plumbing.
- When introducing a new bundled service, its seed entry should land with `status: "active"` AND the relevant grants in `TOOL_TO_GRANTS` AND any required model/profile data — the install should be functional in one boot.
- If a bundled service legitimately requires admin-supplied configuration before it can run (rare; e.g. an LLM provider that needs an OAuth flow), surface that as a one-action zero-click-provider-setup, not as a detect-and-register dance.

## Decision Dimensions

- `human_cognitive_load: -0.7` — every Register click on bundled plumbing is friction the admin can't avoid and doesn't understand the purpose of.
- `speed_to_value: 0.6` — the install is functional the moment it boots, not after a five-click activation tour.
- `schema_grounding: 0.4` — seeding bundled services correctly is a schema-fidelity question: the seed should describe the reality that the platform ships with them active.
- `long_term_maintainability: 0.3` — fewer manual activation paths means fewer regression points in future installer changes.

## Examples

- **Positive:** Bundled MCP server `mcp__dpf__*` seeds with `status: "active"`, `grants` populated, ready to dispatch tools immediately. The admin's first session shows it as available, not as "pending registration."
- **Counterexample:** Bundled GitHub MCP seeds with `status: "unconfigured"` and a banner asking the admin to "Register". The admin clicks Register; nothing changes from their perspective (no new credentials, no new permissions). The whole step is decorative friction.

## See Also

- `zero-click-provider-setup` (core) — the broader UX contract: after the one mandatory step (OAuth or paste-key), nothing else should require clicks. Bundled services skip even that single step.
- `live-state-over-seed-data` (core) — bundled-active is a seed default, not a runtime override; if an admin disables a bundled service that's a real runtime fact that should be honored.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)

---
status: active
backlog_item: BI-B4BACA27
workroom: WC-0B0295EC
---
# Reviewer model configuration identity convergence

**OBJ-ONE-CONFIG:** A dual-seeded coworker has one effective model configuration.
**OBJ-HONEST-UI:** The model shown and saved by an operator is the model used by threadless dispatch.
**OBJ-CANONICAL-AUTHORITY:** Routing configuration never changes tool grants, TaskRun attribution, or reviewer authority.

| Acceptance | Objective | Verification |
|---|---|---|
| AC-CANONICAL-USES-PIN | OBJ-ONE-CONFIG, OBJ-HONEST-UI | A request addressed to `AGT-WS-PORTFOLIO` consumes the pin saved under `portfolio-advisor`. |
| AC-DETERMINISTIC-PRECEDENCE | OBJ-ONE-CONFIG | Alias and canonical rows resolve in a documented order; a shadowed conflicting row is reported. |
| AC-SECOND-PAIR | OBJ-ONE-CONFIG | The same behavior holds for `AGT-WS-REVIEW` / `change-reviewer`. |
| AC-AUTHORITY-UNCHANGED | OBJ-CANONICAL-AUTHORITY | Tools and durable execution fields remain keyed to the canonical `AGT-*` identity. |

## Problem

DPF deliberately dual-seeds several coworkers. The slug row remains the executable and
configuration identity for legacy consumers, while the `AGT-*` row is the canonical
registry, grant, and attribution identity. `packages/db/src/agent-identity.ts` already
owns the closed slug-to-canonical crosswalk.

The Priority & Models surface lists and saves `AgentModelConfig` under the slug. A
threadless MCP packet resolves the same coworker to its canonical `AGT-*` identity, but
`apps/web/lib/mcp-task-submit.ts` loads model configuration only by whichever row the
prompt resolver happened to return. A visible, successful save can therefore have no
effect on the next routing decision. The operator sees Codex pinned while the TaskRun
continues to route to local Qwen.

This is not a provider-health problem and not a missing schema. It is a boundary bug:
presentation/configuration and execution/authority use different valid forms of one
identity without reconciling them.

## Evidence

On 2026-08-26 the operator saved `portfolio-advisor` to the active Codex provider and
`gpt-5.3-codex`. The following immutable request targeted `AGT-WS-PORTFOLIO`, yet every
recorded route decision selected the local 27B endpoint. Source inspection found the
hot path querying `AgentModelConfig` only by `modelRoutingAgentId`; the shared reverse
map `CANONICAL_AGENT_ID_TO_COWORKER_SLUG` was not consulted.

## Research and benchmarking

- [Backstage entity references](https://backstage.io/docs/features/software-catalog/references/)
  expand compact, human-friendly references to a complete canonical reference before
  protocol/storage use. DPF adopts the same boundary rule: accept either coworker form,
  resolve once, and make the effective key explicit.
- [Kubernetes object names and IDs](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/)
  separates a user-facing name from a server-issued UID while treating different API
  representations as one underlying object. DPF keeps model preference separate from
  canonical execution attribution instead of copying authority to the alias.
- [SCIM Core Schema, RFC 7643](https://www.rfc-editor.org/info/rfc7643/) distinguishes
  a stable service-provider `id` from a client-domain `externalId`. DPF adopts the
  stable canonical/alias distinction and rejects a new parallel identity table.

The design rejects automatic row deletion or a schema migration. Existing installs may
carry either key, and destructive convergence would discard provenance that the current
table cannot audit. Compatibility is handled by an explicit resolver and observable
shadowing until a separately governed data-cleanup design exists.

## Contracts

### CONTRACT-CONFIG-KEY

`resolveAgentModelConfigIdentity(agentIdOrSlug)` returns a stable ordered identity set:

1. the registered slug, when one exists;
2. the canonical `AGT-*` id;
3. the original value only when it is not already represented.

The slug is the preferred configuration key because the seed defaults and the current
operator surface already own that contract. Unknown identities remain unchanged.

### CONTRACT-EFFECTIVE-CONFIG

`selectEffectiveAgentModelConfig(requestedIdentity, rows)` selects the first row in the
ordered set. It returns the selected source identity and any shadowed identities. When a
shadowed row differs in tier, budget, provider, model, capability floor, or context floor,
the result carries an explicit conflict. No caller reimplements precedence.

Reads use a bounded `IN` query over at most three identifiers. Complexity is O(1) per
coworker and does not grow with roster size. The scale ceiling is the closed dual-seed
registry; EP-56AE0F69 owns any later identity-substrate replacement.

### CONTRACT-WRITE

`saveAgentModelConfig` normalizes canonical input to the preferred configuration key.
It updates one authoritative row and does not duplicate the operator's choice onto the
canonical execution identity. Existing canonical-only rows remain readable as fallback.

The Priority & Models projection uses the same resolver as dispatch. If both rows conflict,
the operator sees which legacy row is shadowed and that the preferred configuration wins.

### CONTRACT-AUTHORITY

Only model routing reads the effective configuration. `resolveCanonicalAgentId` continues
to supply `resolvedAgentId` for tool-grant intersection, TaskRun attribution, subject/org
scope, writer narrowing, and approval. No configuration alias becomes an authority alias.

## Scope and blast radius

In scope:

- one shared pure resolver and focused unit tests;
- the Priority & Models read/save path;
- threadless `mcp-task-submit` model requirements;
- regressions for Portfolio Analyst and Change Reviewer dual-seed pairs;
- concise operator copy for a shadowed legacy configuration.

Out of scope:

- provider enablement, credentials, pricing, endpoint health, or model profiles;
- agent registry, tool grants, principals, initiative evidence authority, or TaskRun IDs;
- schema/migration work or bulk deletion of legacy configuration rows;
- BI-47ACE2C7's separate prompt-only semantic-review capability contract.

Expected source paths:

- `apps/web/lib/routing/effective-agent-model-config.ts` and test;
- `apps/web/lib/mcp-task-submit.ts` and test;
- `apps/web/lib/actions/agent-model-config.ts` and test;
- `apps/web/app/(shell)/platform/ai/assignments/page.tsx`;
- `apps/web/components/platform/AgentModelAssignmentTable.tsx` and focused UI test if
  the existing component contract cannot express the warning without one.

## Failure and rollback

Unknown identities fall back to their exact current key. Database errors keep the current
null-config behavior and never relax authority. A conflicting legacy row is informational;
it cannot win over the preferred key silently.

The change is one clean revert. Reverting restores the former single-key lookup without
changing schema or stored data. Any operator save made after deployment remains a valid
slug-keyed `AgentModelConfig` row.


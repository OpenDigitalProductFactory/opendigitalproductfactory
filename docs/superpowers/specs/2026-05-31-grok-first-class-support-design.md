# EP-GROK-001: First-Class Grok Support for Contributors, Build Studio Routing, and MCP/Skills Onboarding

| Field | Value |
| ----- | ----- |
| Status | Draft — initial author draft for review |
| Date | 2026-05-31 |
| Backlog item | To be filed under new Epic `EP-GROK-001` after chief-architect / platform review. Live MCP + kernel query recommended before final BI creation. |
| Epic recommendation | **Create new Epic `EP-GROK-001: First-class Grok support`** (parallel to historical `EP-CODEX-001`). This is a multi-quarter platform expansion of the external coding agent surface and Build Studio dispatch options. Do not shoehorn into existing "AI providers" or "Build Studio lifecycle" epics. |
| Related substrate | `apps/web/lib/work-capsules.ts` (WORK_CAPSULE_EXECUTOR_KINDS), `apps/web/lib/work-capsules/work-capsule-store.ts` (`isExternalLeaseExecutor`), `apps/web/lib/mcp-tools.ts` (provider/ownerProvider enums), `apps/web/scripts/issue-mcp-token.ts`, `scripts/dpf-bootstrap-agent-toolchain.sh`, `packages/dpf-bootstrap/src/...` (compute-plan + wiring), `packages/dpf-skill-pack/` (current Claude/Codex packaging), `apps/web/lib/actions/agent-coworker.ts`, Build Studio dispatch/routing paths, `providers-registry.json` (existing xAI inference entry), skill seeding (`seed-skills.ts`), agent registry. |
| Related specs | [2026-03-15-codex-provider-integration-design.md](2026-03-15-codex-provider-integration-design.md), [2026-03-21-provider-oauth-authorization-code-design.md](2026-03-21-provider-oauth-authorization-code-design.md), [2026-04-08-claude-code-cli-dispatch-design.md](2026-04-08-claude-code-cli-dispatch-design.md), [2026-03-18-ai-routing-and-profiling-design.md](2026-03-18-ai-routing-and-profiling-design.md), [2026-03-20-provider-model-registry-design.md](2026-03-20-provider-model-registry-design.md), [2026-03-25-tool-evaluation-pipeline-design.md](2026-03-25-tool-evaluation-pipeline-design.md) |
| Scope | Symmetric first-class support for Grok (xAI) as an **external coding agent** for contributors (CLI + future desktop), including DPF MCP + full `dpf-platform` skills installation, worktree discipline, Build Studio routing target (`grok-desktop` executor), token issuance, and packaging parity with Claude Code / Codex. Includes necessary enum expansions, bootstrap updates, and seed changes. |
| Out of scope (Phase 1) | Full Grok desktop application (if/when xAI ships one), in-portal Grok coworker personality, replacing existing inference routing for xAI models, mobile Grok integration, custom Grok fine-tunes as first-class platform models. |

---

## Architect Verdict (Initial)

Grok is already present in the **inference provider** registry (`providers-registry.json`) for model calls inside the platform. The missing surface is the **external contributor coding agent** experience that Claude Code and Codex enjoy today:

- Governed DPF MCP bearer token with proper scopes.
- Auto-install of the full `dpf-platform` skill pack (kernel principles, worktree-per-session, evidence-before-diagnosis, pr-with-dco, promote-to-build-studio, etc.).
- First-class appearance as a dispatch / routing target inside Build Studio.
- Work Capsule coordination records (`executorKind`, leases, evidence).
- Bootstrap / fresh-install / worktree wiring experience.

The platform already has a mature, kernel-principle-enforcing contract for external agents (see `EP-CODEX-001` history and the current `dpf-platform` plugin). Adding Grok is mostly **symmetry work** plus a small number of enum and packaging extensions. The risk is under-scoping the "Grok as coding agent" identity vs. "Grok as inference model" — they must remain distinct in the data model and UX.

**Recommendation:** Treat this as a first-class platform expansion under a dedicated epic. Do the enum + MCP tool schema work early (they are the narrow waists), then the packaging and bootstrap story, then the Build Studio routing surface.

---

## 1. Problem

Today the only first-class external coding agents the platform understands are Claude Code and Codex:

- `WORK_CAPSULE_EXECUTOR_KINDS` hardcodes `claude-desktop` and `codex-desktop`.
- `isExternalLeaseExecutor` only special-cases those two.
- Multiple MCP tool schemas (`provider`, `ownerProvider`) only allow `"claude" | "codex"`.
- `issue-mcp-token.ts` only emits snippets for `claude-code` and `codex`.
- The entire `dpf-bootstrap-agent-toolchain.sh` + `@dpf/bootstrap` plan logic only knows how to detect and wire Claude Code + Codex.
- `packages/dpf-skill-pack` only ships `.claude-plugin/` and `.codex-plugin/` directories + corresponding `*.mcp.json`.
- Build Studio / coworker ideate dispatch and routing paths have explicit `claude` vs `codex` branching.
- Contributor onboarding, worktree creation, and "send to Build Studio" flows assume one of the two existing agents.

Grok (via the xAI API and the Grok CLI / future desktop clients) is a natural third major option. Operators and contributors using Grok today have a second-class experience: manual MCP token setup, no governed skill pack, no Build Studio routing target, and no place in the coordination/evidence model.

The inference side already recognizes xAI. The contributor agent side does not.

---

## 2. Goals & Success Criteria

- A contributor running the Grok CLI (or future Grok desktop) on a fresh DPF install can run a single command (or follow a documented one-time setup) and receive:
  - A properly scoped `DPF_MCP_BEARER_TOKEN`.
  - The full modern `dpf-platform` skill pack (all 20+ kernel-enforcing skills).
  - Correct worktree + compose project isolation behavior.
- Grok appears as a first-class option in Build Studio routing / dispatch (alongside Claude and Codex).
- All Work Capsule, evidence, and coordination records correctly attribute work to `grok-desktop` (or equivalent).
- The packaging story in `packages/dpf-skill-pack` treats Grok symmetrically (`.grok-plugin/` or native Grok plugin format + `grok.mcp.json`).
- No regression to existing Claude/Codex paths.
- All changes pass the normal build gate + relevant E2E phases that exercise external agents.

---

## 3. Current State Analysis (Key Narrow Waists)

### 3.1 Executor & Coordination Model
- `apps/web/lib/work-capsules.ts:27` — `WORK_CAPSULE_EXECUTOR_KINDS` is the source of truth.
- `work-capsule-store.ts:102` — `isExternalLeaseExecutor` only returns true for the two desktop kinds + human.
- Multiple MCP tools and handlers validate against these enums.

### 3.2 MCP Tool Schemas
- `apps/web/lib/mcp-tools.ts` contains several places with literal enums:
  - `ownerProvider`
  - `provider`
  - Descriptions that mention "codex or claude".

### 3.3 Token & Snippet Issuance
- `apps/web/scripts/issue-mcp-token.ts` — `McpSnippetFormat` union and all emission logic only knows `claude-code`, `codex`, `vscode`, `raw`.

### 3.4 Contributor Bootstrap & Wiring
- `scripts/dpf-bootstrap-agent-toolchain.sh` (and the PowerShell sibling) + the Node bridge in `packages/dpf-bootstrap`.
- Detection, plugin installation, MCP config emission, and `DPF_MCP_BEARER_TOKEN` persistence are all Claude/Codex-specific.
- `packages/dpf-skill-pack/` contains the canonical skills + the two client plugin manifests.

### 3.5 Build Studio / Coworker Routing
- `apps/web/lib/actions/agent-coworker.ts` has explicit `config.provider === "claude"` branching for ideate model selection.
- Dispatch, evidence, and "external coding agent" paths in the Build Studio orchestrator and work capsule projections hardcode the two known executors.

### 3.6 Inference vs Agent Distinction
- `providers-registry.json` already has an xAI entry for model inference.
- This is **separate** from the external coding agent surface we are adding. Do not conflate the two.

---

## 4. Proposed Design

### 4.1 New Executor Kind
Add `"grok-desktop"` (or `"grok-cli"` — recommend `grok-desktop` for symmetry with the others) to `WORK_CAPSULE_EXECUTOR_KINDS`.

Update:
- `isWorkCapsuleExecutorKind`
- `isExternalLeaseExecutor` (add the new kind)
- All call sites that construct or validate executor kinds
- Test data and E2E fixtures that assert on the set

Consider whether a more generic `external-desktop-agent` + `agentType` column is better long-term, but for parity with the current model, adding the concrete kind is acceptable and lower risk.

### 4.2 MCP Tool Schema Updates
Extend the string enums (or move them to a shared constant) in `mcp-tools.ts`:
- Add `"grok"` to the allowed `provider` / `ownerProvider` values.
- Update descriptions.
- Ensure the TypeScript types and runtime validation stay in sync (they already use the same source in several places).

### 4.3 Token Snippet Support
Extend `McpSnippetFormat` in `issue-mcp-token.ts` with `"grok"`.

Produce a sensible snippet for Grok users, modeled on the Codex pattern (env-var backed `DPF_MCP_BEARER_TOKEN` + reference to Grok's config mechanism, which currently supports `.grok/config.toml` with `[mcp_servers]` and HTTP transport).

Update help text and the switch statement that selects the emitter.

### 4.4 Packaging in `dpf-skill-pack`
Create symmetric structure:

```
packages/dpf-skill-pack/
  .grok-plugin/                 # or plugin.json + skills/ at root if Grok supports direct install
    plugin.json
  grok.mcp.json                 # or document the native config block
  skills/                       # (already shared)
```

Decide between:
- A. Grok-native plugin format (preferred if Grok's plugin system is stable).
- B. A thin `.grok-plugin/` adapter directory that points at the shared `skills/`.

Also ship a `grok.mcp.json` (or equivalent) that uses the same `DPF_MCP_BEARER_TOKEN` env-var pattern the other clients use.

Update `capability-packs.json` and any marketplace manifests if they exist.

### 4.5 Bootstrap & Toolchain Updates
Extend `dpf-bootstrap-agent-toolchain.sh` (and PS1) + the Node plan computer:
- Detect Grok CLI presence (command + config locations).
- Offer to wire the `dpf-platform` skills for Grok.
- Emit appropriate MCP config for Grok's `~/.grok/config.toml` or project `.grok/config.toml`.
- Persist the token using the same `~/.dpf/agent-toolchain.env` + launchctl mechanism.

Add Grok to the "supported agents" matrix in the bootstrap output and docs.

### 4.6 Build Studio Routing & Dispatch
- Extend the provider / executor selection UI and backend logic in Build Studio to offer Grok as a target.
- Update the branching logic in `agent-coworker.ts` (and any equivalent dispatch code) to handle a `"grok"` provider.
- Ensure Work Capsule creation and evidence recording paths accept the new executor kind and surface it correctly in the UI.

### 4.7 OAuth / Credential Considerations
The user specifically called out "the oauth provider within the ai routing and providers section."

Current reality for xAI/Grok (as of 2026-05):
- Primary auth for API usage is API key (bearer token against `https://api.x.ai/v1`).
- There is no widely documented user-facing OAuth consent flow for desktop agents the way Anthropic or OpenAI have for some surfaces.

**Recommendation in the design:**
- Treat the **external coding agent** surface for Grok as API-key driven for Phase 1 (same pattern as current Codex handling in many cases).
- If/when xAI ships a proper OAuth / device-flow / desktop auth experience, add a second `authMethod` option under the Grok agent surface (separate from the existing xAI inference provider entry).
- Do **not** reuse or overload the inference provider OAuth flows for the coding agent identity. Keep the two concerns separate in the data model (`ModelProvider` vs external agent executor + its own credential storage).

Add a clear note in the spec and any related provider docs.

### 4.8 Seeding & Registry Updates
- Ensure any agent registry or "supported external coding agents" seed data includes Grok.
- Update skill assignment seeds if the new Grok path needs different default skill assignments (likely the same `dpf-platform` pack is correct).
- Update any static matrices used in docs, E2E, or admin surfaces.

---

## 5. Implementation Sequencing (Recommended)

**Phase 0 — Foundations (small, high-confidence)**
- Extend `WORK_CAPSULE_EXECUTOR_KINDS` + `isExternalLeaseExecutor` + validation.
- Extend MCP tool enums in `mcp-tools.ts`.
- Extend `issue-mcp-token.ts` with `--format grok`.

**Phase 1 — Packaging & Bootstrap**
- Add Grok packaging to `packages/dpf-skill-pack`.
- Update bootstrap script + plan logic.
- Update `dpf-bootstrap-agent-toolchain` docs and detection.

**Phase 2 — Build Studio Routing & Coordination**
- Wire Grok as a selectable target in Build Studio.
- Update dispatch, evidence, and capsule projection paths.
- Add to relevant UI enumerations.

**Phase 3 — Polish, Seeds, Documentation, QA**
- Seed data, registry entries, E2E updates (including the platform QA plan that explicitly calls out Claude/Codex CLI paths).
- Contributor docs updates.
- Tool evaluation pipeline run if any new external Grok-specific MCP surface is introduced.

---

## 6. Recommended Backlog Items (to be filed under EP-GROK-001)

Once this design is reviewed, create the following initial BIs (suggested titles and rough sizing):

1. **BI-GROK-001** — Add `grok-desktop` executor kind and update all enum consumers + `isExternalLeaseExecutor`.
2. **BI-GROK-002** — Extend MCP tool provider enums and schemas to accept "grok".
3. **BI-GROK-003** — Add `--format grok` support to `issue-mcp-token.ts` with proper snippet emission.
4. **BI-GROK-004** — Create Grok plugin packaging + `grok.mcp.json` in `packages/dpf-skill-pack`.
5. **BI-GROK-005** — Update `dpf-bootstrap-agent-toolchain` (sh + ps1 + Node bridge) to detect and wire Grok.
6. **BI-GROK-006** — Surface Grok as a Build Studio routing / dispatch target and update coworker ideate branching.
7. **BI-GROK-007** — Update seeds, agent registry, and any static matrices for Grok support.
8. **BI-GROK-008** — E2E + platform QA plan updates for Grok external agent paths.
9. **BI-GROK-009** (stretch) — Grok-specific contributor onboarding docs and one-pager.

These can be further decomposed during planning.

---

## 7. Open Questions & Risks

- What is the actual Grok CLI / desktop client reality in mid-2026 for config, plugin installation, and MCP server declaration? (Needs fresh research.)
- Will xAI ever offer a first-party OAuth/device flow suitable for desktop coding agents? Current assumption: API key + env var for Phase 1.
- Should the Grok coding agent surface eventually get its own row in the providers system, or remain a pure "external executor" concept?
- Performance / cost characteristics of using Grok for long-horizon Build Studio tasks vs Claude/Codex (will affect default routing profiles later).

---

## 8. Next Actions (after design approval)

1. File `EP-GROK-001` + the Phase 0 BIs listed above (using live MCP + `dpf-file-backlog-item` once environment is ready).
2. Run a lightweight tool evaluation (EP-GOVERN-002) on any new Grok-specific packaging or MCP surface.
3. Produce the detailed implementation plan for Phase 0 using `dpf-writing-plans`.
4. Begin with the enum + MCP schema changes (lowest blast radius, highest leverage).

---

**Author note:** This design was produced with the explicit goal of giving Grok the same governed, kernel-principle-respecting first-class status that Claude Code and Codex have earned in the platform. Parity first, differentiation later.

Related kernel principles invoked during drafting: `architecture-over-shortcuts`, `single-source-of-truth`, `research-and-use-standards`, `worktree-per-session`, `all-changes-land-via-pr`.

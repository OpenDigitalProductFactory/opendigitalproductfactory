# Per-client configuration conformance — server-authoritative minimal substrate + client-advisory optimization

- **Backlog item:** BI-71310615 — "Per-client configuration conformance across heterogeneous agent clients"
- **Status:** Design (decision-bearing). No code in this document.
- **Author:** Claude (external_coding_agent), 2026-07-24
- **Kernel decision:** `principle_decide` → **Option D** (server default-minimal surface + client-advisory), high confidence, composite 19.333, margin 0.559, interaction **DI-E69521FE6DC4** (ledger in §4). Folds in Option C's unified conformance contract as the shared definition.
- **Coordinates with:** BI-88681BE0 (server-side progressive tool disclosure — gap 2), BI-0020D511 (agent instruction-plane split — Problem 4 is the same token-budget concern), EP-CLIENT-HOOK-PLANE, EP-MCP.
- **Substrate touched at implementation time:** `apps/web/app/api/mcp/v1/route.ts`, `apps/web/lib/mcp/{tool-tier,caller-client,pack-registry}.ts`, `apps/web/lib/tak/agent-grants.ts`, `packages/dpf-skill-pack/hooks/`, `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`, `packages/dpf-bootstrap/`.

---

## 0. The question, answered in three sentences

*How do we ensure each client (Claude Code, Codex, Grok, Antigravity, in-portal coworker, a customer's own agent) is configured to use DPF's own skills, avoid conflicting skills, and not over-expose the ~26k-token tool catalog before executing?*

**DPF already owns most of the substrate** — per-client plugin manifests, a bootstrap toolchain that even disables competing plugins, an operator-selectable `?tier=core` surface, DPF-over-generic precedence doctrine, and a SessionStart process-spine health check. The problem is not missing machinery; it is that **the machinery is client-side and opt-in, so it cannot bind the clients DPF does not control** (a customer's own agent, or any misconfigured CLI). The fix the kernel selected is to **move the load-bearing guarantee to the server**: default every caller to a minimal tool surface and widen only on a proven identity+capability handshake, while the existing client-side adapters stay as local optimization. One declarative per-client conformance profile becomes the shared source of truth both planes read.

---

## 1. What already exists (verified 2026-07-24 — reuse, do not rebuild)

Per `ground-new-work-in-existing-platform` and `dpf-verify-substrate-first`, the substrate was mapped against the live tree before any new component was proposed.

| Concern | Existing substrate | Path |
|---|---|---|
| Per-client registration | Single-source `SKILL.md` fanned to per-client plugin manifests (Claude / Codex / Grok / Antigravity), each with its own `*.mcp.json` shape | `packages/dpf-skill-pack/.{claude,codex,grok,antigravity}-plugin/` |
| Client bootstrap | Detects CLIs, mints MCP token, computes `AgentToolchainPlan`, applies per-client writes; **already disables competing Codex plugins** ("generic-client convergence") | `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`, `packages/dpf-bootstrap/src/agent-toolchain/cli/compute-plan.ts` |
| Token onboarding | Per-client snippet formats (`claude-code\|codex\|grok\|antigravity\|vscode\|raw`) | `apps/web/scripts/issue-mcp-token.ts`, `apps/web/lib/auth/mcp-setup-snippets.ts` |
| Progressive disclosure | Operator-selectable core tier (~22 tools) via `?tier=core` | `apps/web/lib/mcp/tool-tier.ts`; spec `docs/superpowers/specs/2026-06-20-mcp-tool-tier-deferred-loading-design.md` |
| Conflict avoidance | DPF-over-generic precedence + `composesFrom` chain + SessionStart process-spine check | AGENTS.md §16, `packages/dpf-skill-pack/hooks/process-spine-health-check.mjs`; spec `2026-07-19-process-spine-skill-exposure-health-design.md` |
| Tool-surface scoping | Grant + scope + tier filtered per token | `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/mcp/pack-registry.ts`, `route.ts` `handleToolsList` |
| Client attribution | User-Agent parsed for decision-ledger attribution | `apps/web/lib/mcp/caller-client.ts` `deriveCallerClient()` |
| Readiness | Contributor MCP readiness statuses | `apps/web/lib/mcp/contributor-readiness.ts`; spec `2026-05-26-contributor-client-mcp-readiness-design.md` |

**The headline:** this is a mature, explicitly-multi-client substrate. The design below adds *no new retrieval engine, no new plugin format, no new bootstrap* — it closes five gaps in what exists.

## 2. The five gaps (the actual work)

1. **No handshake client identity → no per-client policy.** `route.ts` `handleInitialize` negotiates protocol version but **discards `params.clientInfo`**. The only runtime client signal is the User-Agent, used for audit only (`deriveCallerClient`). The server cannot vary behaviour by *which* client connected.
2. **Substrate exposure is grant/scope-gated but NOT client-gated, and tiering is opt-in + discovery-only.** Every token dumps its full granted surface (~26k tokens) unless the operator hand-appends `?tier=core`; `tools/call` executes any granted tool regardless of tier; the model-driven Phase-2 deferral is design-only. There is **no default-on minimal surface** — this is the "over-expose before executing" gap, and it is the same concern as BI-88681BE0.
3. **Conflict-cleanup adapters exist only for Codex.** DPF-over-generic precedence is doctrine; the only runtime enforcement is the SessionStart process-spine check (warn/`unknown` when a client can't expose skill state) and Codex-only plugin disabling. On Claude / Grok / Antigravity an external marketplace pack can **shadow a DPF skill undetected**.
4. **No registration/conformance contract for "a customer's own agent."** Every first-class wiring path is enumerated per known CLI. A customer-built agent has no client-kind to target and no capability profile.
5. **No single per-client conformance verdict.** Readiness is split across `contributor-readiness.ts`, the bootstrap banner, the process-spine check, and two hook planes (`.claude/settings.json` branch-versioned + `hooks/hooks.json` branch-independent). There is no one "is client X fully & correctly configured for DPF?" answer.

## 3. Why this is the right frame

The clients DPF can configure client-side (its own Claude Code / Codex / Grok bootstrap) are exactly the ones **least** at risk — they run the bootstrap, get precedence wiring, and pass the process-spine check. The clients most at risk — a customer's own agent, or any CLI that skipped the bootstrap — are precisely the ones a client-side mechanism **cannot** reach. A guarantee that lives only client-side protects the already-safe and misses the exposed. The load-bearing guarantee must therefore sit where every client is forced to pass: **the MCP server**.

## 4. The decision, routed through the kernel

`principle_decide` (`callingPopulation: external_coding_agent`, structured coverage **strong**, 36 principles, no commandment conflict), four architecturally-distinct enforcement models:

| Option | Composite | |
|---|---|---|
| **D — Server default-minimal surface + client-advisory** | **19.333** | **recommended, high confidence** |
| C — Unified conformance contract + verdict (both planes) | 18.774 | close second |
| A — Server client-identity policy | 16.642 | |
| B — Client-side bootstrap adapters only | 13.527 | |

**Margin D→C = 0.559** (> tieMargin). Interaction **DI-E69521FE6DC4**.

**Where D wins (contribution delta vs C):** *Least privilege, deny by default* (+0.087), *Never trust input — validate* (+0.088), *Never adopt an unvetted external tool* (+0.093), *Outbound and irreversible actions require approval* (+0.069), *Never hardcode secrets* (+0.094). Every discriminator is a **security/safety commandment** — the kernel is saying: the substrate an untrusted agent can see before it proves itself must be minimal by default. That is precisely "don't over-expose before executing."

**Reading:** D and C are close and complementary. **D is the enforcement spine** (server default-deny on surface breadth), **C is the shared definition** (one declarative per-client conformance profile). B lost because a client-side-only guarantee cannot bind customer agents; A lost because identity *policy* without a *default-minimal floor* still leaks the full surface to an unrecognized client. **Decision: implement D, with C's unified conformance profile as the shared contract both planes consume.**

## 5. The design

### 5a. Server plane (the hard gate — new guarantee)

- **Read `clientInfo` at `initialize`.** Record `clientInfo.name`/`version` (+ the existing User-Agent) as the caller's **client identity**, persisted on the session and passed into `governedExecuteTool` alongside the current `callerClient`. This is the missing input for every per-client decision (gap 1).
- **Default every caller to the core tier.** Flip the default: `tools/list` returns the ~22-tool core surface **unless** the caller has proven conformance for a wider surface. `?tier=core` stops being an opt-in and becomes the floor; the full catalog is opt-*out*, earned. Grants remain the hard ceiling (a caller never sees a tool it lacks a grant for); the tier is a second, client-scoped narrowing *below* the grant ceiling (gaps 2, 4). This is the concrete server-side realization BI-88681BE0 was filed for — **this design and BI-88681BE0 converge here; they should be built as one server change.**
- **Widen on a proven identity+capability handshake.** A recognized, conformant client (Claude Code with the DPF plugin installed and the process-spine check green; a customer agent that has completed the conformance handshake) is granted its full *granted* surface. An unrecognized or non-conformant caller stays on the core floor — it can still work, just from the minimal surface, and asks for more via the (Phase-2) `load_tools` deferral. **Fail-safe direction is closed: unknown ⇒ minimal.**

### 5b. Client plane (advisory optimization — extend what exists)

- **Extend the Codex-only convergence to all client adapters.** The bootstrap already disables competing Codex plugins; generalize `compute-plan.ts` so Claude / Grok / Antigravity get the same DPF-skill-precedence wiring and a conflict-cleanup pass (detect a duplicate skill slug/trigger between DPF and an installed external pack; disable-not-delete, emit the existing `SkillSeedWarning`) (gap 3).
- **Make the process-spine check the client-side conformance signal.** It already runs at SessionStart; have it emit the client's half of the conformance verdict (§5c) rather than only a warn/`unknown`.

### 5c. The shared contract (C, folded in)

- **One declarative per-client-kind conformance profile** — for each client kind (`claude-code`, `codex`, `grok`, `antigravity`, `coworker`, `external-agent`): how it registers tools, which instruction plane it loads, its default disclosure tier, and its conflict policy. Reuse the `contributor-readiness.ts` status shape; do not invent a new one.
- **One conformance verdict**, computed from the server signal (identity + handshake) and the client signal (process-spine + bootstrap), surfaced as a single per-client answer. The server reads it to decide the surface; the operator reads it to know a client is correctly set up (gap 5).

### 5d. How each concern in the question is answered

| Concern | Answer |
|---|---|
| *Use DPF's own skills* | Client adapters wire DPF-over-generic precedence on **all** clients (not just Codex); the process-spine check verifies it at SessionStart and feeds the verdict. |
| *Not use conflicting skills* | Conflict-cleanup pass in every client adapter (disable-not-delete + `SkillSeedWarning`); the verdict goes non-conformant if an external pack shadows a DPF skill. |
| *Not expose too much substrate before executing* | **Server** defaults every caller to the core tier; the full catalog is earned by a conformance handshake. Untrusted/customer agents are bounded **by default**, not by their own goodwill. |
| *Each client's own registration nuances* | The per-client conformance profile encodes each client's registration/instruction/disclosure shape as data; the bootstrap and server both read it — one contract, N client shapes. |

## 6. Coordination

- **BI-88681BE0 (server-side progressive tool disclosure)** is gap 2 and §5a's default-minimal surface. **They are the same server change — merge the two, or make BI-88681BE0 the server-plane child of this BI.** Do not build two disclosure mechanisms.
- **BI-0020D511 (instruction-plane split), Problem 4** raised the identical "~26k tool schema before any work" number; this design is where that half lands. The instruction-plane epic shrinks the *instruction* preamble; this shrinks the *tool* preamble. Same budget, two planes.
- **Existing specs to extend, not duplicate:** `2026-05-26-agent-toolchain-bootstrap-design.md` (client plane), `2026-05-26-contributor-client-mcp-readiness-design.md` (the readiness shape to reuse for the verdict), `2026-06-20-mcp-tool-tier-deferred-loading-design.md` (Phase 2 `load_tools` is the widen-on-demand mechanism), `2026-07-19-process-spine-skill-exposure-health-design.md` (the client-side conformance signal).
- **Likely warrants its own epic.** Five gaps across two planes is a program; recommend promoting BI-71310615 to an epic with a child BI per gap, or nesting under EP-CLIENT-HOOK-PLANE / EP-MCP. Triage call.

## 7. Phased plan

**Phase 1 — Server identity + default-minimal surface (merge with BI-88681BE0).** Read/record `clientInfo`; make the core tier the `tools/list` default below the grant ceiling; widen only for a recognized-conformant caller. Acceptance: an unrecognized caller receives the core surface, not the full ~26k-token catalog; a conformant Claude Code session is unchanged; grants still cap everything.

**Phase 2 — The conformance profile + verdict (C).** Declarative per-client-kind profile; one verdict computed from server + client signals, reusing the contributor-readiness shape. Acceptance: a single verdict per client kind, consumed by both the server (surface decision) and the operator (readiness UI).

**Phase 3 — Client-plane convergence for all clients.** Generalize the Codex-only convergence + conflict-cleanup to Claude / Grok / Antigravity in `compute-plan.ts`; the process-spine check emits the client half of the verdict. Acceptance: an external pack that shadows a DPF skill is detected + disabled on every client surface, and flips the verdict.

**Phase 4 — The customer-agent contract.** A documented client-kind + capability handshake a customer-built agent targets to earn a wider surface; defaults to the core floor until it does. Acceptance: a customer agent connects, gets the minimal surface, completes the handshake, and earns exactly its granted surface — never more.

## 8. Design research + open questions

- **Kernel:** `principle_decide` DI-E69521FE6DC4 (§4). Substrate map: live tree, 2026-07-24 (§1).
- **Convergent field pattern:** progressive tool disclosure as the 2026 default MCP posture (Anthropic Tool Search + Programmatic Tool Calling GA) — DPF's Phase-2 `load_tools` is the same shape; this design makes the *default* minimal rather than leaving disclosure opt-in.
- **Open questions for review:**
  1. Should the core-tier default be **global** (every caller) or scoped to **non-Claude-Code** callers first (Claude Code already defers client-side, so the regression risk is lowest elsewhere)?
  2. Promote BI-71310615 to its own epic, or nest under EP-CLIENT-HOOK-PLANE / EP-MCP?
  3. Merge BI-88681BE0 into Phase 1, or keep it as the named server-plane child?
  4. For a customer agent, is the conformance handshake a DPF-issued capability token (server-verifiable) or an attestation the operator approves — i.e. how much do we trust a customer agent's self-declaration?

# Plan — Plugin-native hook distribution (MCP + skills + hooks = one install unit)

- **Date:** 2026-06-19
- **Backlog item:** **BI-CA0ED781** — *Plugin-native hook distribution* under **EP-CLIENT-HOOK-PLANE** (filed 2026-06-19; WWMD-ratified `keystone-move`, composite 8.10 / margin 1.31 / high confidence)
- **Epic:** EP-CLIENT-HOOK-PLANE — "DPF Client Hook Plane — six lifecycle-event hooks for the DPF client (β-then-γ phasing)"
- **Author:** Claude Code (founder request, Mark — 2026-06-19)
- **Status:** Draft for founder approval (plan-first; build gated on go)
- **Composes with:** BI-A56D77B6 (plane Phase-1 spec), BI-08FD3CAC (hook-launcher refactor)

---

## 1. Goal

Make DPF natively supported in Claude through **one plugin** that bundles all three legs of the agent toolchain — **MCP setup, skills, and hooks** — so the full governance layer installs and updates as a single unit across every surface, not just inside the Claude Code monorepo checkout.

This plan covers the **packaging keystone only**: folding the *existing* governance hooks into the `dpf-platform` plugin. The six *new* lifecycle hooks in EP-CLIENT-HOOK-PLANE are out of scope here (Section 9) — but this plan decides **where client hooks live**, which every one of them inherits.

## 2. Current state (verified 2026-06-19)

The `dpf-platform` plugin (`packages/dpf-skill-pack`, marketplace `dpf-platform-local`) already bundles two of three legs:

| Leg | In the plugin? | Mechanism |
|---|---|---|
| **Skills** | ✅ Yes | `plugin.json` → `skills: ./skills/` — 28 dual-surface skills |
| **MCP** | ✅ Yes | `plugin.json` → `mcpServers: ./claude.mcp.json` (+ `codex.mcp.json`, `grok.mcp.json`) |
| **Hooks** | ❌ **No** | Live in repo `.claude/settings.json` → `scripts/hooks/*.mjs` via `${CLAUDE_PROJECT_DIR}` |

`plugin.json` has **no `hooks` field**, and there is no `packages/dpf-skill-pack/hooks/` directory. The plugin's own `README.md` already names hooks as belonging "inside it" but lists them as **"future."**

**Hooks wired today in `.claude/settings.json`:**

| Event | Matcher | Hook | Script | Purity |
|---|---|---|---|---|
| PreToolUse | `Bash` | lease-guard (deny ungoverned dev-servers; BI-4043A64B) | `scripts/hooks/lease-guard.mjs` | **Pure** — stdin payload + env only |
| PreToolUse | `Write\|Edit\|MultiEdit` | ux-fit-precheck (cognitive-load nudge; BI-65DEE968) | `scripts/hooks/ux-fit-precheck.mjs` | **Pure** — decides on `tool_input` |
| PreToolUse | `Write\|Edit\|MultiEdit` | spec-plan-doc-precheck (process-spine nudge) | `scripts/hooks/spec-plan-doc-precheck.mjs` | **Pure** — decides on `tool_input` |
| PostToolUse | (all) | transcript-snapshot (async) | `run-hook.mjs → scripts/safety/transcript-snapshot.{ps1,sh}` | Repo + OS-coupled |
| SessionEnd | — | transcript-snapshot + session-reaper | `run-hook.mjs → scripts/{safety,hooks}/*.{ps1,sh}` | Repo + OS-coupled |

**Consequence of the gap:** because `.claude/settings.json` travels with the *repo* (not the plugin) and is Claude-Code-only, the governance guards reach **only** monorepo Claude Code sessions. A standalone plugin install (`update-agent-toolchain` → `~/.agents/plugins/`) and the Codex/Grok surfaces inherit skills + MCP but **none** of the guards.

## 3. Key facts that shape the design

1. **Authoritative plugin-hook mechanism** (Claude Code docs, confirmed via claude-code-guide): a plugin declares hooks in `hooks/hooks.json` (or inline in `plugin.json`), references bundled scripts with **`${CLAUDE_PLUGIN_ROOT}`** (exec form preferred — `command` + `args` array — for space-safe paths), and **`${CLAUDE_PROJECT_DIR}` is also available** inside plugin hooks.
2. **Plugin hooks and `settings.json` hooks BOTH fire** — merged, priority-ordered, *not* overridden. → The migration must be a **MOVE, not a copy**, or every migrated hook double-fires (lease-guard would deny twice; prechecks would nudge twice).
3. **The three PreToolUse hooks are pure** — they decide entirely from the stdin tool payload and `process.env`; no repo paths. They port into `${CLAUDE_PLUGIN_ROOT}/hooks/` with zero logic change.
4. **The lifecycle hooks are repo/OS-coupled** — `.ps1`/`.sh` scripts dispatched by `run-hook.mjs`, tied to the repo's compose/worktree/transcript layout; they no-op gracefully when their target script is absent.
5. **Trust asymmetry** — `settings.json` hooks fire unconditionally for the trusted project; **plugin hooks require the plugin enabled + workspace-trusted.** The DPF repo already enables it by default (`enabledPlugins: { "dpf-platform@dpf-platform-local": true }`), but this must be **functionally verified**, not assumed.
6. **A conformance test already guards the hooks' presence** — `scripts/hooks/settings-hooks-wired.test.mjs` fails CI if the two prechecks leave `settings.json`. Moving them **requires retargeting that drift guard** to the plugin, or it red-flags the very migration we intend.

## 4. Recommended architecture

**Split by portability, move only the pure guards now.**

- **Move** the three pure PreToolUse guards (lease-guard, ux-fit-precheck, spec-plan-doc-precheck) into the plugin: copy scripts to `packages/dpf-skill-pack/hooks/`, declare them in `packages/dpf-skill-pack/hooks/hooks.json` via `${CLAUDE_PLUGIN_ROOT}`, and **remove the same three** from `.claude/settings.json` PreToolUse.
- **Keep** PostToolUse + SessionEnd lifecycle hooks in `.claude/settings.json` for now (repo-resident, `${CLAUDE_PROJECT_DIR}`). This yields a **clean event split with zero matcher overlap** → no double-fire. Their eventual home is decided in the plane spec (BI-A56D77B6), alongside the six new lifecycle hooks that share the same question.
- **Retarget** `settings-hooks-wired.test.mjs` → a `plugin-hooks-wired.test.mjs` that asserts the plugin's `hooks.json` wires the three guards (the drift guard travels with the hooks).
- **Net behavior for the monorepo Claude Code contributor is unchanged** (same guards fire); the *win* is that the guards now travel with the portable, multi-surface plugin instead of being repo-and-Claude-only.

Why not move the lifecycle hooks too, now? They are OS-specific scripts intrinsically tied to repo compose/worktree state, they only matter when the repo is present, and their relocation is a larger decision best made once for all lifecycle hooks in the plane spec. Moving them here would inflate scope and risk the snapshot/reaper paths for no portability gain (they are meaningless outside a repo).

## 5. Phased implementation

**Phase 0 — Pre-flight (no code).** Confirm the plugin is enabled + trusted such that a plugin-provided hook actually fires in this install (functional probe with a throwaway PostToolUse echo hook). If plugin hooks do **not** fire by default, stop and escalate — the whole approach depends on it. *(Gate: a plugin hook observably runs.)*

**Phase 1 — Bundle the three guards into the plugin.**
- Create `packages/dpf-skill-pack/hooks/` and copy `lease-guard.mjs`, `ux-fit-precheck.mjs`, `spec-plan-doc-precheck.mjs` (verbatim; they are pure).
- Author `packages/dpf-skill-pack/hooks/hooks.json` with the two PreToolUse matchers (`Bash`; `Write|Edit|MultiEdit`) using exec form: `command: "node"`, `args: ["${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"]`.
- Add `"hooks": "./hooks/hooks.json"` to `packages/dpf-skill-pack/.claude-plugin/plugin.json` (and the Codex/Grok manifests if their hook field differs — confirm per their plugin schema).
- Keep the existing unit tests for the three hooks; point them at the new path (logic unchanged).

**Phase 2 — Remove the duplicates from `.claude/settings.json`.**
- Delete the three PreToolUse hooks from `.claude/settings.json`; leave PostToolUse + SessionEnd intact.
- Retarget the conformance test to assert plugin-side wiring; keep it failing-closed (missing guard → red CI).

**Phase 3 — Make it travel (install/update path).**
- Update `packages/dpf-bootstrap` so the install/worktree-seed flow accounts for the plugin now carrying hooks (the plugin install already happens via `claude-plugins.ts`; verify nothing separately re-injects the moved hooks into `settings.json`).
- Update `packages/dpf-skill-pack/README.md` (drop "future" → document the `hooks/` bundle), AGENTS.md §16 (plugin is the home for skills + MCP + **hooks**), and the standalone `update-agent-toolchain` note.

**Phase 4 — Functional verification (the real gate).**
- Trigger a `pnpm dev` Bash call in a session where the hooks live **only** in the plugin and confirm lease-guard **denies** it (and that `DPF_ALLOW_UNGATED_SERVER=1` bypasses).
- Trigger a `Write` to a new `apps/web/lib/*.ts` and a `.tsx` with an `<input>` and confirm the two precheck nudges still surface.
- Confirm **no double-fire** (each guard fires once).
- Record evidence per AGENTS.md §6, naming the substrate.

## 6. The conformance-test + trust trade-off (explicit)

Moving the guards out of `settings.json` trades a small amount of belt-and-suspenders robustness (unconditional project hooks) for portability + single-unit packaging. Mitigations: (a) Phase 0 proves plugin hooks fire by default in the DPF install; (b) the retargeted conformance test keeps drift failing-closed; (c) Phase 4 functionally proves the guard denies from the plugin. If Phase 0 shows plugin hooks are *not* reliably enabled, the fallback is to keep the guards in `settings.json` and treat "plugin carries hooks" as the standalone/Codex/Grok distribution path only — documented, not silently dropped.

## 7. Research & benchmarking (per AGENTS.md §10)

- **Claude Code plugins** — official docs: hooks bundle via `hooks/hooks.json` + `${CLAUDE_PLUGIN_ROOT}`; hooks from plugin and settings merge (both run). Pattern adopted: exec-form command hooks for path safety; move-not-copy to avoid double-fire.
- **Codex plugins** — per the plugin README's 2026-05-26 research, Codex plugins also bundle hooks; this plan keeps the Codex/Grok hook decision behind confirmation of each client's hook schema (thin-adapter discipline, AGENTS.md §17) rather than assuming parity.
- **Anti-pattern rejected:** copying hooks into the plugin while leaving them in `settings.json` (the "belt-and-suspenders" instinct) — the docs are explicit that both fire, so this doubles every guard.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Plugin hooks don't fire (not enabled/trusted) | Phase 0 functional probe before any move; fallback documented (§6) |
| Double-fire from residual `settings.json` entries | Phase 2 deletes them; Phase 4 asserts single-fire |
| `${CLAUDE_PLUGIN_ROOT}` path changes on plugin update mid-session | Exec form + plugin re-resolves on `/reload-plugins`; documented gotcha |
| Conformance test red-flags the migration | Retarget it to the plugin in the same PR (Phase 2) |
| Codex/Grok hook schema differs from Claude | Confirm per-client before wiring; thin-adapter (§17), don't assume parity |
| Lifecycle hooks accidentally double-handled | They stay put this PR; no overlap with the moved PreToolUse set |

## 9. Out of scope (deferred, named — no silent caps)

- The **six new lifecycle hooks** (SessionStart memory-load, PreCompact save-state, Stop session-summary, PostToolUse governance-capture, two new PreToolUse guards, SessionEnd learning-prompt) — the rest of EP-CLIENT-HOOK-PLANE.
- **Relocating the lifecycle hooks** (transcript-snapshot, session-reaper) into the plugin — decide in the plane spec (BI-A56D77B6) for all lifecycle hooks at once.
- The **hook-launcher `--may-block` + `dpf-mcp-call` wrapper** refactor (BI-08FD3CAC).
- Outbound HTTP webhooks (a different, runtime-integration concern; not this plugin packaging).

## 10. Open decisions for the founder

1. **Scope confirmation:** ship the keystone (move the 3 pure guards into the plugin) as one PR, deferring the 6 new hooks + lifecycle relocation? *(Recommended.)*
2. **Codex/Grok parity now or later:** wire the moved hooks into the Codex/Grok plugin manifests in this PR, or keep this PR Claude-Code-only and fan out to the other surfaces once each client's hook schema is confirmed? *(Recommended: Claude-Code-first, fast-follow the others.)*

---
status: active
---

# An unproven process spine carries the operating contract inline

Backlog item: BI-545943EE (epic EP-AUTONOMOUS-DECIDE).

## 1. Problem

At session start the process-spine health check prints:

```
DPF-native replacement skills installed: OK (5/5).
DPF-native replacement skills loaded/exposed in this session: UNKNOWN - ...
Plain-language fix: restart the client after bootstrap; ...
```

On Claude Code, Codex and Antigravity the second line is **always** UNKNOWN.
Those clients have no skill-exposure adapter
(`packages/dpf-skill-pack/hooks/process-spine-health-check.mjs:11-24`), so
the check cannot run to a verdict on the three most-used clients. The banner
opens with "OK", and the only advice is a restart that cannot change the
answer. Session 156da776 (2026-09-22 to 09-24) received exactly this banner,
invoked no DPF skill and ran no `wiki_query` for two days, and proposed
rebuilding a rule already shipped in PR #5291. This session received the same
banner on 2026-09-24.

The detection is honest; the disposition is not. `severity` is already `warn`
for UNKNOWN (`:135-139`). But the output reads as healthy, and it carries
nothing to replace the doctrine the skills would have supplied. The platform
holds its gates to "a check that could not run is not a verdict" (AGENTS.md
§4). The process spine should meet the same standard.

## 2. What exists (origin/main 99ca786b)

- Hook: `process-spine-health-check.mjs`. It is wired as a SessionStart
  command in `hooks/hooks.json:116-134`. In `--hook` mode it emits
  `hookSpecificOutput.additionalContext` when severity is not `ok` (`:256-267`).
  Rendering happens in `renderProcessSpineSummary` (`:168-211`).
- Tests: `process-spine-health.test.mjs`, 7 tests. Test 5 matches `/UNKNOWN/`
  on the summary only. Nothing runs the `--hook` output on the UNKNOWN path.
- One-line rule statements that already exist, and so are the single source:
  - `principleDirection` frontmatter of
    `principles/decisions-belong-to-their-scope`,
    `principles/escalation-is-a-gate-not-a-trust-tier` and
    `principles/consult-scopes-before-asking`. The bootstrap memory seed
    already reads this field (`dpf-bootstrap/src/agent-toolchain/memory-seed.ts:195-211`).
  - AGENTS.md §11 line 138: "Kernel principles (Surface C) are the durable
    doctrine store. `wiki_query` for lookup, `principle_decide` for
    decisions." No principle page states the "wiki_query before inferring
    from source" rule. AGENTS.md is its home, and this design points at it
    rather than writing a page.
- Derived-artifact gate: `scripts/derived-artifacts-gate.mjs` regenerates
  registered artifacts at pre-commit and fails CI on drift. The doc index
  already uses it.
- Versioning: a hook change reaches clients only with a plugin manifest bump
  (all four manifests plus `PROCESS_SPINE_VERSION`, as commit 5c305027048 did).

Considered and rejected: putting the contract in the MCP server's
initialization instructions (`apps/web/lib/mcp/agent-host-instructions.ts`).
That would reach every client without a hook, but the instructions are
already truncated in the client (observed in this session: `… [truncated]`
inside the organization context). Adding text there is not reliably delivered
text.

## 3. Design

### 3.1 UNKNOWN never reads as healthy

`renderProcessSpineSummary` leads with one verdict line derived from
severity and exposure:

- `Process spine: VERIFIED` when exposure is verified and complete. In
  `--hook` mode this path prints nothing, as today.
- `Process spine: UNPROVEN — this client cannot show DPF which skills are
  loaded, so DPF skills may be absent. The operating contract follows inline.`
- `Process spine: BROKEN — …` when skills are missing on disk or exposure is
  verified-missing.

The detail lines follow, and the "installed: OK" line is no longer first. The
restart advice appears only where a restart can change the answer, which is
BROKEN. For UNPROVEN a restart cannot help, and saying it can is itself
misleading.

### 3.2 The contract arrives inline when exposure is unproven

When the verdict is UNPROVEN or BROKEN, `--hook` appends:

```
Operating contract (inline because DPF cannot prove its skills are loaded):
- principles/decisions-belong-to-their-scope: <principleDirection>
- principles/escalation-is-a-gate-not-a-trust-tier: <principleDirection>
- principles/consult-scopes-before-asking: <principleDirection>
- AGENTS.md §11: <the line-138 bullet>
Before inferring doctrine from source, read the page: wiki_query <slug>.
```

The last line is fixed template text, not doctrine: it tells the reader how to
dereference the slugs above.

The text is **generated**, never hand-written. A generator,
`packages/dpf-skill-pack/scripts/generate-operating-contract.mjs`, reads the
three pages' `principleDirection` and the AGENTS.md bullet by its bold anchor.
It writes `hooks/operating-contract.generated.mjs`, a module exporting the
lines. The file is registered with the derived-artifact gate, so an edit to
any source page regenerates it at commit and CI fails if it drifts. The plugin
ships the generated module. The hook reads no repo files at runtime, which
matters because consumer installs carry no `docs/`.

### 3.3 Tests

In `process-spine-health.test.mjs`:

- Runs `main()` with `--hook` and no exposure evidence. It asserts valid JSON,
  a first line of `Process spine: UNPROVEN`, the absence of the literal text
  `Process spine: VERIFIED`, and all four contract entries present.
- UNPROVEN carries no restart advice. BROKEN does.
- The verified path emits nothing in `--hook` mode (unchanged).
- The generated module equals a fresh generation (the derived-artifact check).

### 3.4 Release

Bump the four plugin manifests and `PROCESS_SPINE_VERSION`, as commit
5c305027048 did, so bootstrap plans the upgrade. Also correct the stale
marketplace entry (`.claude-plugin/marketplace.json` lists 0.2.1).

## 4. Research and benchmarking

| System | Mechanism | DPF adopts | DPF rejects |
|---|---|---|---|
| Kubernetes readiness probes and Nagios/Icinga states | UNKNOWN is a distinct state from OK and is never folded into it | UNPROVEN as its own verdict, first on the page | Nothing |
| Claude Code `SessionStart` `additionalContext`, Cursor rules, Copilot instructions | Context injected into the model at session start | Injecting the rule text itself when the skill carrying it cannot be proven loaded | Always-on injection of large rule text. It is injected only when the spine is unproven, and kept to four generated lines |
| Generated-code drift checks (protobuf/OpenAPI `generate && git diff --exit-code`) | A generated artifact is checked against its sources in CI | The derived-artifact gate over the generated contract | Hand-maintained copies |

## 5. Acceptance criteria

- **AC-PS-01** On a client that cannot report skill state, the session context
  starts with `Process spine: UNPROVEN` and carries the four-line operating
  contract.
- **AC-PS-02** The contract text is generated from the three kernel pages and
  AGENTS.md §11, and the derived-artifact gate fails on drift.
- **AC-PS-03** A test covers the `--hook` UNPROVEN output, not only the
  summary.
- **AC-PS-04** Live: after the plugin upgrade, a fresh Claude Code session on
  this host shows UNPROVEN plus the contract in its SessionStart context.

## 6. Out of scope

Re-checking exposure at the first governed write. The server cannot observe
a client's loaded skills either, so a later check would only repeat the same
UNKNOWN. Fixing the disposition covers the risk that re-check was meant to
cover.

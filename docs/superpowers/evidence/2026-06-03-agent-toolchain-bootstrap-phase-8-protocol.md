---
title: Agent toolchain bootstrap — Phase 8 operator-driven verification protocol
status: ready-to-run
author: Claude (Opus 4.7)
date: 2026-06-03
backlog:
  - BI-4B17051B
epics:
  - EP-INSTALL-HARDENING-2026-05-23
related:
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md
  - docs/operations/install.md
prs:
  - "#1223 Phase 1+2 planning library (merged)"
  - "#1230 Phase 3 Windows wiring (merged)"
  - "#1233 Phase 4 POSIX wiring (merged)"
  - "#1236 Phase 5 live probes (merged)"
  - "#1429 Phase 6 idempotence + drift (open)"
  - "#1431 Phase 7 docs slice (open)"
---

# Agent toolchain bootstrap — Phase 8 verification protocol

The Phase 8 contract from the implementation plan: confirm a clean macOS arm64 and Ubuntu 22 LXD install reaches `readinessState: ready` with both CLIs + token, that re-running is a true no-op, and that the install banner contains no substrate names or command snippets.

Windows was functionally verified live during Phase 5 / Phase 6 on the operator's machine (see PR #1429 commit body for the live banner output and persisted state-file excerpt). Ubuntu structural smoke is automated via [`.github/workflows/agent-toolchain-bootstrap-smoke.yml`](../../../.github/workflows/agent-toolchain-bootstrap-smoke.yml). What's left, and what this protocol covers:

1. **macOS arm64 happy-path** — real Claude Code CLI + real Codex CLI + real DPF MCP token → `readinessState: ready`.
2. **macOS arm64 idempotence** — second run after happy-path is zero-write.
3. **Ubuntu 22 happy-path** — same shape on Linux native (LXD or a fresh VM).
4. **Ubuntu 22 idempotence**.
5. **Banner UX audit** — no substrate names visible to the operator on any state.

This is the slice I (Claude) cannot run from a Windows + MSYS-bash environment. The operator runs it; this doc captures what to do and what to record.

---

## Prerequisites

Before starting, on the host you intend to verify:

- A working DPF install root (`~/dpf` or wherever your install lives). The install should have produced a `.mcp.json` at the root and an `~/.dpf/install-state.json` from any prior run.
- Claude Code CLI on PATH (`which claude` returns a path).
- Codex CLI on PATH (`which codex` returns a path).
- A DPF MCP bearer token exported as `DPF_MCP_BEARER_TOKEN` for the shell session (issue one from **Admin > Platform Development > MCP** in the portal if absent).
- Local portal running on `http://127.0.0.1:3000` (the MCP endpoint).

## Reset to a clean test state

This is destructive to *this contributor's* agent-toolchain state on this host. It does not touch global Codex/Claude config blocks owned by other plugins.

```bash
# Reset agentToolchain state so the first run can be observed cleanly.
python3 - <<'PY'
import json, os, pathlib
p = pathlib.Path.home() / ".dpf" / "install-state.json"
if p.exists():
    state = json.loads(p.read_text(encoding="utf-8"))
    state.pop("agentToolchain", None)
    p.write_text(json.dumps(state, indent=2), encoding="utf-8")
    print("cleared agentToolchain from", p)
else:
    print("no install-state.json yet; nothing to clear")
PY

# Optional: also clear the contributor memory directory for this project.
# Skip this if you have hand-edited kernel memory you want preserved.
rm -rf "$HOME/.claude/projects/$(printf '%s' "$PWD" | sed -E 's:[/:]:-:g' | sed -E 's:^-+::')"
```

## Test 1 — macOS arm64 / Ubuntu 22 happy-path

From the DPF install root, with both CLIs on PATH and `DPF_MCP_BEARER_TOKEN` exported:

```bash
bash scripts/dpf-bootstrap-agent-toolchain.sh --show-substrate
```

**Expected output (essential lines, in order):**

```
-> DPF agent toolchain bootstrap
  [..] Repo root        : <your install root>
  [..] Claude CLI       : present
  [..] Codex CLI        : present
  [..] DPF MCP token    : present
  [..] Skill pack ver.  : 0.1.0
  [..] Plan preview     : ready
  [OK] Claude Code plugin wired (create).
  [OK] Codex plugin wired.
  [OK] MCP client config written (2 file(s): .mcp.json / .vscode/mcp.json).
  [OK] Kernel-tier memory seeded (N principle(s)).

================================================================
  DPF agent toolchain: READY
  Claude Code and Codex are ready for DPF work.
  Next: Open readiness
================================================================

  Substrate detail (for debugging):
    Claude plugin     : true
    Codex plugin      : true
    Memory seeded at  : <iso>
    DPF platform ver  : 0.1.0
    State file        : <home>/.dpf/install-state.json
```

**Inspect the persisted state:**

```bash
python3 -c "
import json, pathlib
state = json.load(open(pathlib.Path.home() / '.dpf' / 'install-state.json'))
at = state['agentToolchain']
print('readinessState   :', at['readinessState'])
print('claudeCodeWired  :', at['claudeCodeWired'])
print('codexWired       :', at['codexWired'])
print('mcpReadiness.ok  :', at['mcpReadiness']['ok'])
print('mcpReadiness.cnt :', at['mcpReadiness'].get('toolCount'))
print('smokeTest.result :', at['smokeTest']['result'])
print('smokeTest.princ. :', at['smokeTest'].get('kernelPrincipleObserved'))
"
```

**Pass criteria:**

- Banner shows `READY` with the exact spec wording.
- `agentToolchain.readinessState == "ready"`.
- `mcpReadiness.ok == true` and `toolCount > 0` (160 on the operator's portal at time of writing).
- `smokeTest.result == "passed"` with `kernelPrincipleObserved == "destructive-actions-require-explicit-go"` (or one of the natural-language refusal phrasings — see `smoke-test.ts`).
- No bearer token substring (`dpfmcp_*`, `Bearer <token>`) anywhere in the state file.

**Record:** copy banner + state inspection output into the PR comment as functional evidence.

## Test 2 — Idempotence (second run after happy-path)

Immediately re-run the same command. **Do not change anything else between runs.**

```bash
bash scripts/dpf-bootstrap-agent-toolchain.sh --show-substrate
```

**Expected output (essential lines):**

```
  [OK] Claude Code plugin already converged.
  [OK] Codex plugin already converged.
  [OK] Kernel-tier memory already converged.

================================================================
  DPF agent toolchain: READY
```

**Pass criteria:**

- All three plugin/memory lines say *'already converged'* (no `(create)` or `(update)` annotation).
- Banner state remains `READY`.
- No errors printed.

**Record:** copy the re-run output into the PR comment alongside Test 1's evidence.

## Test 3 — UX contract audit

After the happy-path run, grep the banner output for any substrate name. (This re-runs the bootstrap WITHOUT `--show-substrate` so the gated debug panel doesn't show up.)

```bash
out=$(bash scripts/dpf-bootstrap-agent-toolchain.sh)
echo "$out"
echo
echo "--- substrate audit ---"
for forbidden in "config.toml" "installed_plugins.json" "claude plugin install" \
                 ".codex/" ".claude/plugins" "superpowers" "./scripts/" ".\\\\scripts\\\\"; do
  if printf '%s' "$out" | grep -F "$forbidden"; then
    echo "FAIL: banner contained '$forbidden'"
  fi
done
echo "audit complete"
```

**Pass criteria:** no FAIL lines printed.

## Test 4 — Missing-CLI degraded path

To verify the missing-CLI banner copy lands cleanly on a fresh contributor:

```bash
# Hide both CLIs via PATH manipulation; remove the token from the env.
env -u DPF_MCP_BEARER_TOKEN PATH="/usr/bin:/bin" bash scripts/dpf-bootstrap-agent-toolchain.sh
```

**Expected output (banner):**

```
================================================================
  DPF agent toolchain: MISSING_CLI
  Install the selected agent client to enable contributor sessions.
  Next: Open setup guide
================================================================
```

**Pass criteria:**

- Banner shows `MISSING_CLI` with the spec's wording.
- No `.\scripts\...` or `./scripts/...` command snippet appears anywhere in the output (this was the Phase 3 regression #1230 fixed).
- State file `agentToolchain.readinessState == "missing_cli"`.

## Test 5 — Bearer-redaction structural check

Confirm no bearer token leaked into any artifact:

```bash
echo "Checking state file..."
grep -E "dpfmcp_|Bearer\\s+[A-Za-z0-9]" "$HOME/.dpf/install-state.json" || echo "  OK: no bearer-shaped substring in state file"

echo
echo "Checking smoke transcript for redaction..."
python3 -c "
import json
state = json.load(open('$HOME/.dpf/install-state.json'))
t = state.get('agentToolchain', {}).get('smokeTest', {}).get('transcript', '') or ''
if '<redacted-bearer>' in t:
    print('  redaction marker present:', t.count('<redacted-bearer>'), 'occurrence(s)')
elif 'dpfmcp_' in t or 'Bearer ' in t:
    print('  FAIL: bearer leaked into transcript')
else:
    print('  OK: transcript clean (no bearer, no redaction marker because nothing was leaked)')
"
```

**Pass criteria:** no FAIL lines.

## Reporting

Open a comment on the relevant PR with:

1. Platform identifier: `macOS 15.x arm64` or `Ubuntu 22.04 LTS` or whatever.
2. Tests 1-5 expected/actual output.
3. Any deviations.

If any test fails:
- For UX-contract regressions (substrate names visible) — file a `bug` BI under EP-INSTALL-HARDENING-2026-05-23.
- For functional failures (probe `endpoint_unreachable`, `failed_smoke` on a healthy host) — file a `bug` BI and capture the `agentToolchain` block + the `~/.dpf/install-state.json` excerpt.

## What this protocol does NOT cover

- Concurrent worktree contention (handled by `worktree-per-session` kernel principle and Phase 5 path normalization).
- Codex plugin marketplace authentication flows that Anthropic / OpenAI may change unilaterally.
- The optional Phase 9 marketplace-publication path (separate BI).

## See also

- Spec: [docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md](../specs/2026-05-26-agent-toolchain-bootstrap-design.md)
- Plan: [docs/superpowers/plans/2026-05-26-agent-toolchain-bootstrap.md](../plans/2026-05-26-agent-toolchain-bootstrap.md)
- Ubuntu CI smoke: [`.github/workflows/agent-toolchain-bootstrap-smoke.yml`](../../../.github/workflows/agent-toolchain-bootstrap-smoke.yml)
- Install operations doc: [docs/operations/install.md](../../../docs/operations/install.md)

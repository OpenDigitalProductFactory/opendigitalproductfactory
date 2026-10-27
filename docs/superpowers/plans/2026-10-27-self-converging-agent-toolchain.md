---
status: draft
---

# Plan — the agent toolchain converges itself on every client

Spec: [`../specs/2026-10-27-self-converging-agent-toolchain-design.md`](../specs/2026-10-27-self-converging-agent-toolchain-design.md).
Umbrella: BI-63672FBE. Workroom WC-04DC9775.
Kernel decisions: DI-4D536FB25C8E, DI-AB7E110FCF63, DI-7591BDF26023.

Each slice is one PR. Each is written test-first: the failing test lands with the fix, and the red run is recorded as evidence. Every slice runs the pack's node and Python suites, plus the exact-tree local-CI gate. Slices that need a host or portal behaviour also record a live check on macOS, the reference host. Windows and Linux are covered by fixtures, and their live checks are recorded as unrun until performed.

## Backlog coverage

| Deliverable | Backlog item | Spec mechanism | Acceptance |
|---|---|---|---|
| S1 Content-stamped delivery version | BI-4F9E3221 | M1 | AC-CONTENT-VERSION |
| S2 Read-back for every adapter; client CLI is the single writer | BI-1DCF9F23 | M3, M4 | AC-READBACK, AC-SINGLE-WRITER |
| S3 Host convergence service and session backstop | BI-65C17737 | M2, M8 | AC-NO-HUMAN |
| S4 Declaration status, card reasons, escalation | BI-3E66F76F | M9 | AC-ESCALATE |
| S5 Runtime floor and interpreter discovery | BI-90C9478D (closes BI-6763D09E) | M5, M4 TOML | AC-PY39 |
| S6 Discovery, adapter contract, drift canary, pruning | BI-D43723D7 | M6, M7, M10 | AC-FAILURE-MATRIX |

## S1 — content-stamped delivery version (BI-4F9E3221)

1. **Failing tests first.**
   - `toolchain-manifest` test: the manifest carries `deliveredVersion === packVersion + "+c." + packDigest.slice(0, 12)`.
   - `update_agent_toolchain_test.py`:
     - after `refresh_managed_copy`, the shared copy's `.claude-plugin/plugin.json`, `.grok-plugin/plugin.json` and `.antigravity-plugin/plugin.json` carry `deliveredVersion`;
     - the managed marketplace's `metadata.version` and plugin entry carry it;
     - two packs that differ by one skill byte, at the same `packVersion`, stamp different versions;
     - stamping does not change `delivered_digest`.
   - `installed_copy_freshness_test.py`: a Claude record at `0.2.18` whose cache digest differs is stale. A record at `0.2.18+c.<digest>` with the matching digest is current. Readers that strip `+…` still compare the base version for the floor.
2. **Implement.**
   - `apps/web/lib/agent-toolchain/toolchain-manifest.ts` adds `deliveredVersion`. It is included in the signed payload, with schemaVersion unchanged as an additive field.
   - `installed_copy_freshness.py` exposes one `delivered_version(pack_root)` helper.
   - `update_agent_toolchain.py` stamps every managed manifest and the marketplace when it copies, Codex keeps its existing `codex_content_version` suffix, which already converges.
   - `delivered_digest`, in both the Python and TS mirrors, excludes the stamped manifests.
3. **Update the docs.**
   - `packages/dpf-skill-pack/README.md:285`: packVersion is semantic only; delivery is content-addressed.
   - Plan 2026-10-17 step 6 gets a superseded note.
4. **Live check.**
   - After merge and a portal upgrade, run the updater once on this host.
   - Expect Claude local scope and every project pin at `0.2.18+c.<digest>`, with the digest matching. The report should read `converged`.

## S2 — verified read-back; the client CLI as the single writer (BI-1DCF9F23)

1. **Failing fixtures** in a fixture home directory, one per client: Claude CLI, Claude desktop, Codex, Grok and Antigravity. In each, the write succeeds and the client's read-back differs. Each must report `failed`. A missing CLI must report `absent`.
2. Grok read-back reads the installed plugin digest from Grok's own store. Antigravity reads the skills directory digest and the `dpf` server and endpoint from `~/.gemini/config/mcp_config.json`.
3. `client-capabilities.json` gains a `writes` declaration per adapter, listing each path and the CLI that covers it. `gen-client-capabilities.mjs` validates it.
4. The conformance test scans adapter write call sites against the declaration. Codex MCP and plugin changes go through `codex mcp` and `codex plugin`.
5. `toolchain_convergence.py` stops snapshotting the shared copy for Grok and Antigravity rows.

## S3 — host convergence service (BI-65C17737)

1. Factor the launchd, systemd-user and schtasks registration out of `scripts/install-worktree-janitor-schedule.sh` into `scripts/lib/user-schedule.sh` and a `.ps1` twin. The janitor installer then uses it, and its tests must stay green.
2. Write the `dpf-toolchain-agent` runner (Python 3.9 stdlib). It is installed under `~/.dpf/toolchain-agent/` from the verified pack, so it needs no source checkout. It covers:
   - the lock, including stale-lock takeover;
   - the opt-out;
   - the pinned origin;
   - an `If-None-Match` fetch;
   - signature and identity verification;
   - running the signed updater;
   - an atomic state file;
   - exponential backoff.
3. Every updater run, and the bootstrap, installs or refreshes the schedule idempotently: at login, then every 60 minutes.
4. Tests:
   - lock contention returns `busy`;
   - a stale lock is taken over;
   - offline backs off and keeps the last state;
   - a signature mismatch refuses and records `needs-operator:identity`;
   - opt-out returns `opted-out`;
   - an unchanged manifest with all clients verified makes no updater call;
   - a changed digest runs the updater.
5. **Live check:** install on this Mac, publish a pack change, and observe convergence within one interval with no session open.

## S4 — session backstop, declaration status, escalation (BI-3E66F76F)

1. `toolchain-freshness.mjs` reads the state file with no network call. When the state is stale or the heartbeat is old, it kicks the service or reinstalls it, then prints one line.
2. The connector declaration builder adds `converge=<status>[:<code>]`. `toolchain-verdict.ts` parses it, `observeConnection` stores it, and `ConnectedAgentClients` shows it.
3. An attention rule raises one item for a host that has been `failed` or `needs-operator` for more than 24 hours, through the existing escalation path. It carries the cause and the action, and nothing for healthy hosts.
4. Tests: parser round-trip, the 24-hour threshold, deduplication, and the healthy-host no-op.

## S5 — runtime floor and interpreter discovery (BI-90C9478D)

1. A CI job runs `packages/dpf-skill-pack/scripts` Python suites on 3.9, using setup-python 3.9.
2. Wrappers and the service pick the newest interpreter of 3.9 or later. The pick is recorded in the state file.
3. Codex TOML settings with no CLI cover use `tomllib` when it is present. Otherwise they report `unsupported-setting:<name>` with no partial write.
4. Tests: 3.9 without tomli converges the Codex plugin and MCP settings through the CLI and reports the permission setting precisely.

## S6 — discovery, adapter contract, canary, pruning (BI-D43723D7)

1. Discovery runs every pass, over binaries, app bundles and config directories.
2. `docs/architecture/agent-client-capability-parity.md` gains an "adding a client" contract: adapter, capabilities entry, fixtures. Unproven clients are reported.
3. Canary: when a client binary version changes, the next run re-probes. A failure records `unproven:<client>@<version>`.
4. Pruning: records whose project path no longer exists are removed through the client CLI after a backup, once.

## Failure-matrix traceability (AC-FAILURE-MATRIX)

Each row of spec §4 is covered by a test in the slice named. Where marked, it is covered by a live record instead.

| Rows | Slice and test |
|---|---|
| F6, F7, F11, F12, F18, F19, X8 | S1 stamping and freshness tests, plus the S1 live check |
| F5, F9, F10, F13, F14, F15, F16, F22 | S2 read-back fixtures |
| F3, F8, F21, X14 | S2 single-writer conformance |
| X1, X2, X3, X9, X10, X13 | S3 runner tests |
| X4, X12 | S3 session-backstop tests |
| X15 | S3 precedence tests (checkout ahead of the served release) |
| F2, F20, X11 | S5 CI on 3.9 and discovery tests |
| F1, X5, X6, X7 | S6 discovery, canary and pruning tests |
| F4 | The existing guard self-test, plus S4 escalation for Codex trust (operator step, reported once) |
| F17 | Existing endpoint-normalisation tests |

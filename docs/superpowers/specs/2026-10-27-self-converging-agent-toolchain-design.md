---
status: active
---

# The agent toolchain converges itself on every client

Backlog: BI-63672FBE (absorbs BI-6763D09E). Workroom WC-04DC9775.
**Amends:** [`2026-10-07-agent-toolchain-release-delivery-design.md`](2026-10-07-agent-toolchain-release-delivery-design.md) §11 decision 4. That decision deferred the host-side agent, option A. This spec adopts it on owner direction.
**Kernel decisions:** DI-4D536FB25C8E (D1), DI-AB7E110FCF63 (D2), DI-7591BDF26023 (D3). All three are high confidence with verdict *proceed*.

## 1. Problem

The DPF skill pack changes about eleven times a week. Commits to `packages/dpf-skill-pack` in W36–W43 were 5, 6, 3, 21, 11, 9, 28 and 8. Each client must pick up the change. Today two things block that:

1. **Client caches are keyed by version, but versions are bumped by hand.**
   - Since `toolchain-version.json` was created on 2026-10-08, 39 pack commits have merged. Only 10 bumped the version. 25 of the other 29 changed delivered files.
   - Every cache keyed by version then keeps the old bytes. On 2026-10-27 the Claude CLI's local scope and 24 project pins were stale at 0.2.18, because #6603 and #6623 merged after 0.2.18 was published.
   - This is the sixth recurrence of the same failure: F6, F7, F11, F12, F18 and F19 in §4.
2. **Detection works, but nothing remediates without a human.**
   - The SessionStart advisory and the portal verdicts both find stale copies.
   - Convergence still waits for an agent to ask the operator for approval and run the updater, and for the operator to restart.

Owner direction, 2026-10-27: "resolve this once and for all, make sure any and all possible failures can be addressed… we have other clients to design for… A detect and automated procedure is the only sustainable approach."

## 2. Goal and non-goals

**Goal.** Every DPF client on a host reaches the content the portal serves within one convergence interval. No human step is needed except restarting a client that is already running. When automation cannot finish a step, the report says so precisely, once, in the place the operator already looks.

**Non-goals.**
- Defending a compromised host. The 2026-10-07 spec already scopes this out.
- Forging Codex hook trust. It is interactive by design (openai/codex#21615).
- Touching credentials. These remain operator-only on production installs.

## 3. Evidence

### 3.1 How Claude Code keys its plugin cache

Spike run 2026-10-27 on Claude Code 2.1.197, in an isolated `CLAUDE_CONFIG_DIR`. The script is in the Workroom evidence.

| Step | `plugin.json` version | Content | `claude plugin update` result | Cache dir |
|---|---|---|---|---|
| A | `1.0.0` | v1 | installed | `1.0.0` |
| B | `1.0.0` | v2 | "already at the latest version (1.0.0)". **Not refreshed** | `1.0.0` (v1 bytes) |
| C | `1.0.0+c.bbbb` | v2 | updated | `1.0.0-c.bbbb` (v2) |
| D | `1.0.0+c.cccc` | v3 | updated | `1.0.0-c.cccc` (v3) |
| E | `1.0.1-c.dddd` | v4 | updated | `1.0.1-c.dddd` |
| F | `1.0.1-c.aaaa` (lexically lower) | v5 | updated | `1.0.1-c.aaaa` |
| G | no version | v6 | updated, to `unknown` | `unknown` |
| H | `1.0.2` with `CLAUDECODE=1` | v7 | updated | `1.0.2` |

Conclusions:
- Claude compares version strings for inequality only, so any change of string refreshes the cache.
- A version with semver build metadata is a distinct cache key.
- `update` works inside a session (H).

The Claude Code docs describe the rest:
- `install` is refused without a TTY inside a session.
- Auto-update is off by default for user-added marketplaces.
- A local directory that is not a git repo resolves to version `unknown`.
- Sources: [plugin loading](https://code.claude.com/docs/en/plugins/loading.md#versions-and-updates), [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference.md#plugin-update).

### 3.2 Codex already solved this for itself

#5541 made the updater stamp Codex's version as `+codex.<24-hex content digest>`, keyed off `codex_content_version`. Codex has not gone stale since (F7). This design extends the same principle to every client, using one digest.

## 4. Failure catalogue and coverage

Every failure mode in the toolchain's history (2026-06-27 to 2026-10-27), plus foreseeable ones (X1–X14). Each one maps to the mechanism in §6 that detects it and the mechanism that remediates it. "Operator" appears only where a human step is unavoidable.

| ID | Failure | Detect | Remediate |
|---|---|---|---|
| F1 | A host manifest-convention change makes the plugin fail to load (duplicate hooks file) | M7 drift canary, M3 read-back | M7 reports within one interval. The fix is a pack change, which then ships automatically through M1 and M2 |
| F2, F20 | A Python API newer than stock macOS 3.9 crashes or aborts the updater | M5 CI runs under 3.9 | M5 blocks the PR before merge |
| F3, F21 | Two writers corrupt Codex TOML | M4 conformance test | M4: the Codex CLI is the only writer |
| F4 | Codex and Grok guards fail open (trust, payload shape) | M3 read-back, existing `pretooluse-guard-selftest` | Grok is automatic. Codex trust is the **operator's** single step, reported once by M9 |
| F5 | A skill surface is not exposed for a client | M3 read-back of the client's own skill list | M2 re-runs the adapter |
| F6, F7, F11, F12, F18, F19 | Same version, different bytes, so the cache stays stale | M3 digest read-back | **M1** content-stamped version, then the M2 update |
| F8 | Guards are wired twice | M4 conformance test | M4 |
| F9 | OAuth scope pin drifts | M3 connector read-back | M2 re-pins |
| F10, F12, F13 | Duplicate `dpf` connectors | M3: client's own `mcp list` | M2 retires the duplicate through the client CLI (M4) |
| F14, F16 | A wrapper or project override shadows the user config | M3 reads the effective config the client reports | M4 removes the second writer |
| F15 | A shared environment variable poisons connector config | M3 read-back | M4: no environment variable is a config input to an adapter |
| F17 | Endpoint normalisation | Existing tests | Existing |
| F22 | Reports "converged" while the client cannot see the tools | **M3**: success means read-back only | M2 retries, then M9 |
| X1 | Portal unreachable or host offline | M2 fetch fails | M2 backs off, keeps last good, reports `offline` |
| X2 | Manifest signature or installation identity mismatch | Existing `portal_source` check | **Refuse**. M9 alerts, because this is security-relevant. Never auto-trust |
| X3 | Two convergence runs at once (service plus a session) | M2 lock | M2 single-instance lock. The second run exits `busy` |
| X4 | Client running during update | Client reports "restart to apply" | M8 tells the session once (Claude: `/reload-plugins`) |
| X5 | Client installed after bootstrap | M6 discovery on every run | M2 converges it on its next run |
| X6 | Client uninstalled, or a project path gone | M6 | M10 prunes the record, with a backup |
| X7 | Client CLI upgraded and its contract changed | M7: binary version differs from last verified | M7 re-probes and records unproven, then M9 |
| X8 | Bad pack release | Portal serves the previous pack | M1: a different digest means a different version, so a downgrade converges like an upgrade (spike F) |
| X9 | Disk full or permission denied | M2 write error | Reported with path, retried, then M9 |
| X10 | Operator opts out of automation | `~/.dpf/toolchain-agent.json` `{"enabled": false}` | Honoured. Reported as `opted-out`, never silently skipped |
| X11 | No supported interpreter | M5 discovery | M5 uses the newest Python ≥ 3.9 available. If none, `needs-runtime`, then M9 |
| X12 | Service never installed, or removed | M8 sees no state file or a stale heartbeat | M8 reinstalls it through the updater (idempotent) |
| X13 | Several paired installations on one host | Existing `trusted-installations.json` pin | M2 follows the pinned origin only |
| X14 | A client has no CLI for a setting the updater must change | M4 adapter declares the coverage | Direct write only in a stdlib-parsable format (JSON). Otherwise `unsupported-setting`, then M9 |

## 5. Research & benchmarking

| System | Pattern | DPF adopts | DPF rejects |
|---|---|---|---|
| **Nix store** ([store paths](https://nixos.org/manual/nix/stable/store/store-path)) | An artefact's identity is a hash of its inputs, so different content can never share a path | The identity of delivered content is its digest (M1) | Making the version *only* a hash. A readable semantic base is kept for floors and humans |
| **Docker image digests** ([pull by digest](https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier)) | A mutable tag plus an immutable digest | `packVersion` is the tag, `+c.<digest>` the digest | Pinning clients to digests by hand |
| **npm** ([publish](https://docs.npmjs.com/cli/v10/commands/npm-publish)) | A published version is immutable. Republishing the same version is refused | The rule that the same version means the same bytes, enforced by construction rather than by a registry | A manual bump per change. That is exactly what failed here 29 times |
| **VS Code extension auto-update** ([marketplace](https://code.visualstudio.com/docs/editor/extension-marketplace#_extension-autoupdate)) | A background check, applied on reload, with a per-user opt-out | A background service with a reload prompt and an opt-out (M2, M8, X10) | Updates that depend on the editor being open |
| **Homebrew autoupdate** ([DomT4/homebrew-autoupdate](https://github.com/DomT4/homebrew-autoupdate)) | A per-user launchd job runs the package manager on an interval | A per-user scheduled job (launchd, systemd `--user`, Task Scheduler) that needs no elevation (M2) | Running with sudo or system-wide |
| **Semver 2.0 build metadata** ([§10](https://semver.org/#spec-item-10)) | `+build` is ignored for precedence | Suitable as a cache-distinguishing suffix, because Claude compares by string (§3.1) | Relying on precedence: no client may order versions by the suffix |
| **BMAD Method** (DPF default delivery comparator) | Agent-installed module bundles, refreshed by re-running the installer | Nothing new. Its manual re-run is the status quo this design removes | Operator-run refresh |

What this design adds that none of these provide:
- The same content identity across five client hosts with different cache semantics.
- Verification against what each client actually loads, not what was written.
- A failure report the platform can see without the host holding credentials.

## 6. Design

### M1 — Content-stamped delivery version (D1)

- The portal manifest gains `deliveredVersion = "<packVersion>+c.<packDigest[0:12]>"`.
- When the updater copies the pack to each managed location, it writes `deliveredVersion` into every client manifest:
  - `.claude-plugin`, `.grok-plugin` and `.antigravity-plugin` `plugin.json`;
  - the managed marketplace `metadata.version` and the plugin entry;
  - Codex keeps its `+codex.<digest>` form, re-derived from the same `delivered_digest`, so there is one digest algorithm (§3.2 noted `codex_content_version` diverges).
- `delivered_digest` already excludes per-install `*.mcp.json` and the Codex manifest. It now also excludes every stamped manifest, so stamping cannot change the digest.
- The repo keeps a plain `packVersion` in `toolchain-version.json`. It changes only for semantic reasons: a floor, a breaking change, or a release note. The `README.md` instruction to bump it on every pack change is removed.
- `sync-toolchain-version.mjs --check` stays as the copy-drift guard.

Result: any delivered byte change produces a new version string in every client cache, with no human step. A downgrade (X8) works the same way.

### M2 — Host convergence service (D2)

A per-user scheduled job, `dpf-toolchain-agent`:
- installed by the bootstrap and by every updater run, idempotently;
- reusing the existing per-platform scheduling code in `scripts/install-worktree-janitor-schedule.sh`, factored into a shared helper so there is no second scheduler implementation;
- launchd `local.dpf.toolchain-agent` on macOS, a systemd user timer on Linux, a Scheduled Task on Windows;
- running at login and every 60 minutes.

Each run:
1. Takes `~/.dpf/toolchain-agent.lock`. If another live run holds it, exits `busy` (X3). A stale lock (dead PID or older than 30 minutes) is taken over.
2. Reads `~/.dpf/toolchain-agent.json` for the opt-out (X10) and the pinned origin (X13).
3. Fetches the manifest with `If-None-Match` (cheap when nothing changed) and verifies the signature and identity. Mismatch means refuse plus M9 (X2). Offline means back off (X1).
4. Converges when the manifest digest differs from the last verified state, when any client's read-back (M3) is not verified, or when a client binary version changed (M7). It runs the same signed updater, `--from-portal … --expect-installation …`. Nothing else forks the update logic.
5. Writes `~/.dpf/toolchain-state.json` atomically: per client the delivered digest, verified digest, client binary version, last attempt, last success, status code and one-line detail.
6. On repeated failure, backs off exponentially: 1, 2, 4… up to 24 hours. The state file keeps the first-failure time, which drives M9.

The service handles no credentials. The manifest and archive endpoints are public, and the signature pin is the trust anchor.

### M3 — Verified read-back for every adapter

An adapter's success is defined only by reading the client's own view after the write:

| Client | Read-back |
|---|---|
| Claude CLI | `installed_plugins.json` record version equals `deliveredVersion`, and the cache digest equals `packDigest`. This exists today, now keyed on the stamped version |
| Claude desktop | Shared copy digest, plus connector descriptor equal to the manifest endpoint |
| Codex | `codex plugin list --json` version and cache digest. Exists today |
| Grok | **New.** Read Grok's installed plugin digest from its plugin store, instead of trusting the exit code |
| Antigravity | **New.** Skills directory digest, plus `mcp_config.json` parsed for the `dpf` server and endpoint |

`toolchain_convergence.py` must no longer snapshot the *shared copy* for Grok and Antigravity rows. `skipped: CLI not found` becomes its own state, `absent`, instead of collapsing to `unchanged`.

### M4 — The client CLI is the single writer (D3)

- Each adapter declares the files it may write and the CLI commands that cover each setting, in `client-capabilities.json`.
- Where a CLI covers a setting, the adapter must use it:
  - `codex mcp add/remove` and `codex plugin add`;
  - `claude mcp add/remove` and `claude plugin …`;
  - `grok plugin …`.
- A conformance test fails if adapter code writes a client-owned file that the declaration says a CLI covers.
- Remaining direct writes are allowed only for JSON, which the stdlib parses. Codex TOML settings with no CLI (routine permissions) use the stdlib path when Python ≥ 3.11 is available (M5). Otherwise they report `unsupported-setting`, carrying the setting name (X14). No partial write.
- This closes BI-6763D09E without adding a dependency. The absorb-don't-adopt commandment applies.

### M5 — Runtime floor and interpreter discovery

- CI runs the pack's Python suites under Python 3.9, the stock-macOS floor. Code that needs a newer API fails before merge (F2, F20).
- The service and the wrappers pick the newest interpreter of 3.9 or later: `python3.13` … `python3.9`, `/opt/homebrew/bin`, `/usr/local/bin`, `py -3` on Windows. The choice is recorded in the state file.
- No interpreter at all reports `needs-runtime` (X11).

### M6 — Client discovery and the adapter contract

- Every run discovers installed clients from binaries, app bundles and config directories. It does not use a list frozen at bootstrap (X5, X6).
- A new client is added by:
  1. an adapter implementing `discover`, `converge`, `verify` and `prune`;
  2. a `client-capabilities.json` entry;
  3. conformance tests run against a fixture home directory.
- Clients without a proven adapter are reported as `unproven`, never skipped silently.

### M7 — Client drift canary

- When a client binary version differs from the last verified one, the next run re-runs that client's read-back and the existing guard self-test probes.
- A change that breaks the contract is recorded as `unproven:<client>@<version>` with the failing probe (F1, X7), and the run triggers M9.

### M8 — Session backstop

- The existing SessionStart `toolchain-freshness` hook reads `~/.dpf/toolchain-state.json` with no network call.
- If the state is stale, or the service heartbeat is older than two intervals, the hook:
  - starts the service once (`launchctl kickstart`, `systemctl --user start`, `schtasks /Run`);
  - reinstalls the service if it is missing (X12);
  - tells the agent one line: "DPF tools were updated; restart or `/reload-plugins` to load them."
- It never runs the updater inline.

### M9 — Escalate only what automation cannot fix

- The connector declaration already sent on every MCP call (`X-DPF-Toolchain: pack=;digest=;client=`) gains `converge=<status>[:<code>]`, read from the state file. The status is `ok`, `failed`, `needs-operator`, `opted-out`, `offline` or `unproven`.
- The portal stores it on `AgentToolchainObservation`, which exists, and shows it on the existing Connected Agent Clients card.
- A host that has stayed `failed` or `needs-operator` for more than 24 hours raises one attention item through the existing escalation path. The item carries the exact cause and the single operator action, for example Codex hook trust: "open Codex, run /hooks, choose Trust all".
- No credentials move from host to portal.

### M10 — Pruning

Install records whose project path no longer exists (38 today) are removed through the client CLI after a backup, once. They are not reported on every run.

## 7. Security

- The trust anchor is unchanged: a manifest signed by the pinned installation DID, and the archive hash in the manifest.
- The service runs as the user, never elevated.
- It handles no credentials. It writes only client-owned plugin and config locations already in scope for the updater.
- It refuses rather than repairs on any identity mismatch (X2).

## 8. Acceptance

- **AC-CONTENT-VERSION:** a pack change merged with no `packVersion` edit reaches the Claude CLI, local and project scope, within one interval. Its cache directory carries the new `+c.<digest>` and its digest matches the manifest. Tested with a fixture, then verified live on macOS.
- **AC-NO-HUMAN:** on a host where the service is installed, a new portal release converges every installed client with no operator or agent action. The only notice is the restart line (M8).
- **AC-READBACK:** every adapter reports success only after reading back the client's own view. A fixture where the write succeeds but the read-back differs reports `failed` for each of the five clients.
- **AC-SINGLE-WRITER:** the conformance test fails when an adapter writes a CLI-covered file.
- **AC-PY39:** CI runs the pack's Python suites on 3.9. Codex refresh works on stock macOS Python 3.9 without tomli, or reports `unsupported-setting` with the setting named.
- **AC-ESCALATE:** a host stuck in `needs-operator` or `failed` for more than 24 hours produces exactly one attention item naming the cause and the action. A healthy host produces none.
- **AC-FAILURE-MATRIX:** each row F1–F22 and X1–X14 in §4 has an automated test, or an explicit live-verification record, linked from the plan.

## 9. Delivery

The work ships as six slices, each one PR, planned in [`../plans/2026-10-27-self-converging-agent-toolchain.md`](../plans/2026-10-27-self-converging-agent-toolchain.md). S1 lands first because it alone fixes today's stale Claude caches.

| Slice | Mechanisms |
|---|---|
| S1 | M1 content-stamped version. Also brings the Claude caches current |
| S2 | M3 read-back for every adapter, plus M4 single writer |
| S3 | M2 host service |
| S4 | M8 backstop and M9 declaration, card and attention |
| S5 | M5 runtime floor and interpreter discovery (closes BI-6763D09E) |
| S6 | M6 discovery and contract, M7 canary, M10 pruning |

## 10. Superseded guidance

- 2026-10-07 spec §11 decision 4 ("defer option A") is superseded by M2.
- 2026-10-17 plan step 6 ("content changes ship as a new version by editing `toolchain-version.json`") is superseded by M1. The manual bump becomes semantic-only.
- `packages/dpf-skill-pack/README.md:285` (bump to ship a change) is updated in S1.

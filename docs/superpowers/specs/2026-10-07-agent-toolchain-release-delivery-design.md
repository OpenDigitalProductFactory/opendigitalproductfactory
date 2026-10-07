---
title: A release delivers and verifies the agent toolchain on every client
status: draft
author: Claude (Opus 5.5), external_coding_agent
date: 2026-10-07
backlog:
  - BI-D4BB5AE3 (this design)
symptoms:
  - BI-5201141C
  - BI-16EAAB62
  - BI-772023BC
  - BI-F4BE47B5
  - BI-B9F359AC (fix in flight on fix/toolchain-project-scope-pins, WC-547B5CFC — consumed, not duplicated)
epics:
  - EP-CLIENT-CONFIG
decisions:
  - DI-7FFCDEC4AB67 (delivery shape; principle_decide, high confidence, margin 5.84)
  - DI-2399DE85DC6A (Grok credential; principle_decide, high confidence, margin 1.29)
architecture_review: advisory, independent agent, 2026-10-07 — 15 findings, all folded in (§14)
extends:
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/specs/2026-07-24-per-client-configuration-conformance-design.md
  - docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md
---

# A release delivers and verifies the agent toolchain on every client

## 1. Problem

AI clients do not run the DPF skill pack from the repository. They run **installed copies**:

| Client | What it loads | Auth to DPF MCP |
|---|---|---|
| Claude Code | Plugin cache plus `~/.claude/plugins/installed_plugins.json`, which holds one `local` record **and one record per project folder** | OAuth on https; bearer on plain http (`mcpClientBearerHeaderRequired`) |
| Codex | `~/.codex/config.toml`, `~/.codex/hooks.json`, managed copy `~/plugins/dpf-platform` | OAuth (incl. http loopback) |
| Grok | `~/.grok/config.toml`, shared copy `~/.agents/plugins/plugins/dpf-platform` | Stored bearer token (no OAuth client) |
| Antigravity | Shared copy, `~/.antigravity/mcp_config.json` | OAuth on https; unsupported-until-proven |

The only bridge from a release to those copies is `packages/dpf-skill-pack/scripts/update_agent_toolchain.py`. It runs when the installer runs, when a worktree is bootstrapped, or by hand. **Nothing in the release path reruns it, and nothing on the server knows which copy a client loaded.** A merged change to skills, hooks or the connector reaches a client only if someone reruns the updater in the right scope.

### Measured on the development install, 2026-10-07

- `installed_plugins.json` on this host:
  - The `local` record and the D:\DPF project record are at 0.2.8.
  - **10 project-scope records are on 0.2.5 and 1 is on 0.2.7.**
  - 2 records point at folders that no longer exist.
  - The D:\DPF record was changed **by hand** that day (`claude plugin update --scope project`, with `.mcp.json` renamed `.legacy-bak`). It does not show what the platform converges.
- `~/.codex/config.toml` and `~/.grok/config.toml` both point at `http://127.0.0.1:3000/api/mcp/v1`. Grok also holds a stored bearer.
- **12 operator PATs are live and in use** (latest use 15:51Z). 3 OAuth access tokens are live.
- **What a 0.2.5 copy does:**
  - It connects with a PAT to the retired http endpoint.
  - It lacks `initiative_evidence_write`.
  - Next to a project `.mcp.json`, it produces two `dpf` connectors (BI-5201141C).

The same failure class has been filed one symptom at a time:

| Item | Symptom |
|---|---|
| BI-5201141C | Duplicate connectors |
| BI-16EAAB62 | A stale shared copy blocked sign-in |
| BI-772023BC | The PowerShell updater defaults to the retired URL |
| BI-F4BE47B5 | A stale cache re-ran an old Stop guard |
| BI-B9F359AC | Stale project-scope pins and a duplicate `.mcp.json` |

Each item fixed one copy or one script. None made staleness visible, and none tied delivery to the release.

## 2. What already exists (fuse, do not build)

Read on `origin/main` 31b4a02 and checked by the independent review. Every new piece in §5 extends one of these.

| Concern | Existing substrate | What it lacks |
|---|---|---|
| Converging client copies | `update_agent_toolchain.py` covers Claude local scope, the shared copy, Codex (managed copy, hooks, digest-verified `codex plugin add`), Grok (plugin, hooks) and Antigravity (MCP config, skills). Competing plugins are disabled, never deleted. | Pulls only from a local directory. Writes no machine-readable report. **BI-B9F359AC adds** Claude project-scope convergence and duplicate project `.mcp.json` retirement (`converge_claude_project_plugins`, `retire_duplicate_project_mcp_json`, `converge_claude_project_connectors`). |
| Per-client auth rule | `mcpClientBearerHeaderRequired(endpoint, client, authMode)` (`packages/integration-shared/src/mcp-client-credential-policy.ts:17`) plus the cases in `mcp-credential-policy-cases.json`. It is the one home that decides when a client needs bearer. | None. This design **reads** it and does not restate it. |
| Install-wide PAT retirement | `isPatResolutionDisabled()` (`lib/auth/oauth-policy.ts:113`), switched by `DPF_MCP_PAT_RESOLUTION_DISABLED`, enforced in `transport-auth.ts` | Turning it on today would also cut off Grok, which has no alternative. |
| Content identity | `delivered_digest()` (`installed_copy_freshness.py:74`; excludes `*.mcp.json`, `.in_use/`, the Codex manifest); `codex_content_version()` (`update_agent_toolchain.py:123`) | Two digest functions. Neither is published by the server. |
| Copy-freshness advisory | `installed_copy_freshness.py` + `scripts/hooks/plugin-copy-freshness.{sh,ps1}` | Reference is the **root clone**. Registered only in the source repo's `.claude/settings.json`. Silent without Python. |
| Repo-only project repair | `scripts/hooks/reconcile-claude-plugin.{sh,ps1}`, `scripts/hooks/lib/pin-plugin-mcp-url.mjs`. The pin helper rewrites the cached descriptor's URL to the literal endpoint so the desktop app can parse it (BI-1229E42C). | Repairs only the source repo's own record. The pin replaces the whole URL. |
| Plain-http host writer | `writeMcpJsonToHost` (`lib/auth/mcp-host-writer.ts`) writes `/host-dpf/.mcp.json` when a token is minted on http/legacy | Re-creates the duplicate connector the updater retires. |
| Self-attested client state | `AgentSurfaceReadiness` (`ai-coworker.prisma:508`), `record_surface_readiness` / `get_fleet_readiness` (`surface-readiness-pack.ts`), pure `evaluateFleetReadiness` with `behindVersion` and 7-day staleness (`lib/agent-toolchain/fleet-readiness.ts`) | **Nothing writes it.** Caller-supplied `surfaceKey` (any `work_capsule_write` token can overwrite any row). Unbounded `findMany` (`fleet-readiness.ts:193`). No lifecycle tag (`scripts/model-metadata-baseline.txt:22`). |
| Connection identity | `handleInitialize` (`route.ts:408`) → `buildMcpInitializeResult` (`initialize.ts:96`); `deriveCallerClient` (`caller-client.ts:13`); UA classifier `CLIENT_SIDE_LAZY_TOOL_CATALOG` (`tool-tier.ts:36`); `McpAuthSource` (`tool-tier.ts:77`); OAuth client row loaded in `oauth-tokens.ts:162` | `clientInfo` is discarded (gap 1 of the 2026-07-24 conformance design). The OAuth `clientId` is dropped in `transport-auth.ts:133`. No pack declaration is carried. |
| Per-connection instructions | `buildAgentHostInstructions` (`agent-host-instructions.ts:40`), the "DPF AGENT HOST … INSTALLATION …" text | No toolchain section. |
| Server-side write refusal pattern | `quiescenceRefusalResult` (`route.ts:190`) and its structured `writesRefused` / `readOperationsAllowed` payload | Its test (`quiescence-safe-tools.ts`: `sideEffect === false` ⇒ allowed) is **not** a sound "is a write" test. `start_build`, `write_sandbox_file` and `run_sandbox_command` declare `sideEffect: false`, and `tasks/submit` (`route.ts:741`) bypasses it. Only the payload shape is reused. |
| OAuth resource binding | `resourceMatches` (`lib/auth/oauth-metadata.ts:118`) rejects a `resource` that carries a query | A query-string carrier is audience-safe only if each client takes `resource` from protected-resource metadata rather than from the connector URL. This must be measured. |
| Release pipeline | `self-upgrade-swap.ts` success path (in the **old** process), `reconcileSelfUpgradeRunsOnBoot` (`instrumentation.ts:97`; acts only on rows still `running`), `notifySelfUpgradeEvent` → `PlatformNotification` (no production caller) | Nothing in the pipeline looks at clients. |
| Pack in the image | `Dockerfile:208/371` copies `packages/` into the runner; `seed-skills.ts` reads the skills | Not served. Not in `/dpf-release-assets`. |
| Rate limiting | `apps/web/lib/api/rate-limit.ts` | Not applied to `/.well-known` reads. The new routes must opt in. |
| Portal reach | `docker-compose.yml:165` mounts the install folder at `/host-dpf` | Cannot reach `~/.claude`, `~/.codex`, `~/.grok` or another machine. **Convergence must run on the client host.** |

## 3. Kernel grounding

- **`platform-function-never-depends-on-a-client`** (commandment). Four *guarantees* run server-side: knowing what each client loaded, recording it, raising attention after a release, and refusing writes below the floor. Running the updater on a host is acceleration, and only something already running on that host can do it.
- **`absorb-dont-adopt`** (commandment, weight 2.0). No new service, daemon, image, package registry or vendor marketplace. Each new piece names what it retires (§8).
- **`never-ask-user-to-run-commands`** (commandment). The agent runs the updater after one approval. The user is never shown a command. The only human step is restarting the client, which every client needs before it loads new plugin code.
- **`single-source-of-truth`** (commandment):
  - There is one published manifest per release and one digest definition.
  - The pack version is generated into every manifest.
  - The per-client auth rule stays in `mcpClientBearerHeaderRequired`.
- **`gates-proportional-to-shape`** (core). This work is `delivery-large`: it touches MCP transport, the data model, the release pipeline and installer-adjacent scripts.
- **Founder directive under BI-903FB5F9.** Host upkeep is a platform function, never a session recipe. Convergence is therefore a platform-published, versioned program whose result the platform records and verifies.

## 4. Options scored (principle_decide DI-7FFCDEC4AB67)

All features are magnitudes. On the cost axes (`blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `operator_effort`), higher is worse.

| Axis | A: host-side toolchain agent | **B: connection-time detection + agent-run convergence** | C: client-hook auto-update |
|---|---|---|---|
| operational_independence | 0.60 | **0.80** | 0.20 |
| long_term_maintainability | 0.35 | **0.75** | 0.35 |
| schema_grounding | 0.40 | **0.80** | 0.30 |
| reusability | 0.50 | **0.75** | 0.30 |
| governance_compliance | 0.50 | **0.80** | 0.30 |
| evidence_density | 0.60 | **0.75** | 0.25 |
| legibility_of_consequence | 0.40 | **0.75** | 0.35 |
| reversibility | 0.40 | **0.75** | 0.70 |
| speed_to_value | 0.30 | **0.70** | 0.65 |
| cost_efficiency | 0.40 | **0.75** | 0.75 |
| data_privacy | 0.50 | **0.70** | 0.70 |
| blast_radius (cost) | 0.60 | **0.35** | 0.40 |
| human_cognitive_load (cost) | 0.30 | **0.25** | 0.45 |
| operator_effort (cost) | 0.35 | **0.20** | 0.30 |
| vendor_lock_in (cost) | 0.20 | **0.15** | 0.60 |
| **Composite** | 6.39 | **12.23** | 3.19 |

The recommendation is **B**: high confidence, margin 5.84, no commandment conflict.

- **A loses on `absorb-dont-adopt`** (+0.38 against B's +0.67). It adds a long-running process per host, plus a service-registration surface per OS (scheduled task, launchd, systemd) that must be installed, upgraded and monitored. That process can itself go stale. It wins nothing B cannot reach, because a client that is not running has nothing stale *loaded*.
- **C is net negative on `platform-function-never-depends-on-a-client`** (−0.04). The platform stays blind, Grok and Antigravity have no comparable hook plane, and customer agents are not covered at all.
- **Retained as a follow-on:** A, if an unattended remote host ever needs convergence with no agent session. It would reuse B's manifest, updater and report unchanged (§11, decision 4).

## 5. Design

### 5.1 Publish: the release serves its own toolchain

**Built at image build time.** One deterministic step produces two artifacts inside the image:

- `toolchain-manifest.json`
- `agent-toolchain.tar.gz`:
  - sorted entries, `mtime=0`, uid/gid 0, gzip with no timestamp;
  - contents: skills, hooks, per-client manifests and descriptors, `scripts/update_agent_toolchain.py` and its helpers, and a Node freshness wrapper.

The manifest carries:

| Field | Meaning |
|---|---|
| `packVersion` | Pack version |
| `packDigest` | `delivered_digest` of the tree: the **identity** |
| `archiveSha256` | sha256 of the tarball: **transport** integrity |
| `releaseId` | Served image identity |
| `floor` | `{ minPackVersion, graceStartsAt }` |
| `clients` | Per-client descriptor shape and declaration carrier (§5.2) |

The portal loads the manifest **once per process** from the file. No request path recomputes it.

**Served from the portal's own origin.** No git checkout is involved:

- `GET /api/agent-toolchain/manifest`
- `GET /api/agent-toolchain/pack.tar.gz`

Both are read-only, contain no secrets (the pack is the open-source package), and need no MCP auth: a client whose auth is the broken part must still be able to repair. Both opt into `lib/api/rate-limit.ts`. `/.well-known` reads have no rate limiter today, so the routes cannot inherit one.

**The manifest is not a trust anchor.** The hashes prove integrity against the same origin, not authenticity. The trust boundary is that the updater accepts `--from-portal` only for an origin that equals an already-configured DPF connector origin on that host, over https or loopback (§5.3). Signing the manifest (Sigstore or minisign) is a named follow-on, not part of this design.

**One version source, one digest.**

- `delivered_digest()` becomes the single digest definition: one Python module plus a TS port, both tested against the same fixture. `codex_content_version()` derives from it.
- `packages/dpf-skill-pack/toolchain-version.json` holds `packVersion` and `floor`.
- A generator writes the version into `.claude-plugin`, `.grok-plugin`, `.antigravity-plugin`, the Codex manifest, and both root `marketplace.json` fields (`metadata.version` is still `0.1.0` today). A CI drift check fails on any hand edit.

### 5.2 Report: every connection declares what it loaded

**The declaration is baked into the shipped descriptors.** At pack generation, each per-client descriptor (`claude.mcp.json`, `antigravity.mcp.json`, Codex and Grok config shapes) gets three declaration fields:

- `dpf_pack`: the pack version
- `dpf_digest`: the first 16 hex characters of `packDigest`
- `dpf_client`: `claude-code`, `codex`, `grok` or `antigravity`

Descriptors are already excluded from `delivered_digest`, so writing the digest into them is not circular. **Nothing per-install is written into a cached copy.** A `claude plugin update` or a marketplace refresh therefore re-materializes the *same* declaration. It cannot erase it.

Host identity is not declared. It comes from the **credential**: the OAuth client row (each client's DCR registration on each host) or the Grok `agent-client` token (§5.2d). A credential cannot be chosen by the caller's URL.

**Carrier, measured rather than assumed (P1 spike).** The default carrier is query parameters placed **outside** any `${DPF_MCP_URL:-…}` expansion, so an endpoint override replaces only the origin and path. `pin-plugin-mcp-url.mjs` is changed to preserve the query.

The spike measures, for Claude Code (CLI and desktop app), Codex and Antigravity:

- whether a declaration change forces re-authorization;
- whether OAuth fails with `invalid_target` (i.e. whether the client derives `resource` from protected-resource metadata or from the connector URL; `resourceMatches` rejects a query);
- the desktop app's `verifyPluginMcpBinding` URL check;
- behaviour under a set `DPF_MCP_URL`;
- the ordering of the pin hook and the updater.

Where a client fails, its carrier falls back to a static header (`X-DPF-Toolchain: pack=…;digest=…;client=…`). The per-client carrier is recorded in the manifest's `clients` map. The server accepts either carrier.

**Verdict, computed at read time and never stored.** `resolveToolchainVerdict({ declaration, credential, authSource, endpoint, manifest, now })` is pure and unit-tested:

| Verdict | Condition |
|---|---|
| `current` | Declared digest equals the release digest. |
| `stale` | Declared, pack ≥ `minPackVersion`, digest differs (older or newer). |
| `below-floor` | Declared pack < `minPackVersion`, **or** the declared client authenticated with a bearer although `mcpClientBearerHeaderRequired(endpoint, client)` is false for it (OAuth was available), **or** a Grok declaration authenticated with anything other than an `agent-client` token. |
| `undeclared` | No declaration. This covers every pre-declaration copy (all packs ≤ 0.2.8), customer agents, scripts and Build Studio. A User-Agent hint from the existing `CLIENT_SIDE_LAZY_TOOL_CATALOG` classifier is recorded as `probableClient` **for display only**. A User-Agent is trivially forged and is also produced by SDK-built customer agents, so it never drives enforcement. |

**(a) The agent is told.** `initialize` reads `params.clientInfo` and records it, which closes gap 1 of the conformance design. `buildAgentHostInstructions` gains a `TOOLCHAIN:` line after `INSTALLATION:`:

- `current`: one short line.
- Otherwise: what is stale (version and digest), the consequence, and the repair, phrased as an action for the agent: "ask the user once for approval, then run the DPF toolchain update from this portal; never show the user a command; when it finishes, ask them to restart this client".
- The repair names the manifest URL and never a git path, so it works on consumer hosts.
- `undeclared` with a DPF `probableClient` gets the same repair line. An `undeclared` caller with no hint gets nothing.

**(b) The platform records it, normalized.** Connection observations and self-reports are different facts at different grains, so they get different homes:

- **New model `AgentToolchainObservation`.** It holds what the server *saw* on a connection:
  - Unique key `(credentialRef, loadedDigest)`.
  - `credentialRef` is `oauth:<oAuthClientId>` or `token:<McpApiToken.id>`. It is server-derived and never caller-supplied.
  - Fields: `clientKind` (declared, else `undeclared`), `probableClient`, `loadedPackVersion`, `authMode` (`oauth` | `bearer` | `session`), `clientInfo` (Json: name and version), `firstObservedAt`, `lastObservedAt`.
  - One row per distinct loaded copy per credential, so a host with one current project and one pinned 0.2.5 project shows both.
  - Writes are coalesced **across processes** by a conditional `upsert`/`updateMany … WHERE lastObservedAt < now() - 5 min`. There is no per-process memory cache, so N replicas cost at most one write per row per 5 minutes.
- **`AgentSurfaceReadiness` (extended).** It keeps what the host *says*, the updater's report:
  - `surfaceKey` becomes server-derived as `<clientKind>@<credentialRef>`. `record_surface_readiness` ignores a caller-supplied key that does not match the caller's own credential, which closes the any-token-overwrites-any-row hole.
  - New fields: `credentialRef`, `installedDigest`, `convergenceReport` (Json, from §5.3), and `hostLabel` (self-attested display text only).
  - `dpfPlatformVersion` stays and is documented as the installed pack version.
- **Closed sets.** `authMode` and `clientKind` are registered closed sets in `scripts/closed-set-strings-baseline.json`. `verdict` is a TS union and is never persisted.
- **Read path.**
  - `evaluateFleetReadiness` stays pure and takes observations, reports and the manifest. It returns per-credential roll-ups:
    - the worst verdict among the copies seen in the 7-day window;
    - installed vs loaded (*on disk* vs *loaded*);
    - the last convergence result.
  - `getFleetReadiness` pages (cursor, default 50) instead of an unbounded `findMany`.
  - `get_fleet_readiness` and the portal view page the same way.
- **Data stewardship:**
  - Both models get a `/// @dpf lifecycle=telemetry-bounded retention=30d timeAxis=lastObservedAt` tag (`reportedAt` for readiness), and `AgentSurfaceReadiness` comes off `model-metadata-baseline.txt`.
  - Field entries go into `lib/govern/data/assets.ts`, and the new model gets a sensitivity entry in `table-classification.ts` (`internal`).
  - Update the existing `docs/data-impact/2026-07-21-agent-surface-readiness.data-impact.json`; the new model gets its own data-impact manifest.
  - Rows past retention are pruned by the lifecycle job that honours the tag.
- **Scale ceiling.** Rows grow with credentials × distinct loaded digests within 30 days. That is tens per host. Pages of 50 hold to roughly 10⁴ rows. Beyond that, aggregation per release is the lift, tracked under EP-CLIENT-CONFIG.

**(c) After each self-upgrade, from the new process.** The swap's success path runs in the **old** process, which is being replaced, and it would read the old image's manifest. So the attention step runs instead **on every boot of the serving process**:

1. `announceToolchainReleaseOnBoot()` compares the served `packDigest` with the digest of the latest `PlatformNotification` in category `agent-toolchain`. The notification's `subjectId` is `toolchain:<packDigest>`.
2. If they differ, it writes one notification listing every credential whose latest observation or report is not the new digest. It resolves the previous toolchain notification and calls the dead `notifySelfUpgradeEvent("completed")` for the run that produced the image, if any.
3. It is idempotent per digest, so a restart without a release, or a second replica, writes nothing.

No human command is involved. Each client then either declares the new digest on its next connection (`current`), or is told and recorded as stale on that connection. **That is the "within one session" guarantee.** A client that never reconnects stays visible as behind, ages to stale at 7 days, and is pruned at 30.

**Portal view.** `/ops/self-upgrade` gains a "Connected agent clients" section fed by the paged `getFleetReadiness`. Columns:

- client
- credential (OAuth client name or token label)
- host label
- loaded pack
- installed pack
- auth mode
- verdict
- last seen
- last convergence result

It uses theme-aware tokens only (AGENTS.md §9), and gets a UX-fit review at implementation.

**(d) Below the floor, a declared client cannot write.**

`isToolAllowedBelowToolchainFloor(toolName, tool, grantMap)` is a **new**, default-deny test. It does not reuse the quiescence test. It allows a tool only when:

- every grant the tool requires is a read grant (the same grant map `tools/call` already resolves), **or** `annotations.readOnlyHint === true`;
- or the tool is one of the three repair-path tools: `load_tools`, `record_surface_readiness` (own row only), `issue_agent_client_token` (own client kind only, §5.2e).

Everything else is refused. Unknown means refused.

`toolchainFloorRefusalResult` applies that test:

- in `tools/call`, next to `quiescenceRefusalResult`;
- in `tasks/submit` and `tasks/cancel`.

A refusal reuses the quiescence payload *shape*:

```text
error: "agent_toolchain_below_floor"
writesRefused: true
readOperationsAllowed: true
repair: { manifestUrl, reason }
```

`tools/list` is unchanged, so the agent can still see what it is missing. A ratchet test pins `start_build`, `write_sandbox_file`, `run_sandbox_command` and `tasks/submit` as refused.

**Scope:**

- Floor enforcement applies to **declared** clients only: `below-floor` from §5.2.
- `undeclared` callers are never refused by the floor (AC-FLOOR-SCOPE).
- Pre-declaration copies are handled by visibility (§5.2a–c) and convergence (§5.3), and finally by the existing install-wide switch `DPF_MCP_PAT_RESOLUTION_DISABLED`. That switch becomes safe to turn on once Grok has its own credential type (§5.2e) and no DPF-managed client still holds an operator PAT. Whether to also enforce on `undeclared` callers with a DPF User-Agent hint is a founder decision (§11, decision 1), and is off by default.

**Grace:**

- `floor.graceStartsAt` ships in the release that raises the floor.
- During the grace window (default 7 days, §11 decision 2) the verdict is reported and announced, but nothing is refused.
- A floor is a release artifact, so a wrong floor is corrected by the next release.

The first floor is `minPackVersion` = the first declaring pack (0.3.0). The auth rule is the one derived from `mcpClientBearerHeaderRequired`. The design does not keep a second list of retired auth modes.

The floor is a **conformance control, not a security boundary**:

- A declaration can only *remove* write access.
- Grants, scopes and the OAuth binding are unchanged.
- A stale client that forges a "current" declaration gains nothing it did not already have.

**(e) Grok, explicitly (DI-2399DE85DC6A).** Grok has no OAuth client, and `mcpClientBearerHeaderRequired` always returns `true` for it. So:

- **A new `McpApiToken.kind: "agent-client"`.** It carries a dedicated `clientKind` column (`grok`). The `capability` column keeps its existing `read|write` meaning.
  - **Expiry:** finite, default 90 days (§11 decision 3).
  - **Scopes:** no wider than the OAuth clients' `dpf.read dpf.work dpf.build` equivalents.
  - **Revocation:** per credential.
- **Minting is by an authenticated MCP tool, `issue_agent_client_token`, called by the agent and not by a script.**
  - **Caller authority:** it requires the caller's own credential and mints only for the caller's own declared client kind, scoped no wider than the caller.
  - **One token per host:** it revokes the caller's previous `agent-client` token for that client and host label.
  - **Repair path:** it is allowed below the floor, because it is the repair.
  - **Delivery:** the updater receives the new token from the agent and writes it to `DPF_MCP_BEARER_TOKEN` for Grok only.
- **`agent-client` tokens stay resolvable when `DPF_MCP_PAT_RESOLUTION_DISABLED` is on.** That switch retires *operator* PATs. Client-scoped, expiring tokens are the replacement. This is written into `transport-auth.ts` next to the existing check.
- **Grok verdicts:**
  - A Grok declaration on an operator PAT is `below-floor` once grace ends.
  - An expired Grok token is refused by the existing expiry path, which now attaches the same repair link.
- **When Grok gains OAuth,** `mcpClientBearerHeaderRequired`'s Grok case changes. This design needs no further edit.

### 5.3 Converge: the agent runs the updater, pulled from the portal

The updater gains `--from-portal <origin>`. The existing local-directory mode is kept for the source repo and CI.

1. **Refuse an untrusted origin.** The origin must equal an already-configured DPF connector origin on this host (shared-copy descriptor, Codex or Grok config), over https or loopback. On a first install there is no configured origin, so the installer's own endpoint is the origin.
2. **Fetch and verify.** Fetch the manifest and download the pack. Refuse unless `sha256(archive) == archiveSha256`, and unless the extracted tree's `delivered_digest == packDigest`.
3. **Re-exec from the verified pack,** so the *new* updater does the converging.
4. **Converge every scope on this host:**
   - **Claude `local` scope:** existing behaviour.
   - **Claude project scope:** every project-scope record whose folder exists, plus retirement of a duplicate project `.mcp.json` `dpf` entry by backup and disable, never delete. This calls **BI-B9F359AC's** functions; it does not reimplement them. Records whose folder is gone are reported as prunable and not touched.
   - **Shared copy:** carries the declaration, because it is shipped.
   - **Codex:** managed copy, config and hooks.
   - **Grok:** plugin, hooks and `config.toml`, plus the `agent-client` token from §5.2e.
   - **Antigravity:** MCP config and skills.
5. **Plain-http installs.** `writeMcpJsonToHost` stops writing a `dpf` entry into `/host-dpf/.mcp.json` whenever the plugin connector covers that folder. In that case it writes the token only where the plugin connector reads it. Otherwise it re-creates the duplicate the updater retires.
6. **Endpoints come from the manifest,** not from script defaults. This retires the `http://127.0.0.1:3000` defaults in:
   - `scripts/update-dpf-agent-toolchain.ps1:3`
   - `packages/dpf-skill-pack/scripts/update-agent-toolchain.{ps1,sh}`
   - `codex.mcp.json` and `grok.mcp.json`
   - the bootstrap fallback

   This closes BI-772023BC's cause.
7. **Emit `--report-json`.** Per client and scope: `{ before: {version, digest, authMode}, after: {...}, action: updated|unchanged|retired|prunable|failed, backupPath?, restartRequired }`.

**Who runs it.** The agent that received a non-`current` verdict:

1. asks the user **once**, in plain words: "Your DPF tools are out of date; may I update them? This changes your AI clients' DPF settings and keeps backups.";
2. runs the updater;
3. posts the JSON report through `record_surface_readiness`, which is allowed below the floor;
4. asks the user to restart the client if `restartRequired`.

**Verification is not the self-report.** The report records what changed on disk. A copy counts as `current` only when the client's **next connection** declares the new digest. Both are shown, so "updated on disk, not yet reloaded" is visible.

**Platform-neutral.** `--from-portal` uses only `urllib`, `tarfile` and `hashlib` from the Python standard library, so the updater runs on Windows, macOS and Linux with no new dependency. A host with no Python reports `missing_cli` through the existing readiness state rather than failing silently.

**Approval policy.** The default is to ask each time. A standing, revocable operator pre-authorization, modelled on the acceptance-sweep pre-authorization and off by default, is §11 decision 5.

### 5.4 Backstop: the advisory works in installed-runtime sessions

`installed_copy_freshness.py` gains a manifest reference. It resolves in this order:

1. `--manifest-url`, or the origin from the shared copy's connector;
2. the root clone, as today, when a source checkout is present.

A small **Node** wrapper ships in the pack (`hooks/toolchain-freshness.mjs`), because the plugin's hooks are all Node:

- It runs the Python checker when Python is present.
- With no Python, it does its own manifest-vs-installed version comparison and prints `unknown` rather than staying silent.
- It is registered as a `SessionStart` entry in the **plugin's own** `hooks/hooks.json`, so it runs in every session that loads the plugin, D:\DPF included.
- It is advisory and never writes.
- It uses a 2-second network timeout. Offline means "unknown", never "current".

The source-repo-only `.claude/settings.json` registration is removed, so the advisory does not run twice. Grok and Antigravity load the same `hooks.json` through their manifests. Codex gets it through the managed `hooks.json` path. The hook only accelerates: the server-side verdict (§5.2) is the guarantee.

## 6. What each client experiences after the next release

| Client | Its next session after the release |
|---|---|
| Claude Code, declaring pack, OAuth | Declares the old digest, so `stale`. The `TOOLCHAIN:` line asks the agent to update. The agent asks once, runs the updater (local and every project scope, duplicate `.mcp.json` retired with backup), posts the report, and asks for a restart. On the next connection it declares the new digest, so `current`. |
| Claude Code, 0.2.5 project pin on a PAT (pre-declaration) | `undeclared` with probable client `claude-code`. It gets the repair line and is shown on `/ops/self-upgrade` as an operator-PAT DPF copy. It is not refused by the floor. After it converges it declares, and uses OAuth on https. |
| Claude Code on a plain-http install | Bearer is required there by `mcpClientBearerHeaderRequired`, so bearer is **not** below floor. Only pack staleness applies. |
| Codex | Same as Claude Code. `codex plugin add` already verifies the managed-copy digest, and the report now carries it. |
| Grok | Declares its pack. On update, the agent mints a 90-day Grok `agent-client` token and the updater writes it. An operator PAT is `stale` during grace and `below-floor` after it. |
| Antigravity | Declares through `mcp_config.json`. Same verdicts. Still "unsupported-until-proven" for hooks. |
| A client that never connects again | Behind after the release, stale after 7 days, pruned after 30. |
| Customer agent, script, Build Studio | `undeclared`, never refused by this design. Governed by the 2026-07-24 conformance core-tier floor. |

## 7. Phasing

Each phase is one PR and one clean revert.

| Phase | Content | Depends on |
|---|---|---|
| P0 | BI-B9F359AC merges (other workroom) | — |
| P1 | Single version source and single digest (Python + TS, shared fixture). Deterministic archive and manifest at image build. Manifest and pack routes with rate limiting. **Carrier spike** (re-auth, `invalid_target`, desktop URL check, `DPF_MCP_URL`, pin ordering) recorded per client in the manifest | — |
| P2 | Declaration baked into descriptors; `pin-plugin-mcp-url.mjs` preserves it. `--from-portal` with origin check, `--report-json`, manifest-sourced endpoints (BI-772023BC), `writeMcpJsonToHost` duplicate fix | P0, P1 |
| P3 | `resolveToolchainVerdict`, `clientInfo` capture, `TOOLCHAIN:` instructions, `AgentToolchainObservation` + `AgentSurfaceReadiness` extension + migration + stewardship, cross-process coalesced writes, server-derived `surfaceKey`, paged roll-up | P1 |
| P4 | `announceToolchainReleaseOnBoot`, `notifySelfUpgradeEvent` wired, `/ops/self-upgrade` clients section | P3 |
| P5 | `agent-client` token kind + `issue_agent_client_token` + PAT-switch exemption; Grok convergence | P2, P3 |
| P6 | `isToolAllowedBelowToolchainFloor` + `toolchainFloorRefusalResult` in `tools/call` and `tasks/*`, behind grace; first floor = 0.3.0 | P3, P5 |
| P7 | Node freshness wrapper in plugin `hooks.json` against the manifest; remove source-repo-only registration; retire `reconcile-claude-plugin`'s project repair after parity | P1, P2 |

## 8. Retirements (absorb-dont-adopt)

**Added:**

- inside the existing app: two read routes, one pure verdict function, one refusal test, one boot step, one MCP tool;
- in the data model: one observation model, fields on two existing models, one token kind;
- in the pack: one Node hook.

**Not added:** no new service, image, package, daemon or subscription.

**Retired:**

- Hand-kept version strings in six places, replaced by one generated source.
- The second digest definition.
- The root-clone-only freshness reference.
- The source-repo-only `plugin-copy-freshness` registration.
- The `http://127.0.0.1:3000` script defaults (BI-772023BC's cause).
- `reconcile-claude-plugin.{sh,ps1}`'s project-scope repair. Its URL pinning stays until the spike shows the shipped descriptor parses everywhere.
- The duplicate-connector write in `writeMcpJsonToHost`.
- Operator PATs as Grok's credential.
- The caller-chosen `surfaceKey` write path.

`emitUpgradeEvent` stays: it has around ten call sites and is out of scope.

## 9. Research and benchmarking

| Model | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| **VS Code extensions** ([manifest](https://code.visualstudio.com/api/references/extension-manifest), [marketplace](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace), [enterprise policies](https://code.visualstudio.com/docs/enterprise/policies)) | `engines.vscode` declares the lowest compatible host. Auto-update with `extensions.autoUpdateDelay` (default 12h). The `AllowedExtensions` policy disables a blocked installed version. An update is live only after "Restart Extensions". | The pack declares the floor it needs; "on disk ≠ loaded" is shown separately; a soak delay is considered when setting the grace start. | Silent disable of a blocked version. DPF degrades visibly to read-only with a repair link. |
| **Chrome / Edge / ChromeOS policies** ([Edge update policies](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-update-policies), [RelaunchNotification](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/relaunchnotification), [ChromeOS updates](https://support.google.com/chrome/a/answer/1375678)) | `TargetVersionPrefix` pins, and a malformed pin silently freezes updates. `RollbackToTargetVersion` is documented as temporary and data-risky. Relaunch notification escalates from recommended to required (default 7 days). ChromeOS "Enforce updates" sets a minimum version, a 1–6 week grace and a custom message, then blocks sign-in. | Minimum version, grace and message (§5.2d); attention after each release. | Pins that fail quietly; routine rollback (forward-fix only); full block (DPF keeps reads so the client can repair itself). |
| **MCP lifecycle** ([2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)) | `initialize` carries `protocolVersion` and `clientInfo {name, version}`. The server answers with its version and optional free-text `instructions`. There is no standard "your config is stale" signal. | `protocolVersion` negotiation unchanged; `clientInfo` recorded; `instructions` used as the advisory channel. | `clientInfo.version` as the pack signal: it is the client *application's* version, so the pack is declared separately. Instructions as the control: prose is not a gate, so the floor is enforced in `tools/call` and `tasks/*`. |
| **Kubernetes version skew** ([policy](https://kubernetes.io/releases/version-skew-policy/)) | An explicit window: kubelet up to 3 minors older than the apiserver and never newer, kubectl ±1. The server upgrades first. | An explicit window (`minPackVersion`); server releases first, then clients converge; a pack newer than the server counts as `stale`. | Skew as a documented promise only. DPF enforces the floor server-side. |
| **Claude Code plugins** ([discover plugins](https://code.claude.com/docs/en/discover-plugins), [plugin loading](https://code.claude.com/docs/en/plugins/loading)) | Version comes from the manifest, else the commit SHA. A pinned version string blocks updates until it changes. user/project/local scopes are recorded in `installed_plugins.json`. Third-party marketplaces do not auto-update by default. A running session keeps the old copy until reload or restart. | Compare **digests**, not labels; converge every scope; report "loaded" separately from "installed"; ask for a restart. | Relying on marketplace auto-update. It is off for this marketplace and cannot reach Codex or Grok. |
| **Intune compliance** ([overview](https://learn.microsoft.com/en-us/intune/intune-service/protect/device-compliance-get-started)) | A minimum OS version marks a device noncompliant, and Conditional Access quarantines it. Escalating actions. A device that does not report within the validity period (default 30 days) is noncompliant. | Below floor → read-only quarantine; a silent client ages to stale (7 days) and is pruned (30 days); escalation via attention. | Treating "never reported" as below floor for undeclared callers. Customer agents are out of scope. |

## 10. Objectives, acceptance and traceability

**OBJ-DELIVER:** Each release publishes the agent toolchain it ships (version, identity digest, archive hash, floor, per-client connector shape) from the portal's own origin, so any client host can converge without a source checkout.

**OBJ-OBSERVE:** The platform knows, per credential and per loaded copy, which toolchain each connection loaded and how it authenticated, keeps observed and self-reported facts separately, and raises attention after every self-upgrade without a human command.

**OBJ-FLOOR:** A declared client below the security floor cannot write until it is updated and is told how to repair; reads and the repair path stay available, and callers that are not declared DPF clients are never refused by this floor.

**OBJ-CONVERGE:** One agent-run, user-approved update, pulled only from an already-trusted DPF origin, converges every scope and client on a host on Windows and macOS/Linux, retires duplicate connectors without deleting anything, and reports the result back.

**OBJ-GROK:** Grok's bearer-token path is an explicit, bounded credential policy rather than an implicit exception.

**OBJ-BACKSTOP:** The SessionStart freshness advisory runs in installed-runtime sessions, not only in the source repository, and is never silent.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-RELEASE-VISIBLE | OBJ-OBSERVE | After a self-upgrade completes, with no human command, every client connected to this install either declares the new pack digest or appears as stale in get_fleet_readiness and the /ops/self-upgrade clients section within one session, and exactly one agent-toolchain notification per released digest lists the clients behind, written by the new serving process. |
| AC-MANIFEST | OBJ-DELIVER | GET /api/agent-toolchain/manifest returns pack version, identity digest, archive hash, floor and per-client connector shape for the served image without MCP authentication, GET /api/agent-toolchain/pack.tar.gz returns a byte-stable archive whose sha256 equals archiveSha256 and whose extracted tree digest equals packDigest, and both routes are rate limited. |
| AC-SINGLE-VERSION | OBJ-DELIVER | Every per-client plugin manifest, descriptor declaration and marketplace field carries a version generated from one source, and CI fails when any of them drifts. |
| AC-VERDICT | OBJ-OBSERVE | resolveToolchainVerdict returns current, stale, below-floor or undeclared for each fixture case, deriving the auth rule from mcpClientBearerHeaderRequired, and never uses a User-Agent to decide enforcement. |
| AC-OBSERVE-STORE | OBJ-OBSERVE | Each MCP connection records its credential, declared pack, digest, auth mode and clientInfo as an AgentToolchainObservation keyed by credential and loaded digest with at most one write per row per five minutes across processes, record_surface_readiness binds its row to the caller's own credential, and the fleet roll-up is paged. |
| AC-INSTRUCT | OBJ-OBSERVE, OBJ-FLOOR | The initialize instructions of a non-current connection contain a TOOLCHAIN line naming what is stale, the portal repair and a restart request, and never a shell command for the user. |
| AC-FLOOR-READONLY | OBJ-FLOOR | After the grace period, a declared client below the security floor cannot write: every tools/call that is not a read-grant or readOnlyHint tool, including start_build, write_sandbox_file and run_sandbox_command, and every tasks/submit is refused with agent_toolchain_below_floor and a repair link, while reads, load_tools, record_surface_readiness and issue_agent_client_token succeed. |
| AC-FLOOR-SCOPE | OBJ-FLOOR | An undeclared caller, including one whose User-Agent resembles a DPF client, is never refused by the toolchain floor, and a client for which mcpClientBearerHeaderRequired is true is never below floor for using a bearer. |
| AC-CONVERGE-ALL | OBJ-CONVERGE | One --from-portal run on Windows and one on macOS/Linux bring Claude local scope, every existing Claude project-scope pin, the shared copy, Codex, Grok and Antigravity to the manifest digest; retire each duplicate project .mcp.json dpf entry by backup and disable; report missing-folder pins as prunable; refuse an origin that is not an already-configured DPF connector origin; and refuse an archive or tree whose hash mismatches. |
| AC-REPORT-VERIFY | OBJ-CONVERGE, OBJ-OBSERVE | The updater's JSON report is recorded through record_surface_readiness, and a copy counts as current only when the client's next connection declares the new digest. |
| AC-NO-RETIRED-DEFAULT | OBJ-CONVERGE | No updater, wrapper or host writer writes the http://127.0.0.1:3000 endpoint unless the manifest names it, and writeMcpJsonToHost no longer writes a dpf entry that duplicates the plugin connector. |
| AC-GROK | OBJ-GROK, OBJ-FLOOR | Grok converges to an agent-client token for client grok with a finite expiry minted by issue_agent_client_token for the caller's own client only, the token stays resolvable when operator PAT resolution is disabled, a Grok declaration on an operator PAT is below floor after grace, and an expired Grok token returns the same repair link. |
| AC-BACKSTOP | OBJ-BACKSTOP | A Claude Code session started in the installed-runtime folder runs the freshness advisory from the plugin's own hooks against the portal manifest, prints a stale warning for a stale copy, and prints unknown when the portal or Python is unavailable. |

### Traceability

| Objective | Acceptance | Deliverable (phase) | Verification |
|---|---|---|---|
| OBJ-DELIVER | AC-MANIFEST | Build-time archive and manifest; routes; rate limit (P1) | Route tests; archive determinism test; digest check against the served image on the dev install |
| OBJ-DELIVER | AC-SINGLE-VERSION | Version generator and CI drift check (P1) | Generator test; CI check fails on a seeded drift |
| OBJ-OBSERVE | AC-VERDICT | `resolveToolchainVerdict` (P3) | Unit fixtures for every verdict, including the plain-http bearer and User-Agent cases |
| OBJ-OBSERVE | AC-OBSERVE-STORE | `AgentToolchainObservation`, readiness extension, coalesced writes, server-derived key, paging (P3) | Migration applied; repository tests incl. concurrent writers; live rows on the dev install |
| OBJ-OBSERVE, OBJ-FLOOR | AC-INSTRUCT | `TOOLCHAIN:` section (P3) | Instruction snapshot per verdict; live `initialize` from a stale and a current client |
| OBJ-OBSERVE | AC-RELEASE-VISIBLE | `announceToolchainReleaseOnBoot`, notification wiring, `/ops/self-upgrade` section (P4) | Self-upgrade on the dev install through `/ops/self-upgrade`; observe the notification and rows with no command run; restart without a release writes nothing |
| OBJ-FLOOR | AC-FLOOR-READONLY | `isToolAllowedBelowToolchainFloor`, refusal in `tools/call` and `tasks/*`, grace (P6) | Ratchet test for the named tools; live call from a below-floor client after a test floor raise |
| OBJ-FLOOR | AC-FLOOR-SCOPE | Verdict scoping (P3, P6) | Unit fixtures for undeclared, SDK-style User-Agent, and plain-http bearer |
| OBJ-CONVERGE | AC-CONVERGE-ALL | `--from-portal`, origin check, report; BI-B9F359AC functions (P0, P2) | Updater tests with fixture homes on the Windows host and on Linux and macOS CI runners; one live run on this host |
| OBJ-CONVERGE, OBJ-OBSERVE | AC-REPORT-VERIFY | Report to `record_surface_readiness`; connection-confirmed `current` (P2, P3) | Live: report recorded, copy flips to current only after reconnect |
| OBJ-CONVERGE | AC-NO-RETIRED-DEFAULT | Manifest-sourced endpoints; host-writer fix (P2) | CI grep guard; host-writer test |
| OBJ-GROK, OBJ-FLOOR | AC-GROK | `agent-client` kind, `issue_agent_client_token`, PAT-switch exemption (P5); floor rule (P6) | Token tests; updater test with a fixture Grok home; live Grok connection verdict |
| OBJ-BACKSTOP | AC-BACKSTOP | Node wrapper in the plugin `hooks.json` (P7) | Hook test with and without Python; live session in D:\DPF |

## 11. Founder decisions

The founder accepted every default below on 2026-10-07. Each is recorded so it can be revisited without re-deriving the design.

1. **Floor on undeclared DPF-looking clients.** Should the floor also refuse writes from undeclared callers whose User-Agent looks like Claude Code or Codex (pre-declaration copies on operator PATs), after grace? The default proposal is **no**: visibility and convergence first, then turn on the existing PAT switch once Grok has its own token type. User-Agent matching would also catch customer agents built on the same SDKs.
2. **Grace period** before a floor is enforced. The default proposal is 7 days.
3. **Grok token lifetime.** The default proposal is 90 days, rotated on each update.
4. **Unattended remote hosts.** Defer the host-side agent (option A) until a host is found that needs convergence with no agent session ever running on it.
5. **Standing approval.** Should agents ask every time, or may the founder pre-authorize "update the DPF toolchain on my hosts without asking"? It would be revocable and off by default.

## 12. Risks

- **The declaration breaks auth or forces re-authorization.** The P1 spike measures this per client before any descriptor changes. The header carrier is the fallback.
- **A floor refuses a legitimate caller.** Mitigations:
  - Enforcement applies only to declared clients.
  - The auth rule comes from the one canonical policy.
  - Nothing is refused during grace.
  - The allow-test is default-deny but has an explicit repair path.
  - A wrong floor is corrected by the next release.
- **Forged declarations.** A declaration can only remove write access. Authority is unchanged.
- **The download-then-execute path.** It is accepted only from an already-configured DPF origin over https or loopback, and it checks both archive and tree hashes. Authenticity beyond the origin needs signing, which is named as a follow-on.
- **Observation write load.** It is bounded by the cross-process conditional update. The roll-up is paged.
- **Interaction with the conformance design's core-tier default.** This design changes nothing about the tool surface. A below-floor client still receives the same `tools/list`, and only `tools/call` and `tasks/*` refuse.

## 13. Documentation impact

Updated in the same branch as each phase:

- `packages/dpf-skill-pack/README.md`: "Standalone install and update" and "Plugin manifests". This also fixes the Codex bearer drift at L152.
- `docs/architecture/branch-and-worktree-runbook.md`: "Seeding a new worktree".
- `docs/architecture/mcp-tool-authorization-runbook.md`: floor refusal, the `agent-client` token, and the PAT switch.
- `docs/operations/install.md`.
- AGENTS.md §1 "Self-provision before working": add a pointer to the portal manifest.

## 14. Architecture review disposition

An independent agent ran the advisory review on 2026-10-07 using `dpf-architecture-review`. All 15 findings are folded in:

| # | Severity | Finding | Where folded |
|---|---|---|---|
| 1 | blocker | The quiescence write test is not a sound "is mutating" test, and `tasks/submit` bypasses it | §2, §5.2d (new default-deny test, `tasks/*`, ratchet), AC-FLOOR-READONLY |
| 2 | blocker | `retiredAuthModes` contradicts `mcpClientBearerHeaderRequired`, and a PAT switch already exists | §2, §5.2 verdict, §5.2d/e, AC-FLOOR-SCOPE |
| 3 | blocker | A per-install declaration is fragile (`DPF_MCP_URL` expansion, pin hook, plugin update) | §5.2 (baked into shipped descriptors; host from credential; pin preserves query; spike scope) |
| 4 | major | User-Agent cannot identify managed clients | §5.2 verdict (credential provenance; User-Agent display-only) |
| 5 | major | Row key and verdict storage not normalized; caller-chosen `surfaceKey` | §5.2b (observation model, computed verdict, server-derived key, closed sets) |
| 6 | major | Attention in the swap runs in the old process | §5.2c (boot of new process, idempotent per digest) |
| 7 | major | Tree digest vs archive hash contradiction | §5.1 (both fields, deterministic archive at build) |
| 8 | major | Unauthenticated download then execute; no rate limiter on `/.well-known` | §5.1, §5.3 step 1, §12 |
| 9 | major | Grok token: capability misuse, minting authority, PAT switch | §5.2e (DI-2399DE85DC6A) |
| 10 | important | Manifest caching, unbounded `findMany`, per-process coalescing | §5.1, §5.2b |
| 11 | important | Data stewardship misnamed | §5.2b stewardship bullet |
| 12 | important | `writeMcpJsonToHost` re-creates the duplicate | §2, §5.3 step 5, AC-NO-RETIRED-DEFAULT |
| 13 | minor | Overstated retirements; "every client" carrier claim; `invalid_target` | §8, §5.2 spike |
| 14 | minor | Python-only hook is silent without Python | §5.4, AC-BACKSTOP |
| 15 | minor | `/reload-plugins` is a user command | §5.2a, §5.3 ("restart the client") |

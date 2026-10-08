# Plan — a release delivers and verifies the agent toolchain on every client

- **Umbrella item:** BI-D4BB5AE3 (delivery-large), Workroom WC-7C3279BB
- **Design:** [2026-10-07-agent-toolchain-release-delivery-design.md](../specs/2026-10-07-agent-toolchain-release-delivery-design.md)
- **Epic:** EP-CLIENT-CONFIG
- **Decisions:** DI-7FFCDEC4AB67 (shape), DI-2399DE85DC6A (Grok credential)

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Decomposition decision

**Decision: decomposed.** Each phase in the design's §7 ships on its own and can be reverted cleanly without the others, so each maps to its own backlog item. Dependencies are sequencing only.

| Phase | Deliverable | Backlog item | Depends on |
|---|---|---|---|
| P0 | Claude project-scope convergence and duplicate `.mcp.json` retirement | BI-B9F359AC (existing, other workroom WC-547B5CFC) | — |
| P1 | Publish: one version source, one digest, deterministic archive, manifest and pack routes, carrier spike | BI-52934B3E | — |
| P2a | Manifest-sourced endpoints; retire the `http://127.0.0.1:3000` defaults | BI-772023BC (existing) | P1 |
| P2b | `--from-portal` convergence, declaration in shipped descriptors, JSON report, host-writer duplicate fix | BI-DE1E6485 | P0, P1, P2a |
| P3 | Verdict, `clientInfo`, `TOOLCHAIN:` instructions, observation store | BI-54469E18 | P1 |
| P4 | Announce on boot after a release; `/ops/self-upgrade` clients section | BI-E7974C18 | P3 |
| P5 | Grok `agent-client` token | BI-84C1F526 | P2b, P3 |
| P6 | Floor enforcement (read-only below floor) | BI-DFC0270C | P3, P5 |
| P7 | Installed-session freshness advisory | BI-A67B65F4 | P1, P2b |
| P8 | Client capabilities as one verified profile, drift flag, weekly re-verification | BI-64795FD0 | P3 |

## Phases

### P1 — Publish (BI-52934B3E)

**Files:**
- `packages/dpf-skill-pack/toolchain-version.json` (new): `packVersion`, `floor`.
- Version generator under `scripts/` with a `--check` mode, wired into CI. It writes `.claude-plugin/plugin.json`, `.grok-plugin/plugin.json`, `.antigravity-plugin/plugin.json`, the Codex manifest, root `.claude-plugin/marketplace.json` (`plugins[].version` and `metadata.version`) and `.agents/plugins/marketplace.json`.
- `packages/dpf-skill-pack/scripts/installed_copy_freshness.py`: `delivered_digest` becomes the shared module. `update_agent_toolchain.py` `codex_content_version` derives from it. A TS port goes in `apps/web/lib/agent-toolchain/pack-digest.ts`, tested against a shared fixture tree.
- `Dockerfile`: build step producing `toolchain-manifest.json` and the deterministic `agent-toolchain.tar.gz`.
- `apps/web/app/api/agent-toolchain/manifest/route.ts` and `pack.tar.gz/route.ts` (new), using `apps/web/lib/api/rate-limit.ts`. The manifest is loaded once per process.
- Sign the manifest at load with the installation identity key (`lib/federation/instance-identity.ts`, key from `demand-identity.ts`); include `signature`, `signingPublicKey` and `deviceId` (AC-AUTHENTIC).

**Spike:**
- Measure for Claude Code (CLI and desktop), Codex and Antigravity:
  - whether changing the query re-authorizes;
  - whether OAuth fails with `invalid_target`;
  - the desktop app's `verifyPluginMcpBinding` check;
  - behaviour with `DPF_MCP_URL` set;
  - the ordering between the pin hook and the updater.
- Record the result per client in the manifest's `clients` map, and the evidence on BI-52934B3E.

**Verification:** AC-MANIFEST and AC-SINGLE-VERSION, via:
- route tests;
- a determinism test (two builds give byte-identical archives);
- a seeded-drift CI failure;
- after release, `GET` both routes on the dev install and compare digests.

**Rollback:** remove the routes. The generator is additive.

### P2a — Manifest-sourced endpoints (BI-772023BC)

**Files:**
- `scripts/update-dpf-agent-toolchain.ps1:3`
- `packages/dpf-skill-pack/scripts/update-agent-toolchain.{ps1,sh}`
- `packages/dpf-skill-pack/codex.mcp.json`, `grok.mcp.json`
- the bootstrap fallback in `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` and `installer/lib/mcp-client-env.ps1`

**Verification:** AC-NO-RETIRED-DEFAULT (wrapper part), via a CI grep guard and an updater test.

**Rollback:** revert the PR.

### P2b — Converge from the portal (BI-DE1E6485)

**Files:**
- `packages/dpf-skill-pack/scripts/update_agent_toolchain.py`:
  - `--from-portal` with an origin check against configured connector origins;
  - `--expect-installation did_…` plus the `~/.dpf/trusted-installations.json` pin; Ed25519 verification before any download is extracted (AC-AUTHENTIC);
  - `archiveSha256` and tree-digest verification;
  - re-exec from the verified pack;
  - `--report-json`;
  - calls to BI-B9F359AC's `converge_claude_project_plugins` and `converge_claude_project_connectors`.
- Descriptor generation: the declaration is written into `claude.mcp.json` and `antigravity.mcp.json` and into the Codex and Grok shapes, outside any `${DPF_MCP_URL}` expansion.
- `scripts/hooks/lib/pin-plugin-mcp-url.mjs` preserves the query.
- `apps/web/lib/auth/mcp-host-writer.ts` stops writing a duplicate `dpf` entry.
- Claude user/local scope: back up, then `claude mcp remove dpf -s user|local` for a `dpf` server that targets the DPF endpoint path.
- Run the `pin-plugin-mcp-url.mjs` step for every converged project-scope record, not only the source repo's.

**Verification:** AC-CONVERGE-ALL, AC-USER-SCOPE-DUPLICATE and AC-REPORT-VERIFY (updater part), via:
- `update_agent_toolchain_test.py` with fixture homes on Windows;
- the same suite on Linux and macOS CI runners;
- `mcp-host-writer` tests;
- one live `--from-portal` run on this host after release, its report recorded through `record_surface_readiness`.

**Rollback:** `--from-portal` is opt-in. Revert the PR to restore the descriptors.

### P3 — Observe (BI-54469E18)

**Files:**
- `apps/web/lib/agent-toolchain/toolchain-verdict.ts` (new, pure): `resolveToolchainVerdict`.
- `apps/web/lib/mcp/initialize.ts`: records `clientInfo`.
- `apps/web/lib/mcp/agent-host-instructions.ts`: `TOOLCHAIN:` section.
- `apps/web/lib/mcp/transport-auth.ts`: keep the OAuth `clientId` as `credentialRef`.
- `packages/db/prisma/schema/ai-coworker.prisma`: new `AgentToolchainObservation`, and fields added to `AgentSurfaceReadiness`, with a migration.
- `packages/db/src/table-classification.ts`, `apps/web/lib/govern/data/assets.ts`, `scripts/model-metadata-baseline.txt`, `scripts/closed-set-strings-baseline.json`.
- `docs/data-impact/2026-07-21-agent-surface-readiness.data-impact.json`, plus a new manifest for the observation model.
- `apps/web/lib/agent-toolchain/fleet-readiness.ts`: computed verdict and paging.
- `apps/web/lib/mcp/packs/surface-readiness-pack.ts`: server-derived `surfaceKey`.

**Verification:** AC-VERDICT, AC-OBSERVE-STORE and AC-INSTRUCT, via:
- verdict fixtures, including the plain-http bearer and SDK-style User-Agent cases;
- a repository test with two concurrent writers;
- instruction snapshots;
- the migration applied on the dev install through self-upgrade;
- live rows observed from this session's connection.

**Rollback:** the observation writes are fail-open. Revert the migration with a forward-only drop migration.

### P4 — Announce (BI-E7974C18)

**Files:**
- `apps/web/lib/agent-toolchain/announce-release.ts` (new): `announceToolchainReleaseOnBoot`, called from `apps/web/instrumentation.ts`.
- `apps/web/lib/self-upgrade/notification.ts`: wire `notifySelfUpgradeEvent`.
- The `/ops/self-upgrade` page: a "Connected agent clients" section with theme-aware tokens and a UX-fit review.

**Verification:** AC-RELEASE-VISIBLE, via:
- a unit test for idempotence per digest;
- a live self-upgrade through `/ops/self-upgrade` on the dev install, checking the notification and the clients section with no command run;
- a restart without a release, checking that nothing is written.

**Rollback:** revert. The notification is additive.

### P5 — Grok credential (BI-84C1F526)

**Files:**
- `packages/db/prisma/schema/core-identity.prisma`: `McpApiToken.clientKind`, and the `agent-client` kind.
- `apps/web/lib/auth/mcp-api-token.ts`.
- `apps/web/lib/mcp/transport-auth.ts`: exempt `agent-client` from `isPatResolutionDisabled`.
- An `issue_agent_client_token` MCP tool in an existing auth pack.
- The updater's Grok path.

**Verification:** AC-GROK, via:
- token tests;
- an updater test with a fixture Grok home;
- a live Grok connection verdict on this host.

**Rollback:** revert. Operator PATs keep working until the floor applies.

### P6 — Floor (BI-DFC0270C)

**Files:**
- `apps/web/lib/mcp/toolchain-floor.ts` (new): `isToolAllowedBelowToolchainFloor`, `toolchainFloorRefusalResult`.
- `apps/web/app/api/mcp/v1/route.ts`: `tools/call`, `tasks/submit`, `tasks/cancel`.
- The `floor` value in `toolchain-version.json`.

**Verification:** AC-FLOOR-READONLY and AC-FLOOR-SCOPE, via:
- a ratchet test on `start_build`, `write_sandbox_file`, `run_sandbox_command` and `tasks/submit`;
- scope fixtures;
- a live call from a below-floor client after a test floor raise on the dev install.

**Rollback:** lower `minPackVersion` in the next release. The grace period is the first line of safety.

### P7 — Backstop (BI-A67B65F4)

**Files:**
- `packages/dpf-skill-pack/hooks/toolchain-freshness.mjs` (new), registered in `packages/dpf-skill-pack/hooks/hooks.json`.
- `installed_copy_freshness.py` gets a manifest reference.
- Remove the `plugin-copy-freshness` and `reconcile-claude-plugin` project-repair registrations from the source repo's `.claude/settings.json` once parity is shown.

**Verification:** AC-BACKSTOP, via:
- hook tests with and without Python;
- a live session in D:\DPF.

**Rollback:** revert. The hook is advisory.

### P8 — Client capabilities stay current (BI-64795FD0)

**Files:**
- `packages/dpf-skill-pack/client-capabilities.json` (new).
- `packages/integration-shared/src/mcp-client-credential-policy.ts` reads it.
- `packages/dpf-skill-pack/scripts/mcp-credential-policy-cases.json` is generated from it.
- `docs/architecture/agent-client-capability-parity.md` gets a rendered matrix.
- `apps/web/lib/agent-toolchain/fleet-readiness.ts`: unverified-version flag.
- An intake call with the key `client-capability:<client>@<version>`.
- A weekly `scheduledAgentTask` on `apps/web/lib/actions/agent-task-scheduler.ts`.

**Verification:** AC-CAPABILITY-SOURCE and AC-CAPABILITY-DRIFT, via:
- generator and drift-check tests;
- policy tests showing unchanged behaviour for today's rows;
- a flag unit test;
- an intake dedupe test;
- the first scheduled run observed on the dev install.

**Rollback:** revert. Today's policy behaviour is preserved by the generated cases.

## Traceability

| Requirement | Verification | Contract | Flow | Backlog item |
|---|---|---|---|---|
| OBJ-DELIVER | AC-MANIFEST | GET /api/agent-toolchain/manifest | release publishes toolchain | BI-52934B3E |
| OBJ-DELIVER | AC-SINGLE-VERSION | toolchain-version.json | release publishes toolchain | BI-52934B3E |
| OBJ-CONVERGE | AC-NO-RETIRED-DEFAULT | toolchain-version.json | agent converges host | BI-772023BC |
| OBJ-CONVERGE | AC-AUTHENTIC | GET /api/agent-toolchain/manifest | release publishes toolchain | BI-52934B3E |
| OBJ-CONVERGE | AC-AUTHENTIC | update_agent_toolchain.py --from-portal | agent converges host | BI-DE1E6485 |
| OBJ-CONVERGE | AC-CONVERGE-ALL | update_agent_toolchain.py --from-portal | agent converges host | BI-DE1E6485 |
| OBJ-CONVERGE, OBJ-OBSERVE | AC-REPORT-VERIFY | record_surface_readiness | agent converges host | BI-DE1E6485 |
| OBJ-OBSERVE | AC-VERDICT | resolveToolchainVerdict | connection declares toolchain | BI-54469E18 |
| OBJ-OBSERVE | AC-OBSERVE-STORE | AgentToolchainObservation | connection declares toolchain | BI-54469E18 |
| OBJ-OBSERVE, OBJ-FLOOR | AC-INSTRUCT | buildAgentHostInstructions | connection declares toolchain | BI-54469E18 |
| OBJ-OBSERVE | AC-RELEASE-VISIBLE | announceToolchainReleaseOnBoot | release publishes toolchain | BI-E7974C18 |
| OBJ-GROK, OBJ-FLOOR | AC-GROK | issue_agent_client_token | agent converges host | BI-84C1F526 |
| OBJ-FLOOR | AC-FLOOR-READONLY | toolchainFloorRefusalResult | connection declares toolchain | BI-DFC0270C |
| OBJ-FLOOR | AC-FLOOR-SCOPE | resolveToolchainVerdict | connection declares toolchain | BI-DFC0270C |
| OBJ-BACKSTOP | AC-BACKSTOP | hooks/toolchain-freshness.mjs | agent converges host | BI-A67B65F4 |
| OBJ-CONVERGE | AC-USER-SCOPE-DUPLICATE | update_agent_toolchain.py --from-portal | agent converges host | BI-DE1E6485 |
| OBJ-CAPABILITY | AC-CAPABILITY-SOURCE | client-capabilities.json | release publishes toolchain | BI-64795FD0 |
| OBJ-CAPABILITY | AC-CAPABILITY-DRIFT | client-capabilities.json | connection declares toolchain | BI-64795FD0 |

## Risks and rollback

- **The carrier breaks auth.** No descriptor changes until the P1 spike measures it per client. The header carrier is the fallback.
- **The floor refuses a legitimate caller.** Only declared clients are enforced. The auth rule comes from `mcpClientBearerHeaderRequired`. The grace period applies, and the default-deny test has an explicit repair-path allowlist. The floor is lowered by the next release.
- **The migration lands on a live install.** It is additive only (new model, nullable fields), applied through `/ops/self-upgrade`, never by hand.
- **Overlap with BI-B9F359AC.** P2b calls its functions after it merges. If its updater report shape changes, P2b adapts; the other session has been asked to signal that.

## Backlog coverage

Pending. The umbrella is `delivery-large`, so `record_plan_backlog_coverage` needs the spec-approval baseline first. Spec approval needs independent reviewers, dispatched over a signed-in (OAuth) DPF connection. No coverage receipt exists yet, and implementation does not start until one does. The receipt, deliverable-to-item mappings and dependencies will be copied here when recorded.

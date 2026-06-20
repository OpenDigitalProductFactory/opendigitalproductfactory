# Easy Remote Edge Node Provisioning — Implementation Plan

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| BI | BI-D18DD7A9 (EP-EDGE-TOPOLOGY) |
| Design | [`2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`](../specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) §8 |
| Scope (this slice) | Backend: the command renderer + a server action that issues a scoped token and returns a ready-to-run command. UI + functional verification are the follow-on. |

## The gap

Putting an Edge Node on *separate hardware* today means: clone the whole monorepo on the second host (just for a compose file), hand-edit `.env`, copy a token out-of-band, then approve in the portal. The founder flagged this as "no easy way." Design §8's principle: **the operator never leaves the portal and never edits a file** — the portal holds the Authority URL and can mint a scoped token, so it should hand back a ready-to-run command.

## What this slice lands

1. **Pure renderer** — [`apps/web/lib/edge-node/remote-provisioning.ts`](../../../apps/web/lib/edge-node/remote-provisioning.ts):
   - `isLoopbackAuthorityUrl` / `assessAuthorityUrl` — catch the #1 remote footgun (a `localhost`/`127.*`/`::1`/`host.docker.internal` Authority URL that no other machine can reach) and flag insecure plain-HTTP.
   - `renderEdgeInstallCommands` — per host OS, a **no-clone, no-`.env`-edit** command: `curl` the single `docker-compose.edge-standalone.yml` by raw URL and `docker compose up` with the Authority URL + token passed inline as environment (PowerShell `Invoke-WebRequest` + `$env:` on Windows). Tokens/URLs are shell-quote-escaped.
   - `buildRemoteProvisioningPlan` — composes URL assessment + commands + the pending→approve reminder + the native-binary note.
   - **Works-today honesty:** the container path is real (the standalone compose + GHCR image exist). The signed, downloadable native Go binary (full-LAN fidelity on Windows/macOS) is **not** published yet, so it is surfaced as a *note*, never a runnable command that would 404.
2. **Server action** — `prepareRemoteEdgeProvisioningAction` in [`apps/web/lib/actions/edge-nodes.ts`](../../../apps/web/lib/actions/edge-nodes.ts): validates OS, **reuses `issueEdgeBootstrapTokenAction`** (one issuance path: `manage_platform` gate + scope validation + mint, through the running Authority — sidestepping the host-side `@dpf/db` blocker EP-BUILD-D78835), resolves the URL via `resolveAppBaseUrl`, and returns the plan.

## Verification

- `apps/web/lib/edge-node/remote-provisioning.test.ts` — exhaustive unit coverage (loopback/URL assessment, all three OSes, quote escaping, repo/ref override, plan assembly). Runs in CI.
- Executed source-local in the worktree via native Node type-stripping (toolchain-degraded host couldn't host vitest): **all assertions passed**.
- Typecheck + the vitest suite run in CI (worktree has no compile toolchain; runtime sandbox lease was unavailable — DPF MCP offline — per AGENTS.md §5 this is an *unrun* gate deferred to CI, not a red one).

## Follow-on (next slice, separate PR)

- **UI** on `/platform/edge-nodes`: an "Add a node on another machine" flow (OS picker, optional MSP customer/site or retail location, copy-button command block, URL-not-reachable warning). UI-impacting → carries a `UX-Fit-Decision` (AGENTS.md §12).
- **Functional verification** (VC-EDGE-REMOTE-EASY): drive the flow on the canonical install / shared sandbox; confirm a second host enrolls from the generated command with no clone/edit.
- **Native binary download** (signed release artifact) so the Windows/macOS default becomes the full-LAN path, not just enrollment proof.

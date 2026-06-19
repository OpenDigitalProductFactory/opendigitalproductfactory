# Edge Node Opt-In Default Flip — Implementation Plan

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| BI | BI-72CFF89D (EP-EDGE-TOPOLOGY) |
| Design | [`2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md`](../specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md) §5 |
| Scope | Make the bundled local edge node **opt-in** (default OFF) with Windows/bash parity; grandfather existing installs. No new tables. |

## The decision being implemented

Today the local edge node is silent **default-ON**: both installers bundle it, auto-issue an `--auto-approve` token, and auto-enroll it. The founder's directive: **opt-in where the platform is installed.** This is the *deploy* gate (does a node run here at all), distinct from the *trust* gate (remote nodes still land `pending` until approved — unchanged).

## Shared resolution rule (one rule, both surfaces)

Whether the local edge overlay is active resolves by precedence:

1. **Explicit** `DPF_INCLUDE_EDGE=0|1` env or `--with-edge` / `--no-edge` (`-WithEdge` / `-NoEdge` on PS).
2. **Recorded choice** — `install-state.json` `edge.enabled`.
3. **Grandfather** — no recorded choice but `.env` contains a non-empty `DPF_BOOTSTRAP_TOKEN=dpf...` ⇒ this is a pre-flip install with a bundled node; keep it ON (so an upgrade never silently removes a running node, design §5.3).
4. **Default OFF.**

Implemented as `dpf_resolve_edge_enabled` (bash, `state.sh`) and `Resolve-DpfEdgeEnabled` (PS, `state.ps1`), used by both the installer and the start scripts so the two host surfaces can never disagree.

## Tasks

1. **State helpers** — add `edge: { enabled, mode }` to the init template in `state.sh` + `state.ps1`; add the resolution helper to each.
2. **Bash installer** — `install-dpf.sh`: default `DPF_INCLUDE_EDGE` resolves via the helper (was hardcoded `:-1`); add `--with-edge`; keep `--no-edge`; update `--help`; write `edge` to install-state after resolution. The existing auto-issue block stays gated on `DPF_INCLUDE_EDGE=1` (now only runs when opted in — the chosen local node may auto-approve, consent = the choice).
3. **Compose chokepoint** — `compose.sh`: `dpf_compose_files` default `${DPF_INCLUDE_EDGE:-0}` (was `:-1`); update comment.
4. **Bash start** — `dpf-start.sh`: resolve via the helper (was hardcoded `:-1`); add `--with-edge`; keep `--no-edge`.
5. **Windows installer** — `install-dpf.ps1`: add `-WithEdge`/`-NoEdge`; resolve via helper; pass the resolved value to `Get-DPFComposeArgs -IncludeEdge`; gate `Invoke-DPFEdgeNodeBootstrap` on it; write `edge` to install-state. Fix the two hardcoded `composeArgs += edge.yml` call sites (lines ~375, ~425) to honor the resolved value.
6. **Windows fresh-install** — `fresh-install.ps1`: add `-WithEdge` (default off); gate the edge bootstrap block (lines ~299-392) on it.
7. **Windows start** — root `dpf-start.ps1` + `scripts/dpf-start.ps1`: resolve via helper; include the overlay only when enabled; add `-WithEdge`/`-NoEdge`.
8. **Docs** — update the default-on assertions: `docker-compose.edge.yml` header, `dpf-start.sh --help`, and any user-guide line that says the edge node is bundled by default.

## Verification

- `bash -n` on every changed `.sh`; `Parser::ParseFile` (no syntax errors) on every changed `.ps1`.
- `bash dpf-start.sh --dry-run` → chain **excludes** `docker-compose.edge.yml` by default; `bash dpf-start.sh --with-edge --dry-run` → chain **includes** it.
- Grandfather: with a `.env` containing `DPF_BOOTSTRAP_TOKEN=dpfboot_x`, `--dry-run` includes edge even with no flag.
- Full runtime (opt-in install actually enrolls a node; default install enrolls none) runs on the canonical install / shared sandbox per AGENTS.md §5 — VC-EDGE-OPTIN. The worktree gates are syntax + dry-run only (named as such).

## Status (2026-06-19) — implemented

All eight tasks landed. Source-local verification (worktree):

- `bash -n` clean on `state.sh`, `compose.sh`, `install-dpf.sh`, `dpf-start.sh`, `setup.sh`.
- PowerShell `Parser::ParseFile` clean on `state.ps1`, `install-dpf.ps1`, both `dpf-start.ps1`, `fresh-install.ps1`, `windows-edge-node-install.Tests.ps1`.
- Resolver unit tests (all precedence branches) green on both `dpf_resolve_edge_enabled` (bash) and `Resolve-DpfEdgeEnabled` (PowerShell): default OFF, explicit env 1/0, `.env`-token grandfather ON, recorded state on/off (state overrides grandfather).
- `dpf-start.sh --dry-run` → chain excludes `docker-compose.edge.yml` by default; `--with-edge` includes it.
- Pester suite `windows-edge-node-install.Tests.ps1` → 8/8 pass (incl. new "omits the Edge Node overlay by default" + updated opt-in chain test).

**Runtime gate still pending (VC-EDGE-OPTIN):** a real install on the canonical install / shared sandbox must confirm a default install enrolls **no** node and `--with-edge`/`-WithEdge` enrolls one (AGENTS.md §5). Worktree gates above are syntax + unit + dry-run only.

## Out of scope (separate BIs)

Richer setup prompt + portal "Add an edge node here/elsewhere" UX (BI-ED6B90C0, BI-D18DD7A9); footprint tests (BI-4B381171).

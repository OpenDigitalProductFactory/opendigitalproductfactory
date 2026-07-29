# Runtime Glossary

Canonical definitions for the three local runtime roles on a DPF install. This is the source of truth that operator-facing UI, docs, and skills point at. Diagnostic surfaces (Platform Development, Admin, runtime-target health) may continue to expose the technical compose-service and container facts.

## Live portal

The production-served Next.js bundle on `http://localhost:3000`. Backed by the `portal` compose service, the live install databases (`postgres`, `neo4j`, `qdrant`), and the install's bundled image. The **only** runtime that satisfies customer-zero verification. Self-upgrade, MCP config writes, promotion, backups, and sandbox orchestration all live here.

- Compose service: `portal`
- `RuntimeTarget.kind`: `root-portal`
- Mutated by: the autonomous promoter pipeline (image rebuild). Never edited in place.

## Build runtime (also called *Live preview* in Build Studio UI)

The Build Studio agent execution and preview surface on `http://localhost:3035`. Backed by the `sandbox` compose service, the `sandbox-postgres` isolated database, and the `Dockerfile.sandbox` image (which bundles the Codex and Claude Code CLIs plus `bubblewrap`). Humans interact with it through the Build Studio canvas (in-iframe preview + footer "Open live preview" button); they do not edit source files in it directly.

- Compose service: `sandbox`
- `RuntimeTarget.kind`: `build-sandbox`
- Mutated by: Build Studio orchestrator only. The "Live preview" name is the user-facing label; the compose-service name `sandbox` remains in diagnostics.

## Contributor preview

A profile-gated Next.js dev hot-reload server on `http://localhost:3001`. Backed by the `dev-portal` compose service (under `profiles: ["dev"]`), with a host-bind-mounted worktree at `/workspace` and isolated dev databases by default. The opt-in `docker-compose.dev-against-live-db.yml` override can point it at the live DBs for realistic verification, at the contributor's own risk.

- Compose service: `dev-portal`
- `RuntimeTarget.kind`: `dev-portal`
- Mutated by: a DPF contributor's IDE editing the worktree on the host.
- Not shipped by default to customer installs. A plain `docker compose up -d` does not start it.

## Contributor verification sandbox

The `local-integration-ci` lane used by `pnpm run pregate`. It is a governed,
leased convergence environment for exact merged-tree tests and production
builds, not a per-worktree runtime and not a customer-facing portal. A typed
slot manifest isolates its scratch checkout, process fence, Compose project,
portal/PostgreSQL ports, database/volume, dependency state, and evidence.
Automatic capacity is one; the second declared identity remains unavailable to
automatic admission until its governed pilot.

- Default slot-0 portal endpoint: `http://localhost:3010`
- Admission authority: `NonProductionEnvironmentLease`
- Resource identity: `scripts/lib/local-ci-slot-manifest.mjs`
- Operations: [Local-CI sandbox slots](local-ci-sandbox-slots.md)

## Diagnostic surfaces (where technical names still appear)

The following surfaces continue to use compose-service, container, and port names because they exist to expose the platform's real state:

- Platform Development → Runtime Targets
- Build Studio → Sandbox Control / Admin Recovery (per the 2026-05-22 sandbox-admin spec)
- `docker compose ps` / `docker ps` operator output
- MCP tool input/output schemas
- Log lines and error messages

## Related

- [DPF Production Runtime](dpf-production-runtime.md) — the rules around how these runtimes are used
- [Portal topology consolidation spec](../superpowers/specs/2026-05-24-portal-topology-consolidation-design.md) — the design rationale, Phase 2 prerequisites, and benchmarks

---
title: Portal topology consolidation - sandbox vs dev-portal vs portal
date: 2026-05-24
status: proposal - revised by chief-architect review
owner: Mark Bodman (CEO)
supersedes: (none - first explicit topology spec)
relates-to:
  - docker-compose.yml (portal, sandbox, dev-portal services)
  - docker-compose.dev-against-live-db.yml (worktree-local dev-portal live-DB override)
  - .claude/skills/dev-portal-start/SKILL.md (hot-reload verification workflow)
  - docs/operations/dpf-production-runtime.md (current operator-facing runtime split)
  - docs/superpowers/specs/2026-03-22-dev-container-platform-development-design.md (original dev profile design)
  - docs/superpowers/plans/2026-05-18-dpf-runtime-coordination-workflow.md (RuntimeTarget contract)
  - docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md (sandbox readiness and recovery)
  - docs/dogfood/2026-05-23-dale-hvac-build-studio.md (operator dogfood pass)
  - memory signal: feedback_no_sandbox_direct_write.md
  - memory signal: feedback_build_studio_for_all_development.md
  - memory signal: project_self_upgrade_kills_in_session_ux.md
---

# Portal topology consolidation

## 1. The question

Mark asked on 2026-05-24:

> "Would it matter if the agents and humans are working on the same dev / sandbox?
> I don't see a distinction necessary and it further complicates the situation on
> what is where and how to merge the different sources. Unless there is a
> compelling argument for it."

The premise is correct: three local URLs that all look like "the portal" create
operator friction. The architecture question is whether that friction comes from
unnecessary topology, bad names, or an unfinished runtime-control model.

The answer after repo review is:

> The distinction between Build Studio's sandbox/runtime and the contributor
> dev portal is still load-bearing today. The naming and visibility are the
> problem. Collapse is possible later, but only after Build Studio can isolate
> agent execution, worktrees, data, and preview routing without relying on the
> current container sandbox boundary.

## 2. Current repo truth checked

Checked in the `interesting-cori-09ccd1` worktree on 2026-05-24.

- **`portal` is the customer-zero runtime on `:3000`.**
  Verified in `docker-compose.yml` and
  `docs/operations/dpf-production-runtime.md`. The `portal` service exposes
  `3000:3000` and is the only final-acceptance runtime. It mounts the Docker
  socket and host install path because it owns self-upgrade, MCP config writes,
  promotion, backups, and sandbox orchestration.
- **`sandbox` is the Build Studio runtime on `:3035`.**
  Verified in `docker-compose.yml`, `Dockerfile.sandbox`, and
  `apps/web/lib/integrate/sandbox/*`. The service uses `Dockerfile.sandbox`,
  mounts `sandbox_workspace`, uses `sandbox-postgres`, exposes `3035:3000`,
  and runs with agent CLI tooling unavailable in the dev image.
- **`dev-portal` is already opt-in.**
  Verified in `docker-compose.yml` and the 2026-03-22 dev-container spec.
  `dev-postgres`, `dev-neo4j`, `dev-qdrant`, `dev-init`, and `dev-portal`
  already have `profiles: ["dev"]`. A plain customer `docker compose up -d`
  does not start them. Phase 1 must therefore rename/reframe the profile, not
  pretend the service is currently default-on.
- **`dev-portal` does not mount the Docker socket in compose.**
  Verified in `docker-compose.yml`. The base `dev-portal` service bind-mounts
  the worktree and `dev_node_modules`, but it does not mount
  `/var/run/docker.sock`. Its risk is source and DB write access, not direct
  sibling-container control from inside the service.
- **Live-DB dogfooding is a deliberate override, not the base dev design.**
  Verified in `docker-compose.dev-against-live-db.yml` and
  `.claude/skills/dev-portal-start/SKILL.md`. The base dev service points at
  isolated dev databases. The worktree override attaches to the root `dpf`
  compose project and swaps DB hosts to live `postgres`/`neo4j`/`qdrant` for
  realistic verification.
- **Runtime names are already typed platform state.**
  Verified in `apps/web/lib/runtime-coordination/types.ts`,
  `runtime-targets.ts`, and the 2026-05-18 runtime-coordination plan.
  `RuntimeTarget.kind` already includes `root-portal`, `dev-portal`, and
  `build-sandbox`. Renaming services must either preserve these kind values or
  migrate them with a typed enum/schema/MCP update in the same slice.
- **Sandbox readiness is an active control-plane effort.**
  Verified in the 2026-05-22 sandbox-admin spec and plan. Build Studio is
  already moving toward `diagnose_sandbox`, `recover_sandbox`,
  runtime-target ownership, compose-label checks, and readiness gates. This
  spec must align with that, not bypass it with a broad compose rename.
- **Sandbox parallelism is not fully provisioned today.**
  Verified in `apps/web/lib/integrate/sandbox/sandbox-pool.ts`,
  `docker-compose.yml`, `docs/user-guide/build-studio/sandbox.md`, and the
  2026-05-21 sandbox-pool plan. The DB/API shape supports a pool, but current
  code defaults `DPF_SANDBOX_POOL_SIZE` to 1 and compose only defines the
  legacy `sandbox` service by default. Older comments and seed defaults still
  mention 3. Phase 2 must treat multi-container or worktree-native parallelism
  as prerequisite work, not current truth.
- **Build Studio concurrency is an open live backlog item.**
  Verified with live MCP item `BI-2E6CC391`. The item is open, has no linked
  epic/spec, and explicitly asks for a research deliverable before
  implementation. This topology spec should reference it as a dependency, not
  as a solved platform capability.

### 2.1 Research & Benchmarking

- **Docker Compose profiles.** Compose services without a profile are enabled
  by default; profiled services are ignored unless the profile is active or the
  profiled service is explicitly targeted. DPF should keep customer runtime
  services unprofiled and contributor-only surfaces profiled. Optional
  `dev` -> `contributor` aliasing is enough for Phase 1; a service rename is
  not required for Compose correctness.
- **GitLab Review Apps.** Review apps create temporary environments per branch
  or merge request and expose a URL for stakeholder validation before
  production. DPF should not collapse future preview work into a single shared
  `:3001` URL. If Design C happens, each Build Studio run or worktree needs
  routable preview identity.
- **Vercel preview deployments.** Production is tied to one production branch
  while other branches become pre-production preview branches with generated
  URLs. DPF should preserve a hard distinction between final acceptance
  (`portal` on `:3000`) and non-prod preview, even if preview routing becomes
  more ergonomic later.
- **GitHub Codespaces.** A codespace is a containerized development
  environment, configurable as code, with limited host access. DPF should keep
  agent execution tooling isolated from the human hot-reload image. If surfaces
  later collapse, move Codex/Claude/bubblewrap into an execution sidecar rather
  than bloating `dev-portal`.

Adopted patterns: explicit profiles for optional surfaces, branch/worktree-scoped
preview identity, and containerized tool isolation. Rejected pattern: a single
shared "dev" URL pretending to be safe for every actor and every data boundary.

## 3. The three roles today

These are roles, not just services:

- **Customer-zero runtime:** `portal` on `:3000`. Production Next.js
  standalone image, backed by live install DBs. Used by end users and
  operators. It is the only final-acceptance runtime.
- **Build Studio runtime:** `sandbox` on `:3035`. Agent-capable Next.js dev
  server in an isolated container/volume, backed by `sandbox-postgres` unless
  an integration is explicitly wired elsewhere. Used by Build Studio agents
  for non-prod build, preview, and ship-gate work.
- **Contributor verification runtime:** `dev-portal` on `:3001`. Next.js dev
  target with host worktree bind mount. Uses isolated dev DBs by default and
  live DBs only with the explicit override. Used by DPF contributors for
  non-prod verification only.

The important distinction is not "human vs agent" by itself. The important
distinction is the source of mutation and the blast radius:

- `portal` is shipped state. It can satisfy final acceptance but must not be a
  scratch surface.
- `sandbox` is the governed Build Studio execution target. It can run agent
  tooling, write build source, run tests, and produce diffs for promotion.
- `dev-portal` is a contributor hot-reload surface. It accelerates visual and
  HTTP verification from a worktree, but it cannot satisfy final acceptance and
  should not be used as the general agent execution substrate.

## 4. What is actually painful

The operator pain is real, but it is more precise than "three containers exist."

- **The names do not explain the roles.** "Sandbox" sounds disposable, even
  though it is the Build Studio runtime used for governed implementation and
  preview. "Dev portal" sounds like the development environment, even when the
  live-DB override makes it a contributor verification surface.
- **The docs expose compose names instead of operator jobs.** Dale needs "Build"
  and "Live preview", not `sandbox`. Contributors need "verify this worktree",
  not `dev-portal`.
- **There are two non-prod preview answers.** Build Studio work appears at the
  sandbox preview. Contributor work appears at `:3001`. The split is
  architecturally justified, but the UI and docs must route people by job.
- **The live-DB override changes the risk profile.** Once `dev-portal` points at
  the live DB, it is no longer a harmless isolated dev stack. That is acceptable
  for contributor verification when explicit, but it should not become the
  default mental model for all non-prod work.
- **Runtime target state already has its own vocabulary.** The platform says
  `build-sandbox`, `dev-portal`, and `root-portal`. Compose, docs, UI labels,
  and MCP tools need a deliberate compatibility plan before any rename.

## 5. Designs evaluated

### Design A - Status quo with better docs

Keep `portal`, `sandbox`, and `dev-portal` exactly as-is and add explanation.

- **Pro:** No migration risk.
- **Con:** Leaves the current "where do I look?" problem in place.
- **Verdict:** Reject. Documentation alone cannot carry a bad IA.

### Design B - Sandbox as the only non-prod surface

Eliminate `dev-portal`. Humans verify by using Build Studio and the sandbox
preview.

- **Pro:** One non-prod preview path. Strong governance: all changes enter
  through Build Studio.
- **Pro:** Aligns with the memory/policy signal that Build Studio should become
  the normal path for platform development.
- **Con:** Too heavy today for tight contributor visual iteration. The current
  Build Studio gates and rebuild cycle are not yet fast enough to replace every
  worktree hot-reload loop.
- **Con:** Does not solve contributor-local UI debugging where a human is
  deliberately editing a branch and needs rapid browser feedback before PR.
- **Verdict:** Directionally desirable later, but not ready.

### Design C - Dev portal as the only non-prod surface

Eliminate the sandbox as a separate surface. Build Studio writes to worktrees
and a dev-portal-like hot-reload runtime previews those worktrees.

- **Pro:** Strong mental model: one non-prod preview answer.
- **Pro:** Worktree source isolation becomes the shared source-control model.
- **Con:** A single `:3001` server can only preview one worktree at a time
  unless we add a router/multiplexer or per-worktree runtime instances. That
  reintroduces parallel runtimes under a different name.
- **Con:** The current `dev` image lacks Codex CLI, Claude Code CLI, bubblewrap,
  and the non-interactive Codex config from `Dockerfile.sandbox`.
- **Con:** The Build Studio sandbox has no Docker socket and uses an isolated
  DB. The dev portal with live-DB override has live DB write access. Merging
  those risk profiles is a security and data-governance decision, not a rename.
- **Con:** Current runtime coordination and sandbox-admin specs assume a
  `build-sandbox` target kind with readiness/ownership checks. Design C must
  replace that model deliberately.
- **Verdict:** Plausible future architecture, but blocked by missing
  prerequisites: worktree-native Build Studio parallelism, preview routing,
  sidecarized agent tooling, and per-worktree data isolation.

### Design D - Keep roles, rename UI/docs, preserve typed contracts

Keep the three roles but change what operators see:

- User-facing `portal` label: **Live portal**.
- User-facing Build Studio label: **Build runtime** / **Live preview**.
- Contributor label: **Contributor preview**.
- Compose service names and `RuntimeTarget.kind` values stay stable in the
  first slice unless a separate compatibility migration is approved.

- **Pro:** Fixes the operator-facing confusion without breaking isolation,
  RuntimeTarget enum values, seed data, MCP schemas, or sandbox-admin work.
- **Pro:** Dale-class installs do not need to see `dev-portal`; it is already
  profile-gated, and docs/UI can stop advertising it to customers.
- **Pro:** Lets Build Studio continue using `build-sandbox` while the sandbox
  recovery control plane lands.
- **Con:** Does not reduce the number of technical surfaces.
- **Verdict:** Recommended immediate slice.

### Design E - Phased: Design D now, Design C as a later architecture decision

Adopt Design D now. Open a later decision record for Design C after the
Build Studio prerequisites exist.

- **Pro:** Fixes today's mental model without introducing container, data, or
  enum churn before the platform can absorb it.
- **Pro:** Keeps the long-term consolidation ambition explicit.
- **Con:** Requires discipline not to let the Phase 1 wording cleanup become
  the final architecture.
- **Verdict:** Recommended.

## 6. Recommendation

Ship **Design E**, with a smaller and safer Phase 1 than the original draft:

1. **Do not rename compose services in the first PR.** Treat service renames as
   a compatibility migration, not a docs cleanup.
2. **Rename operator-facing language first.** Users see "Live portal", "Build
   runtime", "Live preview", and "Contributor preview"; they do not need to see
   `sandbox` or `dev-portal` unless they are in Platform Development or support
   diagnostics.
3. **Change the `dev` profile label only if it buys clarity.** `dev-portal` is
   already profile-gated. If we rename the profile to `contributor`, do it with
   backward-compatible docs/scripts and keep the base service name stable in
   slice 1.
4. **Preserve `RuntimeTarget.kind` values initially.** `root-portal`,
   `build-sandbox`, and `dev-portal` are platform contracts. Any rename must
   update TypeScript enum arrays, MCP schemas, seed/backfill code, tests, and
   existing rows together.
5. **Do not blanket-rename `sandbox`.** Some `sandbox` terms are external API
   domains, vendor environments, security concepts, and Build Studio model
   names (`Sandbox`, `SandboxSlot`, `sandboxId`). Only the operator-facing label
   should change in phase 1.

## 7. Operator-facing IA model

The navigation and language model should route by user job, not infrastructure.

| User asks | Surface they should see | Implementation behind it |
| --- | --- | --- |
| "Use DPF" | **Live portal** | `portal`, `RuntimeTarget.kind=root-portal`, `:3000` |
| "Build or review a feature" | **Build Studio** with **Live preview** | `sandbox`, `RuntimeTarget.kind=build-sandbox`, `:3035` |
| "Verify my worktree edits quickly" | **Contributor preview** | `dev-portal`, `RuntimeTarget.kind=dev-portal`, `:3001`, profile-gated |
| "Diagnose runtime health" | **Platform Development > Runtime Targets** or **Build Studio > Sandbox Control** | RuntimeTarget rows, sandbox readiness, compose-label diagnostics |

IA rules:

- Global navigation uses product domains: Workspace, Backlog, Build Studio,
  AI Workforce, Platform Development. It should not expose compose-service
  names as primary navigation labels.
- Build Studio may say "Live preview" in the user-facing canvas/footer.
  Diagnostic drawers may show `sandbox`, container names, ports, and compose
  labels.
- Platform Development may show technical labels because that page is the
  owner of MCP tokens, runtime targets, compose health, and contributor setup.
- Final acceptance language always points at the Docker-served Live portal on
  `:3000`.

## 8. Phase 1 scope

Phase 1 is a naming, IA, and documentation alignment slice. It should not alter
the security or execution model.

### 8.1 Required changes

1. Update `docs/operations/dpf-production-runtime.md` to describe the three
   roles as Live portal, Build runtime/Live preview, and Contributor preview.
2. Update `docs/user-guide/build-studio/*`, Build Studio UI labels, and dogfood
   follow-ups so customer-facing copy says "Live preview" instead of "sandbox"
   when the user is not diagnosing infrastructure.
3. Update `.claude/skills/dev-portal-start/SKILL.md` wording so it is clearly a
   contributor-only preview workflow. The skill name can stay stable in phase 1
   to avoid breaking invocations.
4. Update `package.json` scripts only where clarity is improved. Docker Compose
   can already start an explicitly targeted profiled service, so the current
   `dev:portal` script is not broken solely because it omits `--profile dev`.
   A clearer `contributor:preview` script may still be worth adding if Phase 1
   aliases the profile.
5. Add a lightweight glossary in Platform Development docs:
   - Live portal = final acceptance.
   - Build runtime = Build Studio agent runtime and preview.
   - Contributor preview = hot-reload worktree verification.
6. Add regression checks for user-facing strings that should not leak
   infrastructure labels into Dale-class flows:
   - Build Studio footer/button label should be "Live preview", not "Open sandbox".
   - Contributor docs may mention `dev-portal`; customer docs should not.
   - Runtime diagnostics may mention compose/container names.

### 8.2 Optional but allowed in Phase 1

Rename the compose profile from `dev` to `contributor` only if it is
backward-compatible:

```yaml
dev-portal:
  profiles: ["dev", "contributor"]
```

Keep both profile names for at least one release. Update docs and skills to use
`--profile contributor`; keep `--profile dev` documented as legacy.

### 8.3 Explicitly out of Phase 1

- Renaming the `sandbox` compose service.
- Renaming Docker volumes.
- Renaming `RuntimeTarget.kind` values.
- Renaming Prisma models, fields, or `sandboxId` references.
- Merging `sandbox` and `dev-portal`.
- Changing DB isolation defaults.
- Adding Docker socket access to `dev-portal` or agent CLIs to the `dev` image.
- Reworking Build Studio parallelism.

## 9. Phase 2 decision record

Phase 2 is not "do the rename later." It is a real architecture decision:
whether the two non-prod execution roles can collapse.

Do not approve collapse until these prerequisites are true:

1. **Worktree-native parallelism:** Build Studio can run multiple active builds
   without assuming one long-lived sandbox service is the unit of isolation.
2. **Preview routing:** A stable operator URL can route to the correct worktree
   or build without serializing all preview work through a single `:3001`
   server.
3. **Agent tooling sidecar:** Codex CLI, Claude Code CLI, bubblewrap, and
   non-interactive agent config can live in an execution sidecar instead of
   bloating the human hot-reload image.
4. **Per-build data isolation:** Agent work can run against a clone/sandbox DB
   with an explicit promotion path. Live-DB contributor preview remains an
   opt-in verification risk, not the agent default.
5. **RuntimeTarget replacement plan:** The platform has a typed migration from
   `build-sandbox`/`dev-portal` to whatever the unified target kind becomes,
   including MCP schemas, seed/backfill code, existing rows, and tests.
6. **Sandbox-admin parity:** `diagnose_sandbox`/`recover_sandbox` functionality
   has an equivalent in the unified runtime control plane.

Only after those are true should Design C be revisited.

## 10. Migration guidance

### Safe Phase 1 migration

No volume migration should be needed if services and volumes keep their current
names. The implementation should be ordinary docs/UI/test work plus optional
profile aliasing.

Verification:

- `pnpm --filter web exec vitest run` for any touched Build Studio/runtime UI
  tests.
- `pnpm --filter web typecheck` for TypeScript changes.
- Docker-served UX verification on `:3000` for customer-visible label changes.
- Contributor-preview smoke on `:3001` only for docs/skill/script changes that
  affect that workflow.
- Runtime-target checks must still show `root-portal` as the only final
  acceptance role.

### Future technical rename migration

If Mark later chooses a technical rename (`sandbox` service to
`build-runtime`, `dev-portal` service to `contributor-preview`, or enum changes),
that must be its own plan with:

- Typed enum/schema/MCP update list.
- Seed/backfill migration for `RuntimeTarget` rows.
- Compose service/volume/container naming compatibility window.
- Install/upgrade release note.
- A volume preservation script only if volume names actually change.
- Sandbox-admin readiness test updates.
- Rollback plan for partially renamed compose projects.

## 11. What gets simpler

- Dale and other non-technical operators see Build Studio and Live preview, not
  a generic "sandbox" concept.
- Contributors get an explicit "Contributor preview" path for worktree
  hot-reload verification.
- The platform can keep final acceptance, non-prod verification, and debug-only
  roles crisp.
- The current sandbox-admin and runtime-coordination specs remain valid.

## 12. What remains complex

- There are still three technical services.
- Build Studio and contributor preview still use different data and source
  paths.
- Live-DB contributor preview remains risky and must stay explicit.
- A later collapse still requires real architecture work, not a naming pass.

## 13. Open decisions

1. **Approve Design E with safe Phase 1?** Recommendation: yes.
2. **Keep compose service names stable in Phase 1?** Recommendation: yes.
3. **Alias profile `dev` to `contributor` now?** Recommendation: optional, but
   only if both profiles work during a compatibility window.
4. **Use "Live preview" as the user-facing Build Studio term?** Recommendation:
   yes, because Dale dogfood already identified "Open sandbox" as confusing.
5. **File Phase 2 as a separate architecture decision?** Recommendation: yes,
   linked to live open item `BI-2E6CC391` (Build Studio concurrent Feature
   Builds) and worktree hygiene (`EP-WORKTREE-HYGIENE`).

## 14. Out of scope

- Production portal redesign.
- Self-upgrade restart/recycle UX.
- ChatGPT OAuth port behavior.
- Build Studio provider-routing deficiencies from the Dale dogfood pass.
- Sandbox readiness/recovery implementation already owned by the 2026-05-22
  sandbox-admin spec, except for terminology alignment.
- Any direct DB/runtime mutation outside governed MCP or the documented
  migration path.

## 15. Definition of done

- This spec is reviewed and accepted or revised by Mark.
- Phase 1 PR changes only user-facing terminology, docs, skills/scripts, tests,
  and optional profile aliasing.
- The PR does not rename compose services, volumes, Prisma models, or
  `RuntimeTarget.kind` values.
- Customer-facing flows no longer expose "sandbox" where the user's job is
  simply to preview a build.
- Technical diagnostics still expose the actual service/container/port facts.
- Final acceptance remains the Docker-served Live portal on `:3000`.
- The implementation plan cites the research benchmarks in §2.1 when deciding
  whether a change is Phase 1 terminology, profile aliasing, or future preview
  routing architecture.

## 16. References

**Repo-local anchors**

- `docker-compose.yml`
- `docker-compose.dev-against-live-db.yml`
- `.claude/skills/dev-portal-start/SKILL.md`
- `docs/operations/dpf-production-runtime.md`
- `docs/superpowers/specs/2026-03-22-dev-container-platform-development-design.md`
- `docs/superpowers/plans/2026-05-18-dpf-runtime-coordination-workflow.md`
- `docs/superpowers/plans/2026-05-21-sandbox-pool-wiring.md`
- `docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`
- `apps/web/lib/integrate/sandbox/sandbox-pool.ts`
- `apps/web/lib/runtime-coordination/types.ts`
- live MCP item `BI-2E6CC391`

**External benchmarks**

- Docker Compose profiles: https://docs.docker.com/reference/compose-file/profiles/
- GitLab Review Apps: https://docs.gitlab.com/ci/review_apps/
- Vercel Git preview deployments: https://vercel.com/docs/git
- GitHub Codespaces: https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces

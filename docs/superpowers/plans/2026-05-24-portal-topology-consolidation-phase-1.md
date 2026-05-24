# Portal Topology Consolidation — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land the Phase 1 slice of the portal-topology consolidation spec — operator-facing terminology, IA, docs, skill reframing, optional profile aliasing, and regression checks — without touching compose service names, volume names, `RuntimeTarget.kind`, Prisma models, `sandboxId` references, DB isolation, the dev image's tool surface, or Build Studio parallelism.

**Architecture:** Three runtime roles remain (Live portal `:3000`, Build runtime `:3035`, Contributor preview `:3001`). Phase 1 changes what *customer-facing* surfaces *say*: the Build Studio footer button reads "Live preview" not "Open sandbox", the operations runtime doc is rewritten in role-first language, the user-guide Build Studio pages stop using "sandbox" as the customer-facing noun, and the dev-portal-start skill is reframed as contributor-only. Technical diagnostics keep showing the real service/container/port facts.

**Tech Stack:** Next.js 15 / React / TypeScript / Vitest / pnpm workspaces / Docker Compose / Markdown docs.

**Spec:** [`docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md`](../specs/2026-05-24-portal-topology-consolidation-design.md) (PR [#1078](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1078)).

---

## Hard constraints (carried from spec §8.3)

These are out of scope for Phase 1; touching any of them turns this into a different plan:

- No rename of compose services (`sandbox`, `dev-portal`, `sandbox-postgres`, `dev-postgres`, `dev-neo4j`, `dev-qdrant`, `dev-init`, `portal-init`).
- No rename of Docker volumes (`sandbox_workspace`, `sandbox_pgdata`, `dev_pgdata`, `dev_neo4jdata`, `dev_qdrant_data`, `dev_node_modules`).
- No change to `RuntimeTarget.kind` enum values (`root-portal`, `build-sandbox`, `dev-portal`).
- No rename of Prisma models (`Sandbox`, `SandboxSlot`), fields (`sandboxId`), or any DB column referencing sandbox.
- No DB-isolation change. Sandbox-postgres stays. Dev-portal's default isolated dev DBs stay; the live-DB override stays opt-in.
- No Docker socket on `dev-portal`. No agent CLIs (`@openai/codex`, `@anthropic-ai/claude-code`) added to the `dev` Dockerfile target.
- No Build Studio parallelism rework. `DPF_SANDBOX_POOL_SIZE` and `sandbox-pool.ts` stay untouched.
- No rename of test IDs (`BUILD_STUDIO_TEST_IDS.openSandbox`) or component file names (`OpenSandboxButton.tsx`) — internal symbols stay stable.

Scope-violation check: before merging the PR, run `git diff origin/main --stat` and verify the diff touches only docs, user-facing strings, tests asserting those strings, optional `package.json` script additions, and (if approved) the `dev-portal` compose `profiles` field.

---

## Sequencing rationale

Tasks are ordered so that:
1. The headline customer-facing string (the Build Studio footer label) changes first — that change carries the highest user-visible value and the smallest risk surface.
2. Docs follow code so the user-guide describes what the UI actually shows.
3. The optional compose-profile alias is last and gated behind a self-contained verification step.
4. Regression check is added before any docs/UI change so the test fails first, then the change makes it pass (TDD).

Commit per task. Each commit is independently revertable.

---

## Task 1 — Add the customer-facing-label regression test (failing)

**Why first:** Establish the assertion that customer-facing Build Studio surfaces do not show "sandbox" as the noun the user reads, before the change. The test fails initially against `formatSandboxLabel`'s current output (`"Open sandbox · driving: …"`).

**Files:**
- Create: `apps/web/lib/build/customer-facing-strings.test.ts`

**Step 1: Write the failing test**

```ts
// apps/web/lib/build/customer-facing-strings.test.ts
//
// Phase-1 regression: customer-facing Build Studio strings must not expose
// the word "sandbox" as the noun the user reads. Spec
// docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md
// §8.1 — "Build Studio footer/button label should be 'Live preview', not
// 'Open sandbox'". Technical diagnostics may still use "sandbox" (compose
// service names, RuntimeTarget kinds, Prisma models); this test only guards
// the user-facing copy in the BuildStudio canvas footer.
import { describe, it, expect } from "vitest";
import { formatSandboxLabel } from "./sandbox-driver";

describe("Build Studio customer-facing labels — phase 1 regression", () => {
  it("footer button label does not contain the word 'sandbox'", () => {
    const idle = formatSandboxLabel(null);
    const driving = formatSandboxLabel("FB-DEADBEEF");
    expect(idle.toLowerCase()).not.toMatch(/sandbox/);
    expect(driving.toLowerCase()).not.toMatch(/sandbox/);
  });

  it("footer button label uses 'Live preview' as the user-facing noun", () => {
    expect(formatSandboxLabel(null)).toMatch(/live preview/i);
    expect(formatSandboxLabel("FB-DEADBEEF")).toMatch(/live preview/i);
  });

  it("driving build code is still visible to the user", () => {
    expect(formatSandboxLabel("FB-DEADBEEF")).toContain("FB-DEADBEEF");
    expect(formatSandboxLabel(null).toLowerCase()).toContain("idle");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run apps/web/lib/build/customer-facing-strings.test.ts
```

Expected: 3 failing assertions, all on the substring check (current label is `"Open sandbox · driving: …"`).

**Step 3: Commit the failing test**

```bash
git add apps/web/lib/build/customer-facing-strings.test.ts
git commit -s -m "test(build-studio): add phase-1 regression for customer-facing labels"
```

The test is committed RED — this is the intentional TDD anchor. Task 2 turns it green.

---

## Task 2 — Flip the Build Studio footer label to "Live preview"

**Files:**
- Modify: `apps/web/lib/build/sandbox-driver.ts` (the `formatSandboxLabel` function, line ~73)
- Modify: `apps/web/components/build/OpenSandboxButton.test.tsx` (any existing snapshot/string assertions on the old label)

**Step 1: Read existing test expectations**

```bash
pnpm --filter web exec vitest run apps/web/components/build/OpenSandboxButton.test.tsx --reporter=verbose 2>&1 | head -50
```

Confirm which assertions reference the old `"Open sandbox · driving"` string.

**Step 2: Update `formatSandboxLabel`**

In `apps/web/lib/build/sandbox-driver.ts`, replace:

```ts
export function formatSandboxLabel(drivingBuildCode: string | null): string {
  return `Open sandbox · driving: ${drivingBuildCode ?? "idle"}`;
}
```

with:

```ts
export function formatSandboxLabel(drivingBuildCode: string | null): string {
  // Customer-facing footer label. Per spec
  // docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md
  // §8.1, the user-facing noun is "Live preview" — the build runtime that the
  // sandbox container serves. Internal symbol name (formatSandboxLabel) stays
  // stable because Phase 1 explicitly does not rename internal sandbox refs.
  return `Open live preview · driving: ${drivingBuildCode ?? "idle"}`;
}
```

Also update the leading comment block in the same file (lines 6-10 of `sandbox-driver.ts`) so the string contract documented there matches the new output. Replace `"Open sandbox · driving: {code}"` with `"Open live preview · driving: {code}"`.

**Step 3: Update `OpenSandboxButton.test.tsx`**

Update any assertion that reads the old label exactly. Use grep to find them:

```bash
pnpm --filter web exec vitest run apps/web/components/build/OpenSandboxButton.test.tsx 2>&1 | grep -i "open sandbox\|label\|sandbox · driving"
```

For each failing assertion, swap `"Open sandbox · driving:"` → `"Open live preview · driving:"`.

**Step 4: Update the leading comment in `OpenSandboxButton.tsx`**

In `apps/web/components/build/OpenSandboxButton.tsx`, replace the line:

```
//   - Label: "Open sandbox · driving: {code | 'idle'}".
```

with:

```
//   - Label: "Open live preview · driving: {code | 'idle'}".
```

The component name `OpenSandboxButton`, the props type, and the test ID stay stable (phase 1 explicitly does not rename internal symbols).

**Step 5: Run the regression test and verify it passes**

```bash
pnpm --filter web exec vitest run apps/web/lib/build/customer-facing-strings.test.ts apps/web/components/build/OpenSandboxButton.test.tsx
```

Expected: both files green.

**Step 6: Run the broader Build Studio test slice**

```bash
pnpm --filter web exec vitest run apps/web/lib/build apps/web/components/build
```

Expected: green. If any other tests assert the old label substring, fix them in this same commit (do not commit half a label change).

**Step 7: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: clean.

**Step 8: Commit**

```bash
git add apps/web/lib/build/sandbox-driver.ts apps/web/components/build/OpenSandboxButton.tsx apps/web/components/build/OpenSandboxButton.test.tsx
git commit -s -m "feat(build-studio): customer-facing footer reads 'Live preview' not 'Open sandbox'"
```

---

## Task 3 — Rewrite `docs/operations/dpf-production-runtime.md` in role-first language

**Files:**
- Modify: `docs/operations/dpf-production-runtime.md` (full rewrite of body; keep the substrate-scope blockquote at the top)

**Step 1: Replace the body (lines 5-22)**

Keep lines 1-3 unchanged. Replace everything from line 5 onward with:

```markdown
This install runs three local runtime roles:

| Role | Surface | Backed by | Used for |
| --- | --- | --- | --- |
| **Live portal** | `http://localhost:3000` | `portal` service, production Next.js bundle, live install DBs | Final acceptance. End users and operators. The only runtime that satisfies customer-zero verification. |
| **Build runtime** (aka *Live preview*) | `http://localhost:3035` | `sandbox` service, agent-capable Next.js dev server, `sandbox-postgres` | Build Studio agent execution and the in-canvas Live preview. Not a final-acceptance surface. |
| **Contributor preview** | `http://localhost:3001` | `dev-portal` service (profile-gated), Next.js dev hot-reload, isolated dev DBs by default | DPF contributors verifying worktree edits before opening a PR. Not shipped by default to customer installs. |

## Rules

- Final acceptance always targets the Docker-served **Live portal** on `http://localhost:3000`.
- Never use ad-hoc `pnpm dev`, `next dev`, or `next start` on port 3000 for customer-zero verification.
- The **Build runtime** is the agent execution surface; humans see it through Build Studio's in-canvas preview (the footer "Open live preview" button) rather than treating it as a developer scratch surface.
- The **Contributor preview** is opt-in via the `dev` compose profile. A plain `docker compose up -d` does not start it, and customer installs do not ship it by default.
- Promote changes through branch → PR → verification → image rebuild flow rather than treating the Live portal as a scratch environment.

## Why this matters

This machine hosts the real Open Digital Product Factory production instance. The runtime split is therefore not just a local developer convenience; it is part of the operating model DPF expects customers to follow as well.

Customer installs (e.g. Dale's HVAC shop) see only the Live portal and the Build runtime. The Contributor preview is a DPF-contributor surface, gated behind the `dev` compose profile and not surfaced in the customer install UX.

## Terminology mapping

These names appear in the operator-facing UI, docs, and skills. The compose-service / container / port facts behind them are unchanged in Phase 1 and remain visible in diagnostics:

| User-facing name | Compose service | `RuntimeTarget.kind` | Port |
| --- | --- | --- | --- |
| Live portal | `portal` | `root-portal` | 3000 |
| Build runtime / Live preview | `sandbox` | `build-sandbox` | 3035 |
| Contributor preview | `dev-portal` | `dev-portal` | 3001 |

See [Runtime glossary](runtime-glossary.md) for the canonical definitions.
```

**Step 2: Verify the link target exists**

The new doc references `runtime-glossary.md` — that's created in Task 4. The link will be broken until Task 4 lands. Acceptable for a multi-commit slice; check the link once Task 4 is in.

**Step 3: Commit**

The new body references `runtime-glossary.md`, which Task 4 creates. Acknowledge the forward link in the commit message so reviewers do not flag a "broken link" mid-slice:

```bash
git add docs/operations/dpf-production-runtime.md
git commit -s -m "docs(operations): rewrite production-runtime doc in role-first language

Forward-references docs/operations/runtime-glossary.md, added in the next
commit (Task 4). Link resolves once both commits are applied."
```

---

## Task 4 — Create `docs/operations/runtime-glossary.md`

**Files:**
- Create: `docs/operations/runtime-glossary.md`

**Step 1: Write the glossary**

```markdown
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
```

**Step 2: Commit**

```bash
git add docs/operations/runtime-glossary.md
git commit -s -m "docs(operations): add runtime glossary (Live portal / Build runtime / Contributor preview)"
```

---

## Task 5 — Update `docs/user-guide/build-studio/index.md` "Sandbox" key concept

**Files:**
- Modify: `docs/user-guide/build-studio/index.md` (Key Concepts section, line 20)

**Step 1: Replace the "Sandbox" bullet**

In `docs/user-guide/build-studio/index.md`, replace line 20:

```markdown
- **Sandbox** — An isolated execution environment where generated code runs safely without affecting the production platform. Each sandbox has its own database, file system, and network.
```

with:

```markdown
- **Build runtime** — The isolated execution environment where the AI Coworker generates and tests code. Has its own database, file system, and network — completely separated from the live platform. The Build Studio canvas surfaces it as **Live preview**; the technical name *sandbox* still appears in diagnostics. See [Build Runtime](sandbox.md) for the full operating model.
```

**Step 2: Verify other strings in this file**

Re-read the file end-to-end and check for remaining customer-facing "sandbox" references that should become "Build runtime" or "Live preview":

```bash
grep -n -i sandbox docs/user-guide/build-studio/index.md
```

Only **lines 20 and 24** carry the customer-facing "sandbox" noun in `index.md`. Line 22 already reads `**Live Preview** — During the Build phase, …` and stays unchanged. Edits:
- Line 20: the **Sandbox** bullet — replaced by the **Build runtime** bullet per Step 1.
- Line 24 (Promotion): change `"moving a completed feature from the sandbox into production"` → `"moving a completed feature from the Build runtime into production"`.

If grep surfaces other matches (e.g. anchor links to `sandbox.md`), leave them — Task 6 keeps the file path `sandbox.md` stable for URL stability.

**Step 3: Commit**

```bash
git add docs/user-guide/build-studio/index.md
git commit -s -m "docs(build-studio): use 'Build runtime' / 'Live preview' in user-guide index"
```

---

## Task 6 — Reframe `docs/user-guide/build-studio/sandbox.md` as the Build runtime page

The file name `sandbox.md` stays stable (URL stability — existing inbound links should not break). The page title, framing, and customer-facing copy become "Build runtime"; the technical detail (compose service name, container IDs, port numbers) stays so diagnostics still find what they need.

**Files:**
- Modify: `docs/user-guide/build-studio/sandbox.md`

**Step 1: Update the frontmatter title**

```yaml
---
title: "Build Runtime (Sandbox)"
area: build-studio
order: 3
lastUpdated: 2026-05-24
updatedBy: Claude (Software Engineer)
---
```

**Step 2: Update the Overview section (lines 9-15)**

Replace with:

```markdown
## Overview

The **Build runtime** — surfaced as **Live preview** in the Build Studio canvas — is the isolated execution environment where your AI Coworker builds, tests, and refines features before they reach the Live portal. Each Build runtime instance has its own database, file system, and runtime, completely separated from the live platform. Nothing the AI Coworker does in the Build runtime can affect your production system.

The Build runtime is not the long-lived source of truth for your code. It starts from the install's shared workspace, runs validation work safely, and can be recreated whenever needed. The technical name behind it is *sandbox* — that name continues to appear in diagnostic surfaces (Platform Development → Runtime Targets, Admin Recovery, log lines, and MCP schemas).

This isolation is what makes it safe for the AI to experiment freely: modifying code, running database migrations, restarting services, and iterating on your feedback without risk.
```

**Step 3: Update the "Sandbox Isolation" section header (line 31)**

Rename to `## Build Runtime Isolation`. Keep the table contents as-is — they reference the actual container names (`dpf-postgres-1`, `dpf-sandbox-postgres-1`) which is diagnostic and stays accurate.

**Step 4: Update the "Sandbox Pool" section header (line 85)**

Rename to `## Build Runtime Pool`. Body keeps the technical pool description (the `DPF_SANDBOX_POOL_SIZE` env var name does not change in Phase 1).

**Step 5: Update the "From Sandbox to Production" section header (line 99)**

Rename to `## From Build Runtime to Live Portal`. Update body text to use "Build runtime" instead of "sandbox" in the narrative; keep `deploy_feature` tool reference unchanged.

**Step 6: Update the "AI Coworker Tools" intro (line 46)**

Change `"working inside the sandbox"` → `"working inside the Build runtime"`. The tool names (`write_sandbox_file`, `read_sandbox_file`, etc.) stay unchanged — those are MCP-bound identifiers.

**Step 7: Update Troubleshooting headings (line 138)**

Change `"Sandbox not ready"` → `"Build runtime not ready"`. Keep the technical body explaining the `/workspace/` path and sandbox-postgres details.

**Step 8: Update remaining narrative references**

Run:

```bash
grep -n -E "\bsandbox\b" docs/user-guide/build-studio/sandbox.md | grep -v "DPF_SANDBOX_POOL_SIZE\|sandbox-postgres\|dpf-sandbox\|write_sandbox\|read_sandbox\|edit_sandbox\|search_sandbox\|list_sandbox\|run_sandbox\|iterate_sandbox\|sandbox\.md"
```

For each remaining hit that is *narrative copy a user reads* (not a tool name, env var, container name, or filename), replace `sandbox` with `Build runtime` in that sentence. Leave anything that names a technical artifact alone.

**Step 9: Spot-check that relative doc links still resolve**

Markdown isn't type-checked, but the inbound links to `sandbox.md` (from `index.md` and elsewhere) need to keep working since Task 6 preserves the file path. Spot-check:

```bash
grep -n "sandbox.md\|sandbox)" docs/user-guide/build-studio/sandbox.md docs/user-guide/build-studio/index.md
```

Confirm all relative links still resolve to existing files.

**Step 10: Commit**

```bash
git add docs/user-guide/build-studio/sandbox.md
git commit -s -m "docs(build-studio): reframe sandbox page as 'Build Runtime' (file path unchanged)"
```

---

## Task 7 — Reframe `.claude/skills/dev-portal-start/SKILL.md` as contributor-only

**Files:**
- Modify: `.claude/skills/dev-portal-start/SKILL.md` (skill folder name stays — phase 1 does not rename the skill)

**Step 1: Update the frontmatter description**

Replace the description in the frontmatter with:

```yaml
---
name: dev-portal-start
description: Use when a DPF contributor needs to verify worktree edits on the **Contributor preview** runtime (port 3001) without rebuilding the Live portal image. Triggers — making any edit under apps/web/ that needs visual or HTTP-level confirmation; iterating on /build, /platform, /admin, or any other server-rendered route; debugging a UX change against real workspace data; reproducing a customer-visible bug in a worktree before opening a PR. This is a CONTRIBUTOR-ONLY workflow; customer installs do not ship the Contributor preview by default. Don't use for unit-test-only changes (no preview needed) or for changes that need the production-bundled Live portal specifically (rebuild that image instead).
---
```

The skill folder name (`dev-portal-start`) stays so existing invocations do not break.

**Step 2: Update the Overview section**

Replace the first body section (after the `# dev-portal-start` heading) with:

```markdown
## Overview

Brings up the **Contributor preview** runtime — the `dev-portal` Next.js hot-reload service on `http://localhost:3001` — against the live DPF databases, leaving the Live portal on `:3000` untouched as the stable reference. Every source edit under `apps/web/` is visible within a few seconds (or one container restart for file-watcher-stubborn cases).

This eliminates the ~2-minute Live-portal-rebuild loop that otherwise gates every edit-verify cycle.

The Contributor preview is a **DPF-contributor-only** surface, gated behind the `dev` compose profile. Customer installs (e.g. Dale's HVAC shop) do not ship it by default and do not see a `:3001` URL. If you are not a DPF contributor editing the platform source, you do not need this skill.
```

**Step 3: Update the "When to Use" / "Symptoms" section**

Replace the bullet list of symptoms with language that says "the Live portal" instead of "the production portal":

```markdown
**Symptoms that trigger this skill (contributor workflow):**

- "I changed `apps/web/app/(shell)/build/page.tsx` and want to see it."
- "I need to verify the gate fires on a real install before merging."
- "The Live portal at :3000 shows old code — how do I see my edits?"
- "I edited `loadBuildStudioCapability` and tests pass; need to see the live UX."
- "I'm reproducing a customer-reported bug in a worktree."

**Do not use when:**

- The change is unit-test-only (run `pnpm exec vitest` and you're done).
- The change is to the Live-portal-bundle build itself (Docker image content, entrypoint, etc.) — rebuild `portal` instead.
- The change is to non-portal services (sandbox, adp, browser-use) — those have their own rebuild cycles.
- You are not a DPF contributor. End users and customer-install operators interact with Build Studio's Live preview through the canvas, not through `:3001`.
```

**Step 4: Touch up the rest of the body**

Run:

```bash
grep -n -E "production portal|dev-portal\.|prod portal" .claude/skills/dev-portal-start/SKILL.md
```

For each occurrence in narrative copy, replace `production portal` → `Live portal` and qualify `dev-portal` with `Contributor preview` on first use per section. Leave the docker-command examples unchanged (the compose service name `dev-portal` remains, since the service is not being renamed in Phase 1).

**Step 5: Commit**

```bash
git add .claude/skills/dev-portal-start/SKILL.md
git commit -s -m "docs(skill): reframe dev-portal-start as Contributor preview (contributor-only)"
```

---

## Task 8 — Add a `contributor:preview` package.json script

**Files:**
- Modify: `package.json` (scripts block, line 6-25)

**Step 1: Add the script**

Insert a new line after the existing `dev:portal` entry (line 9) so the scripts block reads:

```json
  "scripts": {
    "dev": "pnpm --filter web dev",
    "dev:web": "pnpm --filter web dev",
    "dev:portal": "docker compose up -d dev-portal",
    "contributor:preview": "docker compose --profile dev up -d dev-portal",
    "dev:prod-runtime": "docker compose up -d portal",
    "dev:sandbox": "docker compose up -d sandbox",
```

`dev:portal` stays for backward compatibility; `contributor:preview` is the canonical Phase-1 name and includes the `--profile dev` flag explicitly (required for the profile-gated service per `dev-portal-start` SKILL.md mistake #2).

**Step 2: Verify the JSON is well-formed**

```bash
node -e "require('./package.json')"
```

Expected: no output (silent success).

**Step 3: Commit**

```bash
git add package.json
git commit -s -m "chore(scripts): add contributor:preview alias for dev-portal bring-up"
```

---

## Task 9 (OPTIONAL) — Compose profile alias `dev` → `contributor`

**Decision gate:** Only execute this task if Mark approves it in PR review. The Phase-1 spec marks profile aliasing as "Optional but allowed" (§8.2). It is backward-compatible (both profile names continue to work). Skip this task by default; do not skip the verification step at the end of the plan because of it.

**Files:**
- Modify: `docker-compose.yml` (the five `dev`-profile services)

**Step 1: Add `contributor` to each profiled service**

For each of `dev-postgres`, `dev-neo4j`, `dev-qdrant`, `dev-init`, and `dev-portal` in `docker-compose.yml`, change:

```yaml
    profiles: ["dev"]
```

to:

```yaml
    profiles: ["dev", "contributor"]
```

**Step 2: Verify with `docker compose config`**

```bash
docker compose --profile contributor config --services | sort
```

Expected: includes `dev-portal`, `dev-postgres`, `dev-neo4j`, `dev-qdrant`, `dev-init` plus the always-on services.

```bash
docker compose --profile dev config --services | sort
```

Expected: identical to above (backward compatibility preserved).

**Step 3: Update the Contributor preview skill body**

In `.claude/skills/dev-portal-start/SKILL.md`, add a note under "First bring-up" that either profile flag works:

```markdown
Note: both `--profile dev` (legacy) and `--profile contributor` (canonical Phase 1 name) bring up the same service set. Use whichever the surrounding tooling already references.
```

**Step 4: Commit**

```bash
git add docker-compose.yml .claude/skills/dev-portal-start/SKILL.md
git commit -s -m "chore(compose): alias dev profile to also accept 'contributor' (backward-compatible)"
```

---

## Task 10 — Final verification slice

**Step 1: Full vitest run on the touched scope**

```bash
pnpm --filter web exec vitest run apps/web/lib/build apps/web/components/build
```

Expected: all green.

**Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```

Expected: clean.

**Step 3: Scope-violation sanity check**

```bash
git diff origin/main --stat
```

Confirm the diff touches only:

- `apps/web/lib/build/sandbox-driver.ts` (label string + comments)
- `apps/web/lib/build/customer-facing-strings.test.ts` (new regression test)
- `apps/web/components/build/OpenSandboxButton.tsx` (comment update)
- `apps/web/components/build/OpenSandboxButton.test.tsx` (assertion updates)
- `docs/operations/dpf-production-runtime.md` (rewrite)
- `docs/operations/runtime-glossary.md` (new)
- `docs/user-guide/build-studio/index.md` (key concept rewording)
- `docs/user-guide/build-studio/sandbox.md` (page reframing, file path unchanged)
- `.claude/skills/dev-portal-start/SKILL.md` (contributor framing)
- `package.json` (`contributor:preview` script)
- (Optional Task 9) `docker-compose.yml` (profile alias only)

If the diff touches anything outside this set, stop and audit — phase 1 has been violated.

**Step 4: Docker-served Live portal UX verification**

Bring up the Live portal and walk the Build Studio canvas to confirm the footer label reads "Open live preview" not "Open sandbox":

```bash
docker compose up -d portal
until curl -sf http://localhost:3000/api/health >/dev/null 2>&1; do sleep 3; done
```

Drive the UI via Claude-in-Chrome (per `feedback_prefer_portal_ux_for_shared_actions`):
1. Navigate to `http://localhost:3000/build`.
2. Open a feature build (or land on the dashboard).
3. Read the footer button label. Expected: "Open live preview · driving: <code or idle>".
4. Hover/click does not break (component is still an `<a>` to the same sandbox URL).

Record the verification in the PR description with a screenshot (or browser-use evidence).

**Step 5: Contributor preview smoke (only if Task 9 ran or SKILL.md narrative changed)**

```bash
docker compose --profile dev up -d dev-portal
until curl -sf http://localhost:3001/api/health >/dev/null 2>&1; do sleep 3; done
```

Land on `http://localhost:3001/build` and confirm the page renders. Tear down:

```bash
docker compose --profile dev rm -sf dev-portal
```

**Step 6: RuntimeTarget invariant sanity check**

```bash
grep -rn "RuntimeTarget.kind\|'root-portal'\|'build-sandbox'\|'dev-portal'" apps/web/lib/runtime-coordination | head -20
```

Expected: all three enum values still present in `apps/web/lib/runtime-coordination/types.ts`. Phase 1 did not touch them.

**Step 7: Sweep for overlap with concurrent sessions**

```bash
git fetch origin main --quiet
git log origin/main --oneline -10 | head
gh pr list --state open --limit 30 --json number,title,headRefName --jq '.[] | "\(.number)  \(.headRefName)  \(.title)"'
```

If any new commit or open PR touches the same files, rebase + recheck before pushing.

---

## PR submission

**Step 1: Push branch**

```bash
git push -u origin <current-branch>
```

**Step 2: Open PR**

```bash
gh pr create --title "feat(topology): phase 1 — Live portal / Build runtime / Contributor preview naming + IA" --body "$(cat <<'EOF'
## Summary

Phase 1 of the portal topology consolidation spec ([#1078](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1078)). Operator-facing terminology and IA only — no compose service rename, no enum change, no DB-isolation change, no Build Studio parallelism rework.

- Build Studio footer label: `Open sandbox` → `Open live preview`. Internal symbols (`OpenSandboxButton`, `formatSandboxLabel`, test IDs) unchanged.
- `docs/operations/dpf-production-runtime.md` rewritten in role-first language (Live portal / Build runtime / Contributor preview).
- New `docs/operations/runtime-glossary.md` carries canonical definitions.
- `docs/user-guide/build-studio/index.md` and `sandbox.md` reframed; file paths preserved.
- `.claude/skills/dev-portal-start/SKILL.md` reframed as contributor-only.
- `package.json` adds `contributor:preview` alias for the dev-portal bring-up.
- (Optional, gated on PR review) `docker-compose.yml` aliases `dev` profile to also accept `contributor`.

## Out of scope (per spec §8.3)

No compose service / volume / RuntimeTarget.kind / Prisma model rename. No DB-isolation change. No Docker socket on dev-portal.

## Test plan

- [x] `pnpm --filter web exec vitest run apps/web/lib/build apps/web/components/build` — green.
- [x] `pnpm --filter web typecheck` — clean.
- [x] `git diff origin/main --stat` — only files listed in spec §8.1 + plan §10 step 3.
- [x] Live portal `http://localhost:3000/build` — footer reads "Open live preview".
- [x] Contributor preview `http://localhost:3001` — comes up cleanly (only if Task 9 ran).
- [x] `RuntimeTarget.kind` values (`root-portal` / `build-sandbox` / `dev-portal`) still in `types.ts`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 follow-ups (NOT in this plan)

Filed as a separate decision per spec §9. Linked to live `BI-2E6CC391` (Build Studio concurrent Feature Builds) and worktree-hygiene epic. Do not start any of these in this PR:

- Worktree-native Build Studio parallelism.
- Preview routing per worktree / per build.
- Codex/Claude/bubblewrap sidecar extraction from `Dockerfile.sandbox`.
- Per-build data-isolation contract.
- `RuntimeTarget.kind` enum migration (when/if surfaces collapse).
- Sandbox-admin parity for the unified runtime control plane.

---

## Done-criteria checklist (from spec §15)

- [ ] Phase 1 PR changes only user-facing terminology, docs, skills/scripts, tests, and optional profile aliasing.
- [ ] The PR does not rename compose services, volumes, Prisma models, or `RuntimeTarget.kind` values.
- [ ] Customer-facing flows no longer expose "sandbox" where the user's job is simply to preview a build.
- [ ] Technical diagnostics still expose the actual service/container/port facts.
- [ ] Final acceptance remains the Docker-served Live portal on `:3000`.
- [ ] Spec benchmarks in §2.1 are cited where any decision needs them (e.g., the `contributor:preview` script choice cites the Compose profiles benchmark).

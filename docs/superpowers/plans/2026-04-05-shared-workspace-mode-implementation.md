# Shared Workspace Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align installer, portal governance, Build Studio source handling, VS Code utilities, and user docs around one shared workspace per install.

**Architecture:** The implementation keeps one shared authoring workspace as the code truth, treats validation sandboxes as disposable execution environments, and gates production promotion / upstream contribution through the portal once platform development policy is configured. Customizable installs bind the portal workspace to the checked-out repo so VS Code and Build Studio operate on the same files.

**Tech Stack:** PowerShell installer, Docker Compose, Next.js, server actions, Prisma, Vitest, Markdown docs

---

## File Structure

### Files to modify

- `install-dpf.ps1`
  Purpose: adjust installer messaging and customizable-mode workspace behavior.
- `docker-entrypoint.sh`
  Purpose: avoid bootstrapping over an existing user-managed workspace and support shared workspace semantics.
- `apps/web/lib/integrate/sandbox/sandbox-source-strategy.ts`
  Purpose: copy Build Studio source from the active portal workspace instead of only image-bundled source.
- `apps/web/lib/actions/platform-dev-config.ts`
  Purpose: expose policy-pending awareness and shared helper logic for platform development governance.
- `apps/web/components/admin/PlatformDevelopmentForm.tsx`
  Purpose: present pending/private/contributing onboarding clearly without conflating install mode and contribution mode.
- `apps/web/app/(shell)/admin/platform-development/page.tsx`
  Purpose: pass policy state into the platform development UI.
- `apps/web/components/setup/SetupOverlay.tsx`
  Purpose: explain deferred contribution setup and shared workspace concepts during portal onboarding.
- `apps/web/lib/mcp-tools.ts`
  Purpose: block promotion/contribution actions when policy is still pending and improve operator-facing messages.
- `.vscode/tasks.json`
  Purpose: rename or clarify tasks so they reflect shared workspace vs production/runtime roles.
- `.vscode/launch.json`
  Purpose: align launch labels with shared workspace semantics.
- `README.md`
  Purpose: update install mode, shared workspace, Build Studio, and VS Code guidance.
- `docs/user-guide/build-studio/index.md`
  Purpose: explain Build Studio as one interface over the shared workspace.
- `docs/user-guide/build-studio/sandbox.md`
  Purpose: reposition sandbox/validation behavior away from “separate authoring codebase”.
- `docs/user-guide/getting-started/index.md`
  Purpose: link install modes and shared workspace concepts for end users.

### Files to create

- `docs/user-guide/development-workspace.md`
  Purpose: canonical doc-site guide for Mode 1 vs Mode 2, policy states, shared workspace, and governed promotion.
- `apps/web/lib/integrate/sandbox/sandbox-source-strategy.test.ts`
  Purpose: extend or add focused tests for source path resolution behavior if current file lacks coverage for the new strategy rules.

## Chunk 1: Shared Workspace Plumbing

### Task 1: Inspect current installer and workspace bootstrap behavior

**Files:**
- Modify: none

- [ ] **Step 1: Re-read the relevant implementation files**

Run:

```powershell
Get-Content 'd:\DPF\install-dpf.ps1' -TotalCount 980
Get-Content 'd:\DPF\docker-entrypoint.sh' -TotalCount 220
Get-Content 'd:\DPF\apps\web\lib\integrate\sandbox\sandbox-source-strategy.ts' -TotalCount 220
```

Expected: confirm how customizable installs, `/workspace`, and sandbox source copy currently work.

- [ ] **Step 2: Confirm the current mismatch in code**

Run:

```powershell
rg -n "dpf-source-code|/workspace|apps/web-src|packages-src|git init -b dpf-upstream|my-changes" d:\DPF\install-dpf.ps1 d:\DPF\docker-entrypoint.sh d:\DPF\apps\web\lib\integrate\sandbox\sandbox-source-strategy.ts d:\DPF\docker-compose.yml
```

Expected: show that customizer edits live in the checkout while Build Studio source still comes from the portal image or workspace bootstrap path.

### Task 2: Make customizable installs use the checked-out repo as the portal workspace

**Files:**
- Modify: `install-dpf.ps1`

- [ ] **Step 1: Write the failing or missing behavior down in comments/checklist before editing**

Expected behavior:
- customizable installs should expose the checked-out repo as `/workspace` to the portal services
- installer messaging should explain the shared workspace model

- [ ] **Step 2: Update the customizer override generation**

Implementation:
- add portal/portal-init workspace bind mounts into the generated override for customizer mode
- preserve existing DB port exposure behavior
- keep consumer mode unchanged except for messaging and shared-workspace mount where needed

- [ ] **Step 3: Update install-time explanatory copy**

Implementation:
- introduce the deferred contribution choice
- mention Build Studio + VS Code shared workspace in customizable mode
- mention frontier-model recommendation as informational guidance, not a blocker

- [ ] **Step 4: Verify the script still parses**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('d:\DPF\install-dpf.ps1',[ref]$null,[ref]$null)"
```

Expected: no parse errors.

### Task 3: Prevent portal bootstrap from overwriting a user-managed workspace

**Files:**
- Modify: `docker-entrypoint.sh`

- [ ] **Step 1: Add a guard for pre-existing user-managed workspaces**

Implementation:
- detect a workspace that already looks like a real repo / checked-out source tree
- skip bootstrap copy and git re-init in that case
- preserve update detection behavior where reasonable

- [ ] **Step 2: Preserve first-run bootstrap for consumer/shared-volume installs**

Implementation:
- keep current copy/install/git-init behavior when `/workspace` is an empty or fresh volume

- [ ] **Step 3: Sanity-check the shell script**

Run:

```powershell
docker run --rm -v "d:\DPF\docker-entrypoint.sh:/tmp/docker-entrypoint.sh:ro" alpine:3.20 sh -n /tmp/docker-entrypoint.sh
```

Expected: no shell syntax errors.

### Task 4: Make Build Studio copy source from the active portal workspace

**Files:**
- Modify: `apps/web/lib/integrate/sandbox/sandbox-source-strategy.ts`
- Test: `apps/web/lib/integrate/sandbox/sandbox-source-strategy.test.ts`

- [ ] **Step 1: Write a focused failing test for source path resolution**

Test idea:
- prefer `/workspace` or `PROJECT_ROOT` source when present
- fall back to `/app/apps/web-src` and `/app/packages-src` when needed

- [ ] **Step 2: Implement workspace-first source copying**

Implementation:
- resolve active source root from the portal container
- copy from active workspace when available
- retain fallback behavior for image-bundled source paths

- [ ] **Step 3: Run focused tests**

Run:

```powershell
pnpm exec vitest run apps/web/lib/integrate/sandbox/sandbox-source-strategy.test.ts
```

Expected: PASS

## Chunk 2: Portal Policy Gating And UI Alignment

### Task 5: Introduce policy-pending awareness in platform development config helpers

**Files:**
- Modify: `apps/web/lib/actions/platform-dev-config.ts`

- [ ] **Step 1: Add a helper that maps current DB state to a policy state**

Implementation:
- if no `PlatformDevConfig` exists, return `policy_pending`
- if config exists with `fork_only`, map to `private`
- if config exists with `selective` or `contribute_all`, map to `contributing`

- [ ] **Step 2: Keep existing contribution mode persistence intact**

Implementation:
- avoid schema churn unless strictly necessary
- layer the new shared-workspace semantics on top of existing contribution fields

- [ ] **Step 3: Add or update focused tests if a nearby action test file exists**

Run:

```powershell
rg -n "platform-dev-config" d:\DPF\apps\web --glob "*.test.*"
```

Expected: identify whether a focused test target exists; if it does, add coverage and run it.

### Task 6: Update admin and onboarding UI text to reflect shared workspace and deferred setup

**Files:**
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx`
- Modify: `apps/web/app/(shell)/admin/platform-development/page.tsx`
- Modify: `apps/web/components/setup/SetupOverlay.tsx`

- [ ] **Step 1: Update the platform development page props and state handling**

Implementation:
- surface `policy_pending`
- clarify that contribution policy is configured in the portal and governs promotion/contribution, not install mode

- [ ] **Step 2: Update form copy and pending-state UX**

Implementation:
- explain shared workspace for both modes
- explain that Build Studio remains the governed release path
- keep the contribution setup flow understandable for non-technical users

- [ ] **Step 3: Update setup overlay welcome copy**

Implementation:
- explain that platform development policy is configured during onboarding
- avoid implying that Build Studio and VS Code are separate codebases

- [ ] **Step 4: Run focused UI-adjacent tests if they exist**

Run:

```powershell
rg -n "PlatformDevelopmentForm|SetupOverlay" d:\DPF\apps\web --glob "*.test.*"
```

Expected: identify relevant test files; add minimal coverage if practical and run those tests.

### Task 7: Block governed ship/contribution actions while policy is pending

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Find the production promotion and contribution entry points**

Run:

```powershell
rg -n "deploy_feature|contribute_to_hive|assess_contribution|contributionMode" d:\DPF\apps\web\lib\mcp-tools.ts
```

Expected: locate the exact handlers.

- [ ] **Step 2: Add policy-pending guardrails**

Implementation:
- if platform development policy is pending, return a clear message that editing and validation are allowed but production promotion / contribution require portal setup
- preserve existing behavior for configured private/contributing installs

- [ ] **Step 3: Run the most focused tests covering tool handlers**

Run:

```powershell
rg -n "mcp-tools" d:\DPF\apps\web --glob "*.test.*"
```

Expected: identify targeted tests; run only affected ones if available.

## Chunk 3: VS Code, README, And User Docs

### Task 8: Align VS Code tasks and launch labels

**Files:**
- Modify: `.vscode/tasks.json`
- Modify: `.vscode/launch.json`

- [ ] **Step 1: Rename or clarify tasks**

Implementation:
- distinguish shared workspace dev actions from production actions
- make release-oriented tasks clearly exceptional / governed
- avoid implying the sandbox is the default IDE target

- [ ] **Step 2: Update launch labels**

Implementation:
- label the dev server in terms of shared workspace development

### Task 9: Update README install and dev guidance

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update install mode descriptions**

Implementation:
- both modes support later private or contributing configuration in the portal
- mode difference is whether VS Code is part of the supported workflow

- [ ] **Step 2: Update dev container and Build Studio wording**

Implementation:
- explain shared workspace semantics
- remove or revise wording that says Build Studio is read-only in the dev environment if no longer accurate

### Task 10: Add the canonical doc-site guide and cross-links

**Files:**
- Create: `docs/user-guide/development-workspace.md`
- Modify: `docs/user-guide/build-studio/index.md`
- Modify: `docs/user-guide/build-studio/sandbox.md`
- Modify: `docs/user-guide/getting-started/index.md`

- [ ] **Step 1: Write the new canonical development workspace guide**

Content:
- shared workspace model
- Mode 1 vs Mode 2
- `policy_pending`, `private`, `contributing`
- production / development / validation boundaries
- Build Studio vs VS Code responsibilities
- Mermaid diagram from the approved spec

- [ ] **Step 2: Update Build Studio docs to point to the shared-workspace guide**

Implementation:
- explain that validation sandbox is disposable execution infrastructure, not a separate authoring truth

- [ ] **Step 3: Update Getting Started to mention the shared development model**

Implementation:
- add a short, user-facing explanation and link to the deeper guide

## Chunk 4: Verification

### Task 11: Run focused tests for changed areas

**Files:**
- Test: changed test files only

- [ ] **Step 1: Run source-strategy and any affected unit tests**

Run:

```powershell
pnpm exec vitest run apps/web/lib/integrate/sandbox/sandbox-source-strategy.test.ts
```

Expected: PASS

- [ ] **Step 2: Run any additional affected test files discovered during implementation**

Run:

```powershell
pnpm exec vitest run <affected-test-files>
```

Expected: PASS

### Task 12: Run required production build

**Files:**
- Modify: none

- [ ] **Step 1: Run the required production build**

Run:

```powershell
cd d:\DPF\apps\web
npx next build
```

Expected: successful production build with zero errors

- [ ] **Step 2: If Prisma schema or migrations changed, verify migrate deploy**

Run:

```powershell
cd d:\DPF
pnpm --filter @dpf/db exec prisma migrate deploy
```

Expected: migrations apply cleanly without drift

- [ ] **Step 3: Review final diff**

Run:

```powershell
cd d:\DPF
git status --short
git diff --stat
```

Expected: only intended files changed; unrelated install artifacts untouched.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-05-shared-workspace-mode-implementation.md`. Proceed directly with execution in this session.

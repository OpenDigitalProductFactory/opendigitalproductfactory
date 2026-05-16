# Portal Work Capsule Control Harness Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development if the harness offers subagents; otherwise use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship governed-creation planning so the portal generates deterministic branch + worktree allocations for new Work Capsules, displays the exact commands the operator runs on the host, blocks the root clone from becoming an active workspace, and records initial scope — without the portal itself mutating the host filesystem.

**Architecture:** Phase 2 is **display-and-record**, not active host-side creation. The portal generates `<prefix>/<capsule-slug>` (deterministic, collision-checked), proposes the canonical worktree path per AGENTS.md §4, persists those on the capsule as the intended workspace, and renders ready-to-paste git + seed-MCP commands. Phase 1's existing `git-scanner` + `adopt_worktree` flow attaches the capsule the next time the scanner sees the worktree. PR creation remains disabled (Phase 5 contract per spec §6.5). Active in-container worktree creation is deferred to a later sandbox-runner slice because production installs mount `dpf-source-code:/workspace` as a named volume — anything the in-container portal creates there never reaches the host.

**Deliberate spec narrowing (must be explicit so reviewers can sign off):** Spec §15 Phase 2 reads "create worktree from `origin/main`" and "seed MCP config" — language that implies active portal execution. This plan narrows both to **operator-paste** (the portal displays the exact commands; the operator runs them on the host). The narrowing is intentional and substrate-driven (named-volume trap, see Architecture above). The same PR that ships Phase 2 patches spec §15 to reflect the narrowed scope (see Task 7 Step 0).

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, Vitest, DPF MCP tool surface, lucide-react, PowerShell/Bash for host-side worktree commands.

---

## Chunk 1: Grounding And Scope

### Live State Used For This Plan

Re-queried through the DPF MCP surface on 2026-05-16 before writing this plan:

- `list_epics(status=open, hasOpenItems=true)` returned 8 open epics. None is a Work Capsule epic; Phase 2 will create one new backlog item under the existing `EP-INT-2E7C1A` (Integration Harness) umbrella if Mark prefers grouping, or stand alone.
- `list_backlog_items(status=in-progress)` returned 7 in-progress items. None overlaps Phase 2 (`BI-PIR-*` Server Components regressions, Build Studio graph/cycle, licensing investigation, reference-data locality).
- `search_specs_and_plans(query="work capsule phase 2 governed creation worktree branch allocation")` returned **0** matches — no prior plan, no overlap.
- `git branch -a` and `gh pr list` show no in-flight branches or PRs for Phase 2.

Plan consequence: Phase 2 is greenfield on top of the Phase 1 surface that landed via PR #602. No conflicts with active work.

### Scope

In scope for Phase 2:

- Deterministic branch-name allocation (`<prefix>/<capsule-slug>`) per spec §21 decision 4.
- Canonical worktree-path generation per AGENTS.md §4 (Windows `D:\DPF-<topic>`, macOS/Linux `~/dpf-worktrees/<topic>`).
- Branch + worktree-path collision detection against existing capsules and against `git branch --list`.
- Root-clone detection helper + invariant: capsule creation MUST refuse to propose the root clone as the worktree path.
- New MCP tool `plan_capsule_worktree`: idempotent, write tool, requires `manage_backlog` + `work_capsule_write`.
- Persist `headBranch`, `worktreePath`, `branchTaxonomy` on the capsule via the new tool; record a `workspace-planned` activity (new activity-kind enum value).
- "Create governed work" form on `/build/work` that calls `create_work_capsule` + `plan_capsule_worktree` and renders the launch panel.
- Launch panel showing the exact `git worktree add` + `scripts/seed-worktree-mcp.{ps1,sh}` commands the operator pastes into a host terminal.
- Capsule-detail route `/build/work/[capsuleId]` shipping the read-only launch panel for any capsule with a planned workspace.

Out of scope for Phase 2 (deferred):

- Active in-container `git worktree add` execution by the portal (deferred until the substrate-mount question is resolved; production installs use a named volume so in-container creation is invisible to the host).
- Sandbox-runner worktree creation inside Build Studio sandboxes (deferred to a dedicated sandbox-runner slice).
- Automatic worktree deletion or archiving.
- PR creation (still blocked by spec §6.5; Phase 5 enforces).
- Daily-steward warnings about dirty root clone or stale worktrees (Phase 4).
- Lease auto-renewal middleware on capsule-scoped write tools (Phase 3).
- Executor handoff `executor-changed` activity (Phase 3 — when Build Studio + desktop agents attach).

### File Structure

- `apps/web/lib/work-capsules.ts`: add `WORK_CAPSULE_ACTIVITY_KINDS += "workspace-planned"`, add path/slug helpers (`buildCapsuleSlug`, `buildCapsuleBranchName`, `buildCapsuleWorktreePath`, `isRootClonePath`), add `RELEASE_WORKTREE_DEFAULTS` constant for OS-specific defaults.
- `apps/web/lib/work-capsules/work-capsule-store.ts`: add `planCapsuleWorkspace` store function. Reuses existing transaction pattern.
- `apps/web/lib/work-capsules/work-capsule-store.test.ts`: add coverage for the new store function (collision, root-clone refusal, idempotent re-plan).
- `apps/web/lib/work-capsules/git-scanner.ts`: add `listLocalBranches(repoRoot)` returning the set of branch names (used for collision detection).
- `apps/web/lib/work-capsules/git-scanner.test.ts`: cover `parseBranchList`.
- `apps/web/lib/work-capsules/mcp-handlers.ts`: add `planCapsuleWorktreeTool` handler.
- `apps/web/lib/work-capsules/launch-presenter.ts`: NEW — pure function `presentLaunchInstructions(capsule, os)` returning ordered command strings + descriptive labels. Tested in isolation.
- `apps/web/lib/work-capsules/launch-presenter.test.ts`: NEW.
- `apps/web/lib/mcp-tools.ts`: register the `plan_capsule_worktree` PLATFORM_TOOLS definition + dispatch case in the same commit as the handler (spec §15 Phase 1 lesson on bundled tool registration).
- `apps/web/lib/mcp-tools-work-capsules.test.ts`: extend with the new tool path tests.
- `apps/web/lib/work-capsules-enum-parity.test.ts`: extend the parity test to cover the new activity-kind enum entry.
- `apps/web/lib/tak/agent-grants.ts`: add `plan_capsule_worktree: ["work_capsule_write"]`.
- `apps/web/lib/tak/agent-grants.test.ts`: cover the new mapping.
- `apps/web/components/platform/EffectivePermissionsPanel.tsx`: mirror the grant mapping.
- `packages/db/data/grant_catalog.json`: add `plan_capsule_worktree` to `work_capsule_write.honored_by_tools` (seed parity).
- `apps/web/lib/mcp-tools.test.ts`: capability-gate test for `plan_capsule_worktree` (human side of the two-gate model).
- `apps/web/lib/actions/work-capsules.ts`: add `createGovernedWorkAction(input)` server action used by the form; expose `getCapsuleDetail(capsuleId)` for the detail route.
- `apps/web/lib/actions/work-capsules.test.ts`: cover unauthorized + happy path + root-clone refusal.
- `apps/web/components/build/work-control/CreateGovernedWorkForm.tsx`: NEW.
- `apps/web/components/build/work-control/CreateGovernedWorkForm.test.tsx`: NEW.
- `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.tsx`: NEW.
- `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.test.tsx`: NEW.
- `apps/web/components/build/work-control/WorkControlPanel.tsx`: render `CreateGovernedWorkForm` above the active-capsules table.
- `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx`: NEW detail route.

## Chunk 2: Branch And Path Allocation

### Task 1: Slug, branch-name, and worktree-path helpers

**Files:**
- Modify: `apps/web/lib/work-capsules.ts`
- Modify: `apps/web/lib/work-capsules.test.ts`

- [ ] **Step 1: Extend the tests**

Append to `apps/web/lib/work-capsules.test.ts`:

```ts
import {
  buildCapsuleSlug,
  buildCapsuleBranchName,
  buildCapsuleWorktreePath,
  isRootClonePath,
  RELEASE_WORKTREE_DEFAULTS,
} from "./work-capsules";

describe("buildCapsuleSlug", () => {
  it("lowercases, replaces non-alnum with hyphens, trims, and caps length", () => {
    expect(buildCapsuleSlug("Provider routing tool capability")).toBe("provider-routing-tool-capability");
    expect(buildCapsuleSlug("  Lots   of    spaces  ")).toBe("lots-of-spaces");
    expect(buildCapsuleSlug("emoji 🎉 and 中文 mixed!")).toBe("emoji-and-mixed");
    const longTitle = "a".repeat(120);
    expect(buildCapsuleSlug(longTitle).length).toBeLessThanOrEqual(48);
  });

  it("falls back to capsuleId tail when the title slugs to empty", () => {
    expect(buildCapsuleSlug("...", "WC-ABCD1234")).toBe("wc-abcd1234");
  });
});

describe("buildCapsuleBranchName", () => {
  it("uses the chosen taxonomy as prefix", () => {
    expect(buildCapsuleBranchName({ taxonomy: "feat", slug: "work-capsule" })).toBe("feat/work-capsule");
    expect(buildCapsuleBranchName({ taxonomy: "doc", slug: "work-capsule-phase-2" })).toBe("doc/work-capsule-phase-2");
  });

  it("rejects an unknown taxonomy", () => {
    expect(() => buildCapsuleBranchName({ taxonomy: "wat" as any, slug: "x" })).toThrow(/branch taxonomy/i);
  });
});

describe("buildCapsuleWorktreePath", () => {
  it("emits the Windows convention for win32", () => {
    expect(buildCapsuleWorktreePath({ os: "win32", slug: "work-capsule" })).toBe("D:\\DPF-work-capsule");
  });

  it("emits the Unix convention for darwin and linux", () => {
    expect(buildCapsuleWorktreePath({ os: "darwin", slug: "work-capsule", home: "/Users/mark" })).toBe("/Users/mark/dpf-worktrees/work-capsule");
    expect(buildCapsuleWorktreePath({ os: "linux", slug: "work-capsule", home: "/home/mark" })).toBe("/home/mark/dpf-worktrees/work-capsule");
  });
});

describe("isRootClonePath", () => {
  it("recognizes the canonical Windows root clone", () => {
    expect(isRootClonePath("D:\\DPF", "win32")).toBe(true);
    expect(isRootClonePath("d:/DPF", "win32")).toBe(true);
    expect(isRootClonePath("D:\\DPF-feature", "win32")).toBe(false);
  });

  it("recognizes the canonical Unix root clone", () => {
    expect(isRootClonePath("/Users/mark/dpf", "darwin", "/Users/mark")).toBe(true);
    expect(isRootClonePath("/home/mark/dpf-worktrees/x", "linux", "/home/mark")).toBe(false);
  });

  it("respects the DPF_RELEASE_WORKTREE_PATH override when supplied", () => {
    expect(isRootClonePath("/srv/release", "linux", "/home/x", "/srv/release")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts
```

Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Add the helpers**

In `apps/web/lib/work-capsules.ts`, add:

```ts
export const RELEASE_WORKTREE_DEFAULTS = {
  win32: "D:\\DPF",
  darwin: "{home}/dpf",
  linux: "{home}/dpf",
} as const;

const MAX_SLUG_LENGTH = 48;

export function buildCapsuleSlug(title: string, capsuleIdFallback?: string): string {
  // NFKD splits accented letters into base + combining diacritic; the
  // ̀-ͯ range strips the combining marks. The unicode escape form
  // is mandatory — literal combining characters render as invisible glyphs in
  // markdown editors and silently corrupt the regex.
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  if (slug.length > 0) return slug;
  if (!capsuleIdFallback) return "capsule";
  return capsuleIdFallback.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildCapsuleBranchName(args: {
  taxonomy: WorkCapsuleBranchTaxonomy;
  slug: string;
}): string {
  if (!TAXONOMY_SET.has(args.taxonomy)) {
    throw new Error(`Invalid branch taxonomy: ${args.taxonomy}`);
  }
  return `${args.taxonomy}/${args.slug}`;
}

// Resolve the user's home directory across Windows (USERPROFILE) and
// POSIX (HOME). Falls back to empty string only if both are unset, which
// would make POSIX worktree paths nonsense — surfaced as an error
// downstream rather than producing a path like `/dpf-worktrees/<slug>`.
function resolveHome(explicit: string | undefined): string {
  return explicit ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
}

export function buildCapsuleWorktreePath(args: {
  os: NodeJS.Platform;
  slug: string;
  home?: string;
}): string {
  if (args.os === "win32") return `D:\\DPF-${args.slug}`;
  const home = resolveHome(args.home);
  return `${home}/dpf-worktrees/${args.slug}`;
}

export function isRootClonePath(
  candidate: string,
  os: NodeJS.Platform,
  home?: string,
  releaseOverride?: string,
): boolean {
  const normalized = candidate.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (releaseOverride) {
    return normalized === releaseOverride.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  const defaults: string[] =
    os === "win32"
      ? ["d:/dpf"]
      : [`${resolveHome(home).toLowerCase()}/dpf`];
  return defaults.includes(normalized);
}
```

Also extend `WORK_CAPSULE_ACTIVITY_KINDS` to include `"workspace-planned"`:

```ts
export const WORK_CAPSULE_ACTIVITY_KINDS = [
  // ...existing values...
  "workspace-planned",
] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/work-capsules.ts apps/web/lib/work-capsules.test.ts
git commit -s -m "feat(work-capsules): branch/path/slug helpers for governed creation"
```

### Task 2: `listLocalBranches` scanner helper

**Files:**
- Modify: `apps/web/lib/work-capsules/git-scanner.ts`
- Modify: `apps/web/lib/work-capsules/git-scanner.test.ts`

- [ ] **Step 1: Extend the test**

Append to `apps/web/lib/work-capsules/git-scanner.test.ts`:

```ts
import { parseBranchList } from "./git-scanner";

describe("parseBranchList", () => {
  it("returns local branch names with leading * and whitespace stripped", () => {
    const out = "* main\n  doc/portal\n  feat/work-capsule\n  (HEAD detached at abc1234)\n";
    expect(parseBranchList(out)).toEqual(["main", "doc/portal", "feat/work-capsule"]);
  });

  it("ignores empty input", () => {
    expect(parseBranchList("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/git-scanner.test.ts
```

Expected: FAIL — `parseBranchList` does not exist.

- [ ] **Step 3: Add the helper**

In `apps/web/lib/work-capsules/git-scanner.ts`, add:

```ts
export function parseBranchList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/^\*\s+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("("));
}

export async function listLocalBranches(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "branch", "--list"], {
    timeout: 5000,
    windowsHide: true,
  });
  return parseBranchList(stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/git-scanner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/work-capsules/git-scanner.ts apps/web/lib/work-capsules/git-scanner.test.ts
git commit -s -m "feat(work-capsules): scanner helper to list local branches"
```

## Chunk 3: Store, MCP Tool, And Grants

### Task 3: `planCapsuleWorkspace` store function

**Files:**
- Modify: `apps/web/lib/work-capsules/work-capsule-store.ts`
- Modify: `apps/web/lib/work-capsules/work-capsule-store.test.ts`

- [ ] **Step 1: Write the store test**

Append to `apps/web/lib/work-capsules/work-capsule-store.test.ts`:

```ts
import { planCapsuleWorkspace } from "./work-capsule-store";

describe("planCapsuleWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists deterministic branch + worktree path on first plan and writes a workspace-planned activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0001",
      title: "Provider routing tool capability",
      headBranch: null,
      worktreePath: null,
    });
    db.workCapsule.update.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0001",
      headBranch: "feat/provider-routing-tool-capability",
      worktreePath: "D:\\DPF-provider-routing-tool-capability",
      branchTaxonomy: "feat",
    });
    db.workCapsule.findFirst.mockResolvedValueOnce(null);

    const result = await planCapsuleWorkspace({
      db,
      capsuleId: "WC-PLAN0001",
      taxonomy: "feat",
      os: "win32",
      home: "/Users/mark",
      existingBranches: new Set(),
      actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
    });

    expect(result.headBranch).toBe("feat/provider-routing-tool-capability");
    expect(result.worktreePath).toBe("D:\\DPF-provider-routing-tool-capability");
    expect(db.workCapsuleActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "workspace-planned" }),
      }),
    );
  });

  it("returns the existing plan on idempotent re-plan without writing a second activity", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0002",
      title: "Provider routing tool capability",
      headBranch: "feat/provider-routing-tool-capability",
      worktreePath: "D:\\DPF-provider-routing-tool-capability",
      branchTaxonomy: "feat",
    });

    const result = await planCapsuleWorkspace({
      db,
      capsuleId: "WC-PLAN0002",
      taxonomy: "feat",
      os: "win32",
      home: "/Users/mark",
      existingBranches: new Set(),
      actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
    });

    expect(result.headBranch).toBe("feat/provider-routing-tool-capability");
    expect(db.workCapsule.update).not.toHaveBeenCalled();
    expect(db.workCapsuleActivity.create).not.toHaveBeenCalled();
  });

  it("throws on partial-plan state (one of headBranch/worktreePath null, the other set)", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PARTIAL",
      title: "Half written",
      headBranch: "feat/half-written",
      worktreePath: null,
    });

    await expect(
      planCapsuleWorkspace({
        db,
        capsuleId: "WC-PARTIAL",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      }),
    ).rejects.toThrow(/partial-plan state/i);
  });

  it("refuses to propose the root clone as the worktree path", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0003",
      title: "dpf",
      headBranch: null,
      worktreePath: null,
    });

    await expect(
      planCapsuleWorkspace({
        db,
        capsuleId: "WC-PLAN0003",
        taxonomy: "feat",
        os: "win32",
        home: "/Users/mark",
        existingBranches: new Set(),
        actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
      }),
    ).rejects.toThrow(/root clone/i);
  });

  it("appends a numeric suffix when the slug collides with an existing branch", async () => {
    db.workCapsule.findUnique.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0004",
      title: "Work capsule",
      headBranch: null,
      worktreePath: null,
    });
    db.workCapsule.update.mockResolvedValueOnce({
      id: "row-1",
      capsuleId: "WC-PLAN0004",
      headBranch: "feat/work-capsule-2",
      worktreePath: "D:\\DPF-work-capsule-2",
      branchTaxonomy: "feat",
    });
    db.workCapsule.findFirst.mockResolvedValueOnce(null);

    const result = await planCapsuleWorkspace({
      db,
      capsuleId: "WC-PLAN0004",
      taxonomy: "feat",
      os: "win32",
      home: "/Users/mark",
      existingBranches: new Set(["feat/work-capsule"]),
      actor: { userId: "user-1", agentId: null, principalId: "PRN-1" },
    });

    expect(result.headBranch).toBe("feat/work-capsule-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/work-capsule-store.test.ts
```

Expected: FAIL — `planCapsuleWorkspace` does not exist.

- [ ] **Step 3: Implement the store function**

In `apps/web/lib/work-capsules/work-capsule-store.ts`, add:

```ts
import {
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isRootClonePath,
  type WorkCapsuleBranchTaxonomy,
} from "@/lib/work-capsules";

export async function planCapsuleWorkspace(args: {
  db: CapsuleDb;
  capsuleId: string;
  taxonomy: WorkCapsuleBranchTaxonomy;
  os: NodeJS.Platform;
  home: string | undefined;
  existingBranches: Set<string>;
  actor: Actor;
  releaseOverride?: string;
}) {
  const capsule = await args.db.workCapsule.findUnique({ where: { capsuleId: args.capsuleId } });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  // Idempotent: a re-plan returns the existing record without a duplicate
  // activity. Requires both fields set together. A partial-write state
  // (one set, the other null) is treated as an integrity failure rather
  // than silently re-allocating — otherwise determinism breaks: an
  // operator could see different worktree paths between calls if the
  // first call's transaction half-committed.
  if (capsule.headBranch && capsule.worktreePath) {
    return capsule;
  }
  if (capsule.headBranch || capsule.worktreePath) {
    throw new Error(
      `Work Capsule ${args.capsuleId} is in a partial-plan state ` +
        `(headBranch=${capsule.headBranch ?? "null"}, worktreePath=${capsule.worktreePath ?? "null"}). ` +
        `Repair the row before re-planning.`,
    );
  }

  // Slug + collision handling. Existing branches come from the live scanner;
  // capsule-level collision is enforced by the (repositoryFullName, headBranch)
  // partial unique index added in Phase 1.
  const baseSlug = buildCapsuleSlug(capsule.title, capsule.capsuleId);
  let slug = baseSlug;
  let candidate = buildCapsuleBranchName({ taxonomy: args.taxonomy, slug });
  let suffix = 2;
  while (args.existingBranches.has(candidate)) {
    slug = `${baseSlug}-${suffix}`;
    candidate = buildCapsuleBranchName({ taxonomy: args.taxonomy, slug });
    suffix += 1;
    if (suffix > 99) throw new Error("Could not allocate a unique branch name within 99 attempts");
  }

  const worktreePath = buildCapsuleWorktreePath({ os: args.os, slug, home: args.home });
  if (isRootClonePath(worktreePath, args.os, args.home, args.releaseOverride)) {
    throw new Error("Refusing to plan the root clone as an active workspace");
  }

  return args.db.$transaction!(async (tx: CapsuleDb) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: {
        headBranch: candidate,
        worktreePath,
        branchTaxonomy: args.taxonomy,
        baseBranch: capsule.baseBranch ?? "main",
        status: capsule.status === "draft" ? "ready" : capsule.status,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "workspace-planned",
      summary: `Planned ${candidate} at ${worktreePath}`,
      payload: { headBranch: candidate, worktreePath, branchTaxonomy: args.taxonomy },
      actor: args.actor,
    });
    return updated;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/work-capsule-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/work-capsules/work-capsule-store.ts apps/web/lib/work-capsules/work-capsule-store.test.ts
git commit -s -m "feat(work-capsules): planCapsuleWorkspace store function"
```

### Task 4: `plan_capsule_worktree` MCP tool + grants + parity test

**Files:**
- Modify: `apps/web/lib/work-capsules/mcp-handlers.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-work-capsules.test.ts`
- Modify: `apps/web/lib/work-capsules-enum-parity.test.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: `apps/web/lib/tak/agent-grants.test.ts`
- Modify: `apps/web/components/platform/EffectivePermissionsPanel.tsx`

- [ ] **Step 1: Write MCP test**

Append to `apps/web/lib/mcp-tools-work-capsules.test.ts`:

```ts
it("plan_capsule_worktree persists the planned workspace", async () => {
  mockPrisma.workCapsule.findUnique.mockResolvedValueOnce({
    id: "row-1",
    capsuleId: "WC-PLANMCP",
    title: "Provider routing tool capability",
    headBranch: null,
    worktreePath: null,
  });
  mockPrisma.workCapsule.update.mockResolvedValueOnce({
    id: "row-1",
    capsuleId: "WC-PLANMCP",
    headBranch: "feat/provider-routing-tool-capability",
    worktreePath: expect.any(String),
    branchTaxonomy: "feat",
  });

  const { executeTool } = await import("./mcp-tools");
  const result = await executeTool(
    "plan_capsule_worktree",
    { capsuleId: "WC-PLANMCP", taxonomy: "feat" },
    "user-1",
    { agentId: null },
  );
  expect(result.success).toBe(true);
  expect(result.entityId).toBe("WC-PLANMCP");
});

it("plan_capsule_worktree rejects an unknown taxonomy", async () => {
  const { executeTool } = await import("./mcp-tools");
  const result = await executeTool(
    "plan_capsule_worktree",
    { capsuleId: "WC-PLANMCP", taxonomy: "wat" },
    "user-1",
    { agentId: null },
  );
  expect(result.success).toBe(false);
  expect(result.error).toBe("invalid_taxonomy");
});
```

Append to `apps/web/lib/work-capsules-enum-parity.test.ts`:

```ts
it("plan_capsule_worktree.taxonomy mirrors WORK_CAPSULE_BRANCH_TAXONOMIES", () => {
  expect(enumOf("plan_capsule_worktree", "taxonomy")).toEqual([...WORK_CAPSULE_BRANCH_TAXONOMIES]);
});
```

Also append a capability-gate test to `apps/web/lib/mcp-tools.test.ts` so the human-side gate is covered (the §17 verification list calls out BOTH the capability gate and the grant gate; the grant side already lands in `agent-grants.test.ts`):

```ts
it("plan_capsule_worktree is hidden from a view-only platform user", async () => {
  const viewer = { id: "u1", platformRole: "HR-300", isSuperuser: false };
  const tools = await getAvailableTools(viewer, { externalAccessEnabled: false });
  expect(tools.find((t) => t.name === "plan_capsule_worktree")).toBeUndefined();
});

it("plan_capsule_worktree is exposed to a builder/admin", async () => {
  const builder = { id: "u2", platformRole: "HR-100", isSuperuser: true };
  const tools = await getAvailableTools(builder, { externalAccessEnabled: false });
  const tool = tools.find((t) => t.name === "plan_capsule_worktree");
  expect(tool).toBeDefined();
  expect(tool!.requiredCapability).toBe("manage_backlog");
});
```

Append to `apps/web/lib/tak/agent-grants.test.ts`:

```ts
it("plan_capsule_worktree requires work_capsule_write", () => {
  expect(isToolAllowedByGrants("plan_capsule_worktree", ["work_capsule_write"])).toBe(true);
  expect(isToolAllowedByGrants("plan_capsule_worktree", ["work_capsule_read"])).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify failure**

```powershell
pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts lib/work-capsules-enum-parity.test.ts lib/tak/agent-grants.test.ts
```

Expected: FAIL on all three.

- [ ] **Step 3: Add the MCP handler**

In `apps/web/lib/work-capsules/mcp-handlers.ts`, add:

```ts
import { listLocalBranches } from "./git-scanner";
import {
  WORK_CAPSULE_BRANCH_TAXONOMIES,
  isWorkCapsuleBranchTaxonomy,
} from "@/lib/work-capsules";
import { planCapsuleWorkspace } from "./work-capsule-store";

export async function planCapsuleWorktreeTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = stringParam(params, "capsuleId");
  const taxonomy = stringParam(params, "taxonomy");
  if (!capsuleId) return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  if (!taxonomy || !isWorkCapsuleBranchTaxonomy(taxonomy)) {
    return {
      success: false,
      error: "invalid_taxonomy",
      message: `taxonomy must be one of: ${WORK_CAPSULE_BRANCH_TAXONOMIES.join(", ")}.`,
    };
  }

  // Best-effort branch collision lookup; if the scanner fails we proceed with
  // an empty set (the (repositoryFullName, headBranch) partial unique index
  // still catches DB-level collisions).
  let existingBranches = new Set<string>();
  try {
    const repoRoot = process.env.DPF_REPO_ROOT?.trim() || process.cwd();
    existingBranches = new Set(await listLocalBranches(repoRoot));
  } catch {
    /* scanner unavailable; continue */
  }

  try {
    const capsule = await planCapsuleWorkspace({
      db: prisma,
      capsuleId,
      taxonomy,
      os: process.platform,
      home: process.env.HOME ?? process.env.USERPROFILE,
      existingBranches,
      releaseOverride: process.env.DPF_RELEASE_WORKTREE_PATH,
      actor: await actor(userId, context),
    });
    return {
      success: true,
      entityId: capsule.capsuleId,
      message: `Planned ${capsule.headBranch} at ${capsule.worktreePath}.`,
      data: { capsule },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    if (/root clone/i.test(message)) {
      return { success: false, error: "root_clone_refused", message };
    }
    if (/branch name/i.test(message)) {
      return { success: false, error: "branch_allocation_failed", message };
    }
    throw error;
  }
}
```

Also export `isWorkCapsuleBranchTaxonomy` from `apps/web/lib/work-capsules.ts`:

```ts
export function isWorkCapsuleBranchTaxonomy(value: unknown): value is WorkCapsuleBranchTaxonomy {
  return typeof value === "string" && TAXONOMY_SET.has(value);
}
```

- [ ] **Step 4: Register the PLATFORM_TOOLS definition and dispatch**

In `apps/web/lib/mcp-tools.ts`, add the tool definition near the other capsule tools (alphabetical with the other `plan_*` tools if any, otherwise grouped):

```ts
  {
    name: "plan_capsule_worktree",
    description: "Generate the deterministic branch + worktree-path plan for a Work Capsule. Persists headBranch/worktreePath/branchTaxonomy. Idempotent: re-planning returns the existing plan. Refuses to propose the root clone.",
    parameters: {
      type: "object",
      properties: {
        capsuleId: { type: "string", description: "WC- semantic id" },
        taxonomy: { type: "string", enum: [...WORK_CAPSULE_BRANCH_TAXONOMIES], description: "Branch prefix" },
      },
      required: ["capsuleId", "taxonomy"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
```

Add the dispatch case to `executeTool`:

```ts
    case "plan_capsule_worktree": {
      const { planCapsuleWorktreeTool } = await import("@/lib/work-capsules/mcp-handlers");
      return planCapsuleWorktreeTool(params, userId, context);
    }
```

Add the grant in `apps/web/lib/tak/agent-grants.ts`:

```ts
  plan_capsule_worktree: ["work_capsule_write"],
```

Mirror in `apps/web/components/platform/EffectivePermissionsPanel.tsx`.

Update the seeded grant catalog at `packages/db/data/grant_catalog.json` so fresh installs honor the new tool. Per the "fix the seed, not the runtime path" feedback memory and AGENTS.md §3 (seed/runtime parity), missing this is a silent-failure substrate trap that only bites days later on the first fresh install. Add `plan_capsule_worktree` to `work_capsule_write.honored_by_tools` in alphabetical order:

```json
{
  "key": "work_capsule_write",
  ...
  "honored_by_tools": [
    "claim_capsule_scope",
    "create_work_capsule",
    "heartbeat_capsule",
    "plan_capsule_worktree",
    "record_capsule_evidence",
    "release_capsule_scope",
    "update_work_capsule_status"
  ],
  ...
}
```

- [ ] **Step 5: Run the five affected test files to verify pass**

```powershell
pnpm --filter web exec vitest run lib/mcp-tools-work-capsules.test.ts lib/work-capsules-enum-parity.test.ts lib/tak/agent-grants.test.ts lib/work-capsules.test.ts lib/mcp-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Update the file-structure modifier list (housekeeping)**

This task touched `packages/db/data/grant_catalog.json` and `apps/web/lib/mcp-tools.test.ts` in addition to the originally-planned files. Confirm both are tracked in the commit step below.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/work-capsules/mcp-handlers.ts apps/web/lib/work-capsules.ts apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts apps/web/lib/mcp-tools-work-capsules.test.ts apps/web/lib/work-capsules-enum-parity.test.ts apps/web/lib/tak/agent-grants.ts apps/web/lib/tak/agent-grants.test.ts apps/web/components/platform/EffectivePermissionsPanel.tsx packages/db/data/grant_catalog.json
git commit -s -m "feat(work-capsules): plan_capsule_worktree MCP tool"
```

## Chunk 4: UI Surface

### Task 5: Launch presenter + server actions

**Files:**
- Create: `apps/web/lib/work-capsules/launch-presenter.ts`
- Create: `apps/web/lib/work-capsules/launch-presenter.test.ts`
- Modify: `apps/web/lib/actions/work-capsules.ts`
- Modify: `apps/web/lib/actions/work-capsules.test.ts`

- [ ] **Step 1: Write the launch-presenter test**

Create `apps/web/lib/work-capsules/launch-presenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { presentLaunchInstructions } from "./launch-presenter";

describe("presentLaunchInstructions", () => {
  it("returns the Windows command sequence", () => {
    const steps = presentLaunchInstructions(
      {
        capsuleId: "WC-LAUNCH01",
        headBranch: "feat/work-control",
        worktreePath: "D:\\DPF-work-control",
        baseBranch: "main",
      },
      "win32",
    );
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0].command).toContain("git worktree add");
    expect(steps[0].command).toContain("D:\\DPF-work-control");
    expect(steps[0].command).toContain("feat/work-control");
    expect(steps[0].command).toContain("origin/main");
    expect(steps[1].command).toContain("scripts\\seed-worktree-mcp.ps1");
    expect(steps[1].command).toContain("-Target");
  });

  it("returns the Unix command sequence for macOS/Linux", () => {
    const steps = presentLaunchInstructions(
      {
        capsuleId: "WC-LAUNCH02",
        headBranch: "feat/work-control",
        worktreePath: "/Users/mark/dpf-worktrees/work-control",
        baseBranch: "main",
      },
      "darwin",
    );
    expect(steps[0].command).toContain("git worktree add");
    // bash variant takes a positional path arg (no flag) — see
    // scripts/seed-worktree-mcp.sh argv handler.
    expect(steps[1].command).toMatch(/scripts\/seed-worktree-mcp\.sh\s+"\/Users\/mark/);
  });

  it("returns an empty plan with a 'plan capsule first' diagnostic when fields are missing", () => {
    const steps = presentLaunchInstructions(
      { capsuleId: "WC-UNPLANNED", headBranch: null, worktreePath: null, baseBranch: null },
      "win32",
    );
    expect(steps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/launch-presenter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the launch presenter**

Create `apps/web/lib/work-capsules/launch-presenter.ts`:

```ts
export type LaunchStep = {
  label: string;
  command: string;
};

type LaunchInput = {
  capsuleId: string;
  headBranch: string | null;
  worktreePath: string | null;
  baseBranch: string | null;
};

export function presentLaunchInstructions(capsule: LaunchInput, os: NodeJS.Platform): LaunchStep[] {
  if (!capsule.headBranch || !capsule.worktreePath) return [];
  const base = capsule.baseBranch ?? "main";
  if (os === "win32") {
    return [
      {
        label: "Create the worktree from origin/" + base,
        command: `git worktree add "${capsule.worktreePath}" -b "${capsule.headBranch}" "origin/${base}"`,
      },
      {
        label: "Seed local MCP credentials into the new worktree",
        // The PowerShell script's param is -Target (see scripts/seed-worktree-mcp.ps1
        // line 19: `[string]$Target = (Get-Location).Path`). Using -Path would
        // fail with "A parameter cannot be found that matches parameter name 'Path'."
        command: `pwsh -File scripts\\seed-worktree-mcp.ps1 -Target "${capsule.worktreePath}"`,
      },
    ];
  }
  return [
    {
      label: `Create the worktree from origin/${base}`,
      command: `git worktree add "${capsule.worktreePath}" -b "${capsule.headBranch}" "origin/${base}"`,
    },
    {
      label: "Seed local MCP credentials into the new worktree",
      // The bash script takes a positional path (no flag); see
      // scripts/seed-worktree-mcp.sh argv handler (case "$arg" in ... esac).
      command: `bash scripts/seed-worktree-mcp.sh "${capsule.worktreePath}"`,
    },
  ];
}
```

- [ ] **Step 4: Extend the server actions**

Extend `apps/web/lib/actions/work-capsules.ts` with:

```ts
"use server";

import { createWorkCapsule, planCapsuleWorkspace } from "@/lib/work-capsules/work-capsule-store";
import { listLocalBranches } from "@/lib/work-capsules/git-scanner";
import {
  isWorkCapsuleBranchTaxonomy,
  type WorkCapsuleBranchTaxonomy,
} from "@/lib/work-capsules";

export async function createGovernedWorkAction(input: {
  title: string;
  objective: string;
  taxonomy: WorkCapsuleBranchTaxonomy;
  idempotencyKey: string;
}) {
  const userId = await requireBuildAccess();
  if (!isWorkCapsuleBranchTaxonomy(input.taxonomy)) {
    throw new Error("Invalid taxonomy");
  }
  const capsule = await createWorkCapsule({
    db: prisma,
    input: {
      title: input.title,
      objective: input.objective,
      source: "manual",
      idempotencyKey: input.idempotencyKey,
      executorKind: null,
    },
    actor: { userId, agentId: null, principalId: null },
  });
  let existingBranches = new Set<string>();
  try {
    existingBranches = new Set(await listLocalBranches(resolveRepoRoot()));
  } catch {
    /* scanner unavailable */
  }
  const planned = await planCapsuleWorkspace({
    db: prisma,
    capsuleId: capsule.capsuleId,
    taxonomy: input.taxonomy,
    os: process.platform,
    home: process.env.HOME ?? process.env.USERPROFILE,
    existingBranches,
    releaseOverride: process.env.DPF_RELEASE_WORKTREE_PATH,
    actor: { userId, agentId: null, principalId: null },
  });
  return { capsuleId: planned.capsuleId, headBranch: planned.headBranch, worktreePath: planned.worktreePath };
}

export async function getCapsuleDetail(capsuleId: string) {
  await requireBuildAccess();
  return prisma.workCapsule.findUnique({
    where: { capsuleId },
    include: { activities: { orderBy: { recordedAt: "desc" }, take: 25 } },
  });
}
```

- [ ] **Step 5: Extend the server-action test**

The existing test in `apps/web/lib/actions/work-capsules.test.ts` already hoists `mockAuth`, `mockCan`, `mockPrisma`, and the git-scanner mocks (see Phase 1 plan). Phase 2 adds store-function mocks rather than re-mocking Prisma writes — keeps the test boundary at the action↔store seam where it belongs.

At the top of the file, extend the `vi.hoisted` block:

```ts
const {
  mockAuth,
  mockCan,
  mockGetWorktreeDirtySummary,
  mockPrisma,
  mockScanGitWorktrees,
  mockListLocalBranches,           // NEW
  mockCreateWorkCapsule,           // NEW
  mockPlanCapsuleWorkspace,        // NEW
} = vi.hoisted(() => ({
  // ...existing fields unchanged...
  mockListLocalBranches: vi.fn(),
  mockCreateWorkCapsule: vi.fn(),
  mockPlanCapsuleWorkspace: vi.fn(),
}));

vi.mock("@/lib/work-capsules/git-scanner", () => ({
  getWorktreeDirtySummary: mockGetWorktreeDirtySummary,
  scanGitWorktrees: mockScanGitWorktrees,
  listLocalBranches: mockListLocalBranches,            // NEW
}));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({
  createWorkCapsule: mockCreateWorkCapsule,
  planCapsuleWorkspace: mockPlanCapsuleWorkspace,
}));
```

Then append the new test describe block — note it mocks `can`, never `platformRole`, to stay consistent with the existing pattern:

```ts
describe("createGovernedWorkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-100", isSuperuser: true },
    });
    mockCan.mockReturnValue(true);
    mockListLocalBranches.mockResolvedValue([]);
    mockCreateWorkCapsule.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-CREATED",
      title: "x",
    });
    mockPlanCapsuleWorkspace.mockResolvedValue({
      capsuleId: "WC-CREATED",
      headBranch: "feat/x",
      worktreePath: "D:\\DPF-x",
    });
  });

  it("rejects an unauthorized caller via the capability gate", async () => {
    mockCan.mockReturnValue(false);
    const { createGovernedWorkAction } = await import("./work-capsules");
    await expect(
      createGovernedWorkAction({ title: "x", objective: "y", taxonomy: "feat", idempotencyKey: "k" }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("rejects an invalid taxonomy", async () => {
    const { createGovernedWorkAction } = await import("./work-capsules");
    await expect(
      createGovernedWorkAction({ title: "x", objective: "y", taxonomy: "wat" as any, idempotencyKey: "k" }),
    ).rejects.toThrow(/taxonomy/i);
  });

  it("creates the capsule then plans the workspace and returns both", async () => {
    const { createGovernedWorkAction } = await import("./work-capsules");
    const result = await createGovernedWorkAction({
      title: "Provider routing tool capability",
      objective: "Phase 2 verification",
      taxonomy: "feat",
      idempotencyKey: "stable-key-1",
    });
    expect(result.capsuleId).toBe("WC-CREATED");
    expect(result.headBranch).toBe("feat/x");
    expect(mockCreateWorkCapsule).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ idempotencyKey: "stable-key-1" }),
      }),
    );
    expect(mockPlanCapsuleWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ capsuleId: "WC-CREATED", taxonomy: "feat" }),
    );
  });
});
```

- [ ] **Step 6: Run tests to verify all pass**

```powershell
pnpm --filter web exec vitest run lib/work-capsules/launch-presenter.test.ts lib/actions/work-capsules.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/work-capsules/launch-presenter.ts apps/web/lib/work-capsules/launch-presenter.test.ts apps/web/lib/actions/work-capsules.ts apps/web/lib/actions/work-capsules.test.ts
git commit -s -m "feat(work-capsules): launch presenter + governed-creation server action"
```

### Task 6: Create-governed-work form + launch panel UI

**Files:**
- Create: `apps/web/components/build/work-control/CreateGovernedWorkForm.tsx`
- Create: `apps/web/components/build/work-control/CreateGovernedWorkForm.test.tsx`
- Create: `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.tsx`
- Create: `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.test.tsx`
- Modify: `apps/web/components/build/work-control/WorkControlPanel.tsx`
- Create: `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx`

- [ ] **Step 1: Write the form test**

Create `apps/web/components/build/work-control/CreateGovernedWorkForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateGovernedWorkForm } from "./CreateGovernedWorkForm";

describe("CreateGovernedWorkForm", () => {
  it("renders title, objective, and taxonomy fields", () => {
    render(<CreateGovernedWorkForm action={vi.fn()} />);
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/objective/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/taxonomy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan governed work/i })).toBeInTheDocument();
  });

  it("renders the AGENTS.md taxonomy options", () => {
    render(<CreateGovernedWorkForm action={vi.fn()} />);
    const select = screen.getByLabelText(/taxonomy/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["feat", "fix", "chore", "doc", "clean"]);
  });
});
```

- [ ] **Step 2: Implement the form**

Create `apps/web/components/build/work-control/CreateGovernedWorkForm.tsx`:

```tsx
"use client";

import { useId, useRef, useState, useTransition } from "react";

type CreateAction = (input: {
  title: string;
  objective: string;
  taxonomy: "feat" | "fix" | "chore" | "doc" | "clean";
  idempotencyKey: string;
}) => Promise<{ capsuleId: string; headBranch: string | null; worktreePath: string | null }>;

export function CreateGovernedWorkForm({ action }: { action: CreateAction }) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [taxonomy, setTaxonomy] = useState<"feat" | "fix" | "chore" | "doc" | "clean">("feat");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  // Stable per-form-instance idempotency key. Using `useId` (React 18+) +
  // a mount-time timestamp captured in a ref ensures the same value
  // across React strict-mode double renders, transition retries, and
  // double-clicks. A new key is generated only after the form resets.
  const formId = useId();
  const mountAtRef = useRef<number>(Date.now());
  const submitCounterRef = useRef<number>(0);

  return (
    <section className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">Plan governed work</h2>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitCounterRef.current += 1;
          const idempotencyKey = `ui:${formId}:${mountAtRef.current}:${submitCounterRef.current}`;
          startTransition(async () => {
            const out = await action({ title, objective, taxonomy, idempotencyKey });
            setResult(`Planned ${out.capsuleId} at ${out.worktreePath ?? "(unplanned)"}`);
          });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
          <span>Title</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
          <span>Taxonomy</span>
          <select
            value={taxonomy}
            onChange={(e) => setTaxonomy(e.target.value as typeof taxonomy)}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
          >
            {["feat", "fix", "chore", "doc", "clean"].map((t) => (
              <option key={t} value={t} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="md:col-span-2 flex flex-col gap-1 text-xs text-[var(--dpf-muted)]">
          <span>Objective</span>
          <textarea
            required
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-sm text-[var(--dpf-text)]"
          />
        </label>
        <div className="md:col-span-2 flex items-center justify-between">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
          >
            {pending ? "Planning…" : "Plan governed work"}
          </button>
          {result ? <span className="text-xs text-[var(--dpf-muted)]">{result}</span> : null}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Write the launch-panel test**

Create `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkCapsuleLaunchPanel } from "./WorkCapsuleLaunchPanel";

describe("WorkCapsuleLaunchPanel", () => {
  it("renders the planned commands when worktree is set", () => {
    render(
      <WorkCapsuleLaunchPanel
        steps={[
          { label: "Create the worktree from origin/main", command: 'git worktree add "D:\\DPF-work-control" -b "feat/work-control" "origin/main"' },
          { label: "Seed local MCP credentials into the new worktree", command: 'pwsh -File scripts\\seed-worktree-mcp.ps1 -Path "D:\\DPF-work-control"' },
        ]}
      />,
    );
    expect(screen.getByText(/Create the worktree from origin\/main/)).toBeInTheDocument();
    expect(screen.getByText(/git worktree add/)).toBeInTheDocument();
    expect(screen.getByText(/seed-worktree-mcp\.ps1/)).toBeInTheDocument();
  });

  it("renders an empty-state nudge when no steps are present", () => {
    render(<WorkCapsuleLaunchPanel steps={[]} />);
    expect(screen.getByText(/Plan the workspace first/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement the launch panel**

Create `apps/web/components/build/work-control/WorkCapsuleLaunchPanel.tsx`:

```tsx
import type { LaunchStep } from "@/lib/work-capsules/launch-presenter";

export function WorkCapsuleLaunchPanel({ steps }: { steps: LaunchStep[] }) {
  if (steps.length === 0) {
    return (
      <section className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Launch</h2>
        <p className="text-sm text-[var(--dpf-muted)]">Plan the workspace first to see the commands.</p>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">Launch</h2>
      <ol className="space-y-3">
        {steps.map((step, idx) => (
          <li key={idx} className="space-y-1">
            <div className="text-xs text-[var(--dpf-muted)]">{idx + 1}. {step.label}</div>
            <pre className="overflow-x-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-text)]">{step.command}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 5: Wire the form into the existing Work Control panel**

In `apps/web/components/build/work-control/WorkControlPanel.tsx`, render the form above the active-capsule table:

```tsx
import { CreateGovernedWorkForm } from "./CreateGovernedWorkForm";
import { createGovernedWorkAction } from "@/lib/actions/work-capsules";

// inside the panel body, above WorkCapsuleTable:
<CreateGovernedWorkForm action={createGovernedWorkAction} />
```

- [ ] **Step 5a: Update the existing WorkControlPanel test to keep it green**

The existing `apps/web/components/build/work-control/WorkControlPanel.test.tsx` does NOT mock `createGovernedWorkAction`. Rendering the panel after Step 5 will eagerly bind the server action import, which fails under vitest's jsdom env because the server action pulls in `auth()` + Prisma. Either:

- (a) refactor `WorkControlPanel` to accept the action as a prop (constructor-injected; route page passes `createGovernedWorkAction`), then update the existing test to render with a `vi.fn()` action; OR
- (b) extract a thin server-side wrapper component (`WorkControlPanelWithForm`) that binds the action, leaving the existing presenter-only `WorkControlPanel` untestable-without-form. (a) is preferred — keeps the component a pure presenter and matches Phase 1's testing pattern.

If you pick (a), the existing tests need this one-line change at the top of each render:

```tsx
render(
  <WorkControlPanel
    capsules={[...]}
    adoptable={[...]}
    createAction={vi.fn()}   // NEW prop
  />,
);
```

- [ ] **Step 6: Add the capsule-detail route**

Create `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCapsuleDetail } from "@/lib/actions/work-capsules";
import { presentLaunchInstructions } from "@/lib/work-capsules/launch-presenter";
import { WorkCapsuleLaunchPanel } from "@/components/build/work-control/WorkCapsuleLaunchPanel";

// Next 16 App Router: `params` is async-resolved. Typing it as `Promise<...>`
// and awaiting it is the supported pattern (the older `{ capsuleId: string }`
// shape was deprecated in Next 15 and fails typecheck in 16).
export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ capsuleId: string }>;
}) {
  const { capsuleId } = await params;
  const capsule = await getCapsuleDetail(capsuleId);
  if (!capsule) notFound();
  const steps = presentLaunchInstructions(
    {
      capsuleId: capsule.capsuleId,
      headBranch: capsule.headBranch,
      worktreePath: capsule.worktreePath,
      baseBranch: capsule.baseBranch,
    },
    process.platform,
  );
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{capsule.title}</h1>
        <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
      </header>
      <WorkCapsuleLaunchPanel steps={steps} />
    </section>
  );
}
```

- [ ] **Step 7: Run UI tests**

```powershell
pnpm --filter web exec vitest run components/build/work-control/CreateGovernedWorkForm.test.tsx components/build/work-control/WorkCapsuleLaunchPanel.test.tsx components/build/work-control/WorkControlPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the UI components**

Quote the path explicitly — PowerShell does NOT honor bash-style backslash escapes for parens/brackets:

```powershell
git add apps/web/components/build/work-control/CreateGovernedWorkForm.tsx apps/web/components/build/work-control/CreateGovernedWorkForm.test.tsx apps/web/components/build/work-control/WorkCapsuleLaunchPanel.tsx apps/web/components/build/work-control/WorkCapsuleLaunchPanel.test.tsx apps/web/components/build/work-control/WorkControlPanel.tsx apps/web/components/build/work-control/WorkControlPanel.test.tsx
git commit -s -m "feat(work-capsules): governed-creation form + launch panel"
```

- [ ] **Step 9: Commit the detail route**

Split route + UI commits — they touch different concerns and split cleanly. Use single-quoted path so PowerShell does not interpret `[` `]` `(` `)` as wildcards:

```powershell
git add 'apps/web/app/(shell)/build/work/[capsuleId]/page.tsx'
git commit -s -m "feat(work-capsules): capsule-detail route with launch panel"
```

## Chunk 5: Verification

### Task 7: Phase 2 verification and PR update

- [ ] **Step 0: Patch spec §15 Phase 2 to reflect the narrowed scope**

In `docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md`, update §15 Phase 2 to reflect the operator-paste pivot (matches the Architecture note at the top of this plan):

Replace:

```
- create worktree from `origin/main`
- seed MCP config
```

With:

```
- generate the deterministic `<prefix>/<capsule-slug>` branch + canonical worktree path; persist on the capsule (`headBranch`, `worktreePath`, `branchTaxonomy`)
- display the exact `git worktree add ... origin/main` + seed-MCP commands; the operator runs them on the host (production installs mount `dpf-source-code` as a named volume, so in-container creation is invisible to the host — substrate-driven narrowing, see Phase 2 plan Architecture)
- active in-container creation deferred to a sandbox-runner slice that owns the substrate-mount question
```

Commit the spec patch as the first commit on this branch so the rest of Phase 2 lands against a spec that matches it:

```powershell
git add docs/superpowers/specs/2026-05-14-portal-work-capsule-control-harness-design.md
git commit -s -m "doc(spec): narrow work-capsule phase 2 to display-and-record"
```

- [ ] **Step 1: Run the full Phase 1+2 focused test set**

```powershell
pnpm --filter web exec vitest run lib/work-capsules.test.ts lib/work-capsules/work-capsule-store.test.ts lib/work-capsules/git-scanner.test.ts lib/work-capsules/work-capsule-presenter.test.ts lib/work-capsules/launch-presenter.test.ts lib/actions/work-capsules.test.ts lib/mcp-tools-work-capsules.test.ts lib/tak/agent-grants.test.ts lib/work-capsules-enum-parity.test.ts components/build/work-control/WorkControlPanel.test.tsx components/build/work-control/CreateGovernedWorkForm.test.tsx components/build/work-control/WorkCapsuleLaunchPanel.test.tsx
```

Expected: every file PASS.

- [ ] **Step 2: Prisma validate (no schema changes expected)**

```powershell
pnpm --filter @dpf/db exec prisma validate
```

Expected: exit 0. Phase 2 should NOT change the schema; if you find yourself adding columns, stop and rescope.

- [ ] **Step 3: Typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: exit 0.

- [ ] **Step 4: Production build**

```powershell
pnpm --filter web build
```

Expected: exit 0; the new route `/build/work/[capsuleId]` MUST appear in the dynamic route table.

- [ ] **Step 5: UX verification against the Docker-served portal**

Rebuild the portal image so it picks up Phase 2:

```powershell
docker compose build --no-cache portal portal-init
docker compose up -d
```

Then verify:

1. Log in at `http://localhost:3000` with `admin@dpf.local` and `ADMIN_PASSWORD` from `.env`.
2. Open `/build/work`.
3. Confirm the "Plan governed work" form is visible above the active-capsules table.
4. Submit with Title="Phase 2 verification", Objective="Confirm Phase 2 governed creation", Taxonomy="feat".
5. The form should display `Planned WC-XXXXXXXX at <worktree path>`.
6. Navigate to `/build/work/WC-XXXXXXXX`.
7. The launch panel renders two ordered commands: `git worktree add ...` and the seed-MCP command for the current OS.
8. Open a host terminal, paste each command in order. The worktree appears on disk; the seed-MCP script copies the local credential files.
9. Return to `/build/work`. The active-capsules table now shows the new capsule with `branch = feat/phase-2-verification` and `worktreePath` filled.
10. The scanner does NOT also surface the new worktree as "adoptable" (it's already adopted via the plan path).

- [ ] **Step 6: Headless MCP smoke (parallel to UX)**

```powershell
$BEARER = (Get-Content .mcp.json | ConvertFrom-Json).mcpServers.dpf.headers.Authorization
$body = @{ jsonrpc = "2.0"; id = 1; method = "tools/list"; params = @{} } | ConvertTo-Json
$resp = Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/mcp/v1 -Headers @{ Authorization = $BEARER } -ContentType "application/json" -Body $body
$resp.result.tools | Where-Object { $_.name -eq "plan_capsule_worktree" } | Format-List
```

Expected: `plan_capsule_worktree` advertised with `taxonomy` enum containing `feat`, `fix`, `chore`, `doc`, `clean`.

- [ ] **Step 7: Push and update PR**

Resolve the active PR for the branch dynamically; never hardcode a PR number:

```powershell
git push
$prNumber = gh pr view --json number -q .number
gh pr comment $prNumber --body "Phase 2 implementation plan added: docs/superpowers/plans/2026-05-16-portal-work-capsule-control-harness-phase-2.md"
```

## Implementation Notes

- Do not edit the root `D:\DPF` checkout for implementation. Use a worktree (e.g. `git worktree add D:\DPF-wc-phase-2 -b feat/work-capsule-phase-2 origin/main`).
- Phase 2 ships **planning + display**, not active host-side worktree creation. The portal generates and records the plan; the operator runs `git worktree add` on the host. This avoids the production-install named-volume trap where in-container worktree creation is invisible to the host.
- Active in-container worktree creation is deferred to a future sandbox-runner slice that owns the substrate-mount question.
- PR creation tooling stays disabled. The spec §6.5 readiness contract gates PR creation; that contract lands in Phase 5.
- Do not grant `work_capsule_promote` to any agent in Phase 2.
- Do not use `npx`; use `pnpm --filter <pkg> exec <tool>`.
- Keep all new UI theme-aware. No `text-gray-*`, `bg-white`, hardcoded hex, or inline color styles.
- The `WORK_CAPSULE_ACTIVITY_KINDS += "workspace-planned"` addition requires the same-commit update to the enum-parity test per AGENTS.md §3.
- Preserve the 20% refactor budget by keeping Phase 2 logic in `work-capsules/*` modules; do not bloat `mcp-tools.ts` beyond the dispatch case + tool definition.

### Architectural Invariants Carried Forward From Phase 1

All Phase 1 invariants stay in force in Phase 2:

- Idempotent capsule creation: `plan_capsule_worktree` MUST be idempotent — re-planning a capsule with `headBranch` and `worktreePath` already set returns the existing values without writing a duplicate `workspace-planned` activity.
- Activity writes are atomic with the capsule mutation (`prisma.$transaction`).
- Principal columns reference `Principal.id` only, resolved via `principal-linking`.
- Tool registration ↔ handler parity: `PLATFORM_TOOLS` entry, dispatch case, and handler land in the same commit.
- Differentiated `requiredCapability`: `plan_capsule_worktree` is a write tool → `manage_backlog` + `work_capsule_write`.
- Enum parity test covers any added activity-kind value (here `workspace-planned`) and the new tool's `taxonomy` enum.

### Phase 2 Invariants Added

- The portal MUST NOT propose the root clone (canonical paths per AGENTS.md §4, or the `DPF_RELEASE_WORKTREE_PATH` override) as a capsule's worktree path. `planCapsuleWorkspace` enforces this at the store layer.
- Branch-name allocation is deterministic: identical title + taxonomy → identical `<prefix>/<slug>`. Collisions append `-2`, `-3`, ... up to `-99`; beyond that the call errors rather than producing a name that fails AGENTS.md §4 naming conventions.
- Re-plan is a no-op: a capsule with `headBranch` and `worktreePath` already set returns the existing plan unchanged. Operators wanting to change a plan must clear those fields explicitly via a future re-plan tool (out of scope for Phase 2).
- Phase 2 does NOT create the worktree on disk. The operator runs the displayed commands.

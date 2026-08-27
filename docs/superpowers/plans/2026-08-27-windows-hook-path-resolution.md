---
status: active
---

# Windows hook path resolution — implementation plan

- **Backlog item:** BI-5CBDC146
- **Work capsule:** WC-CBF01552
- **Design:** [2026-08-27-windows-hook-path-resolution-design.md](../specs/2026-08-27-windows-hook-path-resolution-design.md)
- **Base:** `origin/main` 40a7e46afc35039d2f0d86d33de6d11159867213
- **Branch:** `fix/windows-pre-push-hook-path`

One phase. The change is a corrected path conversion plus the guards that keep
it corrected; there is no ordering constraint worth splitting.

## Phase 1 — resolve hook directories through `fileURLToPath`

### Step 1 — regression guards first (red)

Add `scripts/lib/hooks-dir.test.mjs`:

| Guard | Asserts | Fails before the fix |
| --- | --- | --- |
| `looksLikeUrlPathname` recognises the drive-letter shape | `/D:/…` and `\D:\…` flagged; `D:\…`, `/srv/…`, `/home/…` not | n/a — new helper |
| `resolveHooksDir` never returns a URL pathname | result does not match `/^[\\/][A-Za-z]:/` | Windows only |
| `resolveHooksDir` reaches the real `.githooks` | `existsSync(<dir>/lib/pre-push-chained.sh)` | Windows only |
| `set-hooks-path.mjs` uses the helper | source contains no `import.meta.url).pathname`, does contain `resolveHooksDir` | **every platform** |

The source-level guard is what makes this enforceable on Linux CI, where the
runtime defect is unreproducible.

### Step 2 — the helper

`scripts/lib/hooks-dir.mjs`: `HOOKS_DIR_FROM_SCRIPTS`, `looksLikeUrlPathname`,
`resolveHooksDir(moduleUrl, relative)`. `fileURLToPath` only.

### Step 3 — correct the caller

`scripts/set-hooks-path.mjs`: resolve once into `hooksDir`, pass it to both
`ensurePrePushHook` and `ensurePostCheckoutHook`. Replace both bare `catch {}`
blocks with `catch (error)` that warns and names the consequence — the
local-CI gate will not run on push; the uncommitted-work guard will not run on
checkout. Fail-safe posture is unchanged: neither throws.

### Step 4 — the adjacent pre-existing failure

`scripts/lib/ensure-pre-push-hook.test.mjs` asserts POSIX exec bits, which NTFS
never reports. Extract `assertExecutable(path)`: `accessSync(R_OK)` on win32,
the existing `mode & 0o111` assertion everywhere else. Same defect class as the
BI (Windows-invisible-on-Linux), found while running the suite, fixed rather
than deferred per AGENTS.md §4.

### Step 5 — register the test

Add `scripts/lib/hooks-dir.test.mjs` to the inventory in
`scripts/lib/ci-policy-guards.mjs`. The list is hand-enumerated with no glob:
an omitted test never runs and a green PR says nothing about it.

## Verification

1. `node --test scripts/lib/hooks-dir.test.mjs scripts/lib/ensure-pre-push-hook.test.mjs scripts/lib/ensure-post-checkout-hook.test.mjs` — expect 10/10.
2. Functional, in a clean worktree: `node scripts/set-hooks-path.mjs` must
   report both convergences, and `head -4 .githooks/pre-push` must show the
   delegating shim. Silence is the pre-change failure signature.
3. Exact-tree local CI through the shared lease, then protected merge.

## Rollback

Single commit, single revert. Reverting restores the pre-change behaviour,
which is what ships today.

## Out of scope

- `BI-3AE38A1F` — "Research" has no operational-fix recording path, so
  `RESEARCH_REQUIRED` cannot be satisfied for a verified bug fix. Encountered
  while claiming this item; it is a blocker of this work, not part of it.
- `BI-D908DA0A` — local-CI pool pinned to one slot.
- `BI-980FE9F5` — unbounded autonomous blocker-descent.

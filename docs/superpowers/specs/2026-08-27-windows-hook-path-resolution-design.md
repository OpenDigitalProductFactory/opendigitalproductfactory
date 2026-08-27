---
status: active
---

# Windows hook path resolution — design

- **Backlog item:** BI-5CBDC146
- **Work capsule:** WC-CBF01552
- **Profile:** fix
- **Status:** active
- **Authored:** 2026-08-27

## Problem

`scripts/set-hooks-path.mjs` converges two generated git hooks — `pre-push`
(Git LFS + the DPF local-CI gate) and `post-checkout` (Git LFS + the
uncommitted-work guard) — by passing a directory to `ensurePrePushHook` and
`ensurePostCheckoutHook`. It computed that directory as:

```js
new URL('../.githooks/', import.meta.url).pathname
```

`URL.pathname` is not a filesystem path. On Windows it returns
`/D:/repo/.githooks/`, with a separator in front of the drive letter.
`path.join` then produces `\D:\repo\.githooks\pre-push`, which no `fs` call can
open.

The failure is fully silent:

1. `readFileSync` throws `ENOENT` and is caught by the helper's own
   `catch { /* missing */ }`, so the shim classifies as `missing`.
2. `writeFileSync` then throws on the same bad path.
3. That throw lands in a bare `catch {}` in `set-hooks-path.mjs`, whose comment
   assumes the only reachable cause is a non-git context.

Nothing is printed and `postinstall` exits 0. `.githooks/pre-push` stays the
stock git-lfs shim, so **a clean `git push` on Windows means the DPF gate never
ran — not that it passed.** Every Windows contributor has been pushing
ungated, and `pregate:status` verdicts were never consulted at push time.

Verified on this host at `origin/main` 40a7e46afc: `.githooks/pre-push` in the
root clone is the stock git-lfs shim, and the corrupted join reproduces exactly:

```
pathname     : "/D:/DPF-source-root/.githooks/"
path.join    : "\\D:\\DPF-source-root\\.githooks\\pre-push"
fileURLToPath: "D:\\DPF-source-root\\.githooks\\"
```

### Why review and CI never caught it

`URL.pathname` and `fileURLToPath` return identical strings on POSIX. Linux CI
cannot reproduce the defect, so the guard that protects every push was itself
unprotected on the only platform where it broke. The same blind spot hid a
second defect in the adjacent test: `scripts/lib/ensure-pre-push-hook.test.mjs`
asserted `statSync(...).mode & 0o111`, but NTFS reports mode `0o666` regardless
of `chmodSync(0o755)`, so that test has never passed on a Windows clone either.

## Contract change

None. `ensurePrePushHook` and `ensurePostCheckoutHook` keep their existing
signature, convergence classification, and fail-safe posture. The caller is
corrected to pass a real path, and the swallow is made to report.

## Decision

Introduce `scripts/lib/hooks-dir.mjs` exporting `resolveHooksDir(moduleUrl,
relative)`, which resolves through `fileURLToPath` — the only correct
URL-to-path conversion — plus `looksLikeUrlPathname(value)`, which recognises
the `/D:/…` shape so the regression can be asserted directly.

Considered and rejected:

- **Inline `fileURLToPath` at both call sites.** Correct but untestable: the
  defect is a single property access with no seam, and nothing would stop it
  being reintroduced.
- **Resolve from `process.cwd()`.** `postinstall` runs with an unreliable cwd
  in pnpm workspaces and Docker builds; module-relative resolution is the
  property we actually want.
- **Assert the exec bit on Windows via `icacls`.** Git for Windows invokes
  hooks through `sh` and never consults the POSIX bit, so the assertion would
  test the shell, not the contract.

Fail-safe behaviour is preserved deliberately: a non-git context (Docker build,
tarball install, CI extract) must not break the install. The change is that
those catches now warn instead of staying silent, because silence is precisely
what hid this defect for the life of the script.

## Scope

- `scripts/lib/hooks-dir.mjs` — new; `resolveHooksDir`, `looksLikeUrlPathname`.
- `scripts/set-hooks-path.mjs` — resolve both hook dirs through the helper;
  replace the two bare catches with warning catches.
- `scripts/lib/hooks-dir.test.mjs` — new regression guards.
- `scripts/lib/ensure-pre-push-hook.test.mjs` — platform-aware executability
  assertion; the POSIX assertion is unchanged.
- `scripts/lib/ci-policy-guards.mjs` — register the new test file. The
  inventory is hand-enumerated, so an unregistered test silently never runs.

## Verification

- `node --test` over the three hook test files: 10/10 pass on Windows.
- Functional: running `node scripts/set-hooks-path.mjs` in a fresh worktree now
  reports `converged .githooks/pre-push (was: lfs-stock)` and
  `converged .githooks/post-checkout (was: lfs-stock)`, and the resulting shim
  delegates to `.githooks/lib/pre-push-chained.sh`. Before the change the same
  command printed nothing and changed nothing.

## Risk

Low. No contract change, no gate weakened, no fail-open introduced. The
blast radius is `postinstall` hook convergence; the worst case on a
regression is the pre-change behaviour, which is what ships today.

The one behavioural change beyond the fix is that a genuinely non-git context
now prints two warnings during `postinstall`. That is intended: an install
that cannot converge its hooks should say so.

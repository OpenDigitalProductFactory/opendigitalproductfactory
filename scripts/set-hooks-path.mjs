import { execSync } from 'node:child_process';

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Not a git repo (Docker build, tarball install, CI extract) — silently ignore.
  // The pre-commit typecheck gate only matters in developer clones.
}

// Converge the gitignored pre-push shim to the tracked chained hook
// (Git LFS + local-CI gate — BI-C74F4DE9). Fail-safe: never break install.
try {
  const { ensurePrePushHook } = await import('./lib/ensure-pre-push-hook.mjs');
  const result = ensurePrePushHook(new URL('../.githooks/', import.meta.url).pathname);
  if (result.action === 'written') {
    console.log(`[set-hooks-path] converged .githooks/pre-push (was: ${result.was}) → LFS + local-CI gate chain`);
  } else if (result.action === 'left-custom') {
    console.warn('[set-hooks-path] .githooks/pre-push is a custom hook — left untouched; chain .githooks/lib/pre-push-chained.sh manually to keep the local-CI gate.');
  }
} catch {
  // Same non-git / read-only contexts as above.
}

try {
  const { ensurePostCheckoutHook } = await import('./lib/ensure-post-checkout-hook.mjs');
  const result = ensurePostCheckoutHook(new URL('../.githooks/', import.meta.url).pathname);
  if (result.action === 'written') {
    console.log(`[set-hooks-path] converged .githooks/post-checkout (was: ${result.was}) → LFS + uncommitted-work guard chain`);
  } else if (result.action === 'left-custom') {
    console.warn('[set-hooks-path] .githooks/post-checkout is a custom hook — left untouched; chain .githooks/lib/post-checkout-chained.sh manually to keep the durable-artifact guard.');
  }
} catch {
  // Same non-git / read-only contexts as above.
}

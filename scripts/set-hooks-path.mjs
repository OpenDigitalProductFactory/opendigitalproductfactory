import { execSync } from 'node:child_process';

import { resolveHooksDir } from './lib/hooks-dir.mjs';

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Not a git repo (Docker build, tarball install, CI extract) — silently ignore.
  // The pre-commit typecheck gate only matters in developer clones.
}

// Both convergences resolve through fileURLToPath (BI-5CBDC146). Reading
// `.pathname` off the module URL produced "/D:/repo/.githooks/" on Windows,
// which path.join turned into an unopenable "\D:\repo\.githooks\" — so every
// hook write threw ENOENT into the bare catch below and the gate never
// installed. A clean push then meant the gate never ran, not that it passed.
const hooksDir = resolveHooksDir(import.meta.url);

// Converge the gitignored pre-push shim to the tracked chained hook
// (Git LFS + local-CI gate — BI-C74F4DE9). Fail-safe: never break install.
try {
  const { ensurePrePushHook } = await import('./lib/ensure-pre-push-hook.mjs');
  const result = ensurePrePushHook(hooksDir);
  if (result.action === 'written') {
    console.log(`[set-hooks-path] converged .githooks/pre-push (was: ${result.was}) → LFS + local-CI gate chain`);
  } else if (result.action === 'left-custom') {
    console.warn('[set-hooks-path] .githooks/pre-push is a custom hook — left untouched; chain .githooks/lib/pre-push-chained.sh manually to keep the local-CI gate.');
  }
} catch (error) {
  // Same non-git / read-only contexts as above: never break the install. But
  // say so — silence here is what hid BI-5CBDC146 for the life of the script.
  console.warn(`[set-hooks-path] could not converge .githooks/pre-push — the local-CI gate will not run on push: ${error?.message ?? error}`);
}

try {
  const { ensurePostCheckoutHook } = await import('./lib/ensure-post-checkout-hook.mjs');
  const result = ensurePostCheckoutHook(hooksDir);
  if (result.action === 'written') {
    console.log(`[set-hooks-path] converged .githooks/post-checkout (was: ${result.was}) → LFS + uncommitted-work guard chain`);
  } else if (result.action === 'left-custom') {
    console.warn('[set-hooks-path] .githooks/post-checkout is a custom hook — left untouched; chain .githooks/lib/post-checkout-chained.sh manually to keep the durable-artifact guard.');
  }
} catch (error) {
  console.warn(`[set-hooks-path] could not converge .githooks/post-checkout — the uncommitted-work guard will not run on checkout: ${error?.message ?? error}`);
}

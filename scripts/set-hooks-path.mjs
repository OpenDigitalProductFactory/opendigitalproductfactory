// Root postinstall: point git at the tracked hooks and converge the generated shims.
//
// ZERO STATIC LOCAL IMPORTS — THIS IS LOAD-BEARING (BI-9B490215).
//   The Docker `deps` stage copies exactly one file out of scripts/:
//     Dockerfile: COPY scripts/set-hooks-path.mjs ./scripts/
//   and then runs `pnpm install --frozen-lockfile`, which runs this as
//   postinstall. A static `import './lib/x.mjs'` is resolved at MODULE LOAD,
//   before any try/catch can run, so it throws ERR_MODULE_NOT_FOUND, fails
//   postinstall, and breaks the image build — and therefore the release and
//   self-upgrade chain for every install.
//
//   Adding another COPY line per dependency treats the symptom and leaves the
//   next helper to break the build again. Instead every local import here is
//   DYNAMIC and guarded, so this file is self-sufficient by construction:
//   where its helpers are absent it degrades to a warning, which is the right
//   behaviour anyway — installing developer git hooks is meaningless inside an
//   image build. `scripts/set-hooks-path.no-static-imports.test.mjs` enforces it.

import { execSync } from 'node:child_process';

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Not a git repo (Docker build, tarball install, CI extract) — silently ignore.
  // The pre-commit typecheck gate only matters in developer clones.
}

try {
  // Both convergences resolve through fileURLToPath (BI-5CBDC146). Reading
  // `.pathname` off the module URL produced "/D:/repo/.githooks/" on Windows,
  // which path.join turned into an unopenable "\D:\repo\.githooks\" — so every
  // hook write threw ENOENT into a bare catch and the gate never installed.
  // A clean push then meant the gate never ran, not that it passed.
  const { resolveHooksDir } = await import('./lib/hooks-dir.mjs');
  const { convergeHooksDir, summarizeConvergence } = await import('./lib/converge-hooks-dir.mjs');

  const result = convergeHooksDir(resolveHooksDir(import.meta.url));

  if (result.prePush === 'written' || result.postCheckout === 'written') {
    console.log(`[set-hooks-path] ${summarizeConvergence([result])} → LFS + local-CI gate chain`);
  } else if (result.prePush === 'left-custom') {
    console.warn('[set-hooks-path] .githooks/pre-push is a custom hook — left untouched; chain .githooks/lib/pre-push-chained.sh manually to keep the local-CI gate.');
  } else if (result.prePush === 'chain-absent') {
    console.warn('[set-hooks-path] .githooks/lib/pre-push-chained.sh is absent — refusing to write a shim that would break every push. Refresh this tree from origin/main.');
  }
  if (result.error) {
    console.warn(`[set-hooks-path] hook convergence reported an error — the local-CI gate may not run on push: ${result.error}`);
  }
} catch (error) {
  // Non-git / image-build / read-only contexts: never break the install. But
  // SAY SO — silence here is what hid BI-5CBDC146 for the life of the script.
  console.warn(`[set-hooks-path] could not converge git hooks — the local-CI gate will not run on push here: ${error?.message ?? error}`);
}

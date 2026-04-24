import { execSync } from 'node:child_process';

try {
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
} catch {
  // Not a git repo (Docker build, tarball install, CI extract) — silently ignore.
  // The pre-commit typecheck gate only matters in developer clones.
}

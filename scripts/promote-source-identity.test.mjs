import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { guardShellEnv, resolveGuardBash } from "./lib/guard-bash.mjs";

// The source-preparation portal and the promoter see the same materialized LFS
// bytes through different mounts. A changed stat forces Git to inspect them;
// plain Git then compares the workbook with its committed pointer (BI-F223F4F6).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A baseline ref allows first-failing proof after a peer has already repaired
// these inputs, without reverting files in the shared worktree.
const baselineRef = process.env.DPF_PROMOTE_IDENTITY_BASELINE_REF;
function sourceInput(path) {
  return baselineRef
    ? execFileSync("git", ["show", `${baselineRef}:${path}`], { cwd: repoRoot, encoding: "utf8" })
    : readFileSync(join(repoRoot, path), "utf8");
}
const promoter = sourceInput("scripts/promote.sh");
const dockerfile = sourceInput("Dockerfile.promoter");
const bash = resolveGuardBash();
const bashPath = (path) => process.platform === "win32"
  ? resolve(path).replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : resolve(path);
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === "path") ?? "PATH";
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const lfsAvailable = spawnSync("git", ["lfs", "version"], { encoding: "utf8" }).status === 0;
const bashAvailable = spawnSync(bash, ["--version"], { encoding: "utf8" }).status === 0;
const sourceTestOptions = { timeout: 30_000 };

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function sourceIdentityBlock(script = promoter) {
  // Execute the actual source-only branch up to the image build. This boundary
  // needs no daemon, install state, DB, migration envelope or production mount.
  const build = script.slice(script.indexOf("# --- Step 3: docker-build ---"));
  const start = build.indexOf("\n  else\n");
  const end = build.indexOf("  # The promoter carries", start);
  assert.ok(start >= 0 && end > start, "the real source identity guard must be identifiable");
  const block = build.slice(start + "\n  else\n".length, end);
  assert.match(block, /PROMOTE_SOURCE/);
  assert.match(block, /PROMOTE_TARGET_SHA/);
  return block;
}

function withLfsFixture(run) {
  assert.ok(gitAvailable, "source identity regression requires Git; the gate must not skip it");
  assert.ok(lfsAvailable, "source identity regression requires Git LFS; the gate must not skip it");
  assert.ok(bashAvailable, "source identity regression requires Bash; the gate must not skip it");
  const root = mkdtempSync(join(tmpdir(), "dpf-promote-source-identity-"));
  const source = join(root, "source");
  const systemConfig = join(root, "gitconfig-system");
  const globalConfig = join(root, "gitconfig-global");
  // Do not inherit the operator's filters, repository overrides or signing.
  const env = guardShellEnv(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_SYSTEM: systemConfig,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "DPF regression fixture",
    GIT_COMMITTER_NAME: "DPF regression fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
  writeFileSync(systemConfig, "");
  writeFileSync(globalConfig, "");
  const git = (args, overrides = {}) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", source, ...args], {
    env: { ...env, ...overrides }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000,
  }).trim();
  try {
    execFileSync("git", ["init", "-b", "main", source], { env, stdio: "pipe", timeout: 20_000 });
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.eol", "lf"]);
    // A private system config models the immutable promoter image's filter
    // setup; no installation or test changes the operator's actual config.
    git(["lfs", "install", "--system", "--skip-repo"]);
    writeFileSync(join(source, ".gitattributes"), "*.xlsx filter=lfs diff=lfs merge=lfs -text\n");
    const asset = join(source, "workbook.xlsx");
    writeFileSync(asset, Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(8192, 42)]));
    git(["add", ".gitattributes", "workbook.xlsx"]);
    git(["-c", "commit.gpgsign=false", "commit", "-m", "LFS fixture"]);
    const head = git(["rev-parse", "HEAD"]);
    assert.match(git(["show", "HEAD:workbook.xlsx"]), /^version https:\/\/git-lfs.github.com\/spec\/v1\n/);
    const forceContentCheck = () => {
      const previous = statSync(asset);
      // Different mount stat data caused the production check to rehash. A
      // timestamp change makes that condition deterministic on local filesystems.
      utimesSync(asset, previous.atime, new Date(previous.mtimeMs + 2000));
    };
    forceContentCheck();
    return run({ root, source, asset, head, env, git, forceContentCheck });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runIdentityGuard(fixture, overrides = {}) {
  return spawnSync(bash, ["-eu", "-c", `${sourceIdentityBlock()}\nprintf 'identity-accepted=%s\\n' "$DPF_VERSION"`], {
    env: { ...fixture.env, PROMOTE_SOURCE: bashPath(fixture.source), PROMOTE_TARGET_SHA: fixture.head, ...overrides },
    encoding: "utf8", timeout: 20_000,
  });
}

function withReadOnlySourceLfs(fixture, run) {
  const sourceTmp = join(fixture.source, ".git", "lfs", "tmp");
  // POSIX permission removal models the production :ro mount for an ordinary
  // user. Windows chmod and root cannot enforce that denial, so occupy the
  // same required directory with a file to make source storage unwritable.
  const useBlockedPath = process.platform === "win32" || process.getuid?.() === 0;
  if (useBlockedPath) {
    rmSync(sourceTmp, { recursive: true, force: true });
    writeFileSync(sourceTmp, "source storage is unavailable\n");
  } else {
    chmodSync(sourceTmp, 0o555);
  }
  try {
    const baseline = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-C", fixture.source, "status", "--porcelain"], {
      env: fixture.env, encoding: "utf8", timeout: 20_000,
    });
    assert.notEqual(baseline.status, 0, "the fixture must deny LFS writes inside source before testing the guard");
    assert.match(baseline.stderr, /(?:permission denied|not a directory|cannot create|file exists)/i);
    return run();
  } finally {
    if (useBlockedPath) {
      rmSync(sourceTmp, { force: true });
      mkdirSync(sourceTmp);
    } else {
      chmodSync(sourceTmp, 0o755);
    }
  }
}

test("the promoter image supplies Git LFS and initializes its system filters", () => {
  const instructions = dockerfile.replace(/\\\r?\n/g, " ");
  assert.match(instructions, /^RUN\s+apk\s+add\b[^\n]*\bgit-lfs\b/m,
    "the identity-checking promoter needs the same LFS normalization as source preparation");
  assert.match(instructions, /^RUN\b[^\n]*\bgit\s+lfs\s+install\b(?=[^\n]*--system)(?=[^\n]*--skip-repo)/m,
    "filters belong in the image's system Git config, without modifying source hooks");
});

test("a real materialized LFS fixture reproduces the plain-Git false dirty result", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    const withoutFilters = { GIT_CONFIG_SYSTEM: fixture.env.GIT_CONFIG_GLOBAL };
    assert.match(fixture.git(["status", "--porcelain"], withoutFilters), /^M workbook\.xlsx$/);
    fixture.forceContentCheck();
    assert.equal(fixture.git(["status", "--porcelain"]), "");
  });
});

test("the real promotion guard accepts unchanged materialized LFS bytes after stat changes", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    const result = runIdentityGuard(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`identity-accepted=${fixture.head}\\n`));
  });
});

test("the real promotion guard normalizes clean bytes without writable source LFS storage", sourceTestOptions, () => {
  withLfsFixture(fixture => withReadOnlySourceLfs(fixture, () => {
    const result = runIdentityGuard(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`identity-accepted=${fixture.head}\\n`));
  }));
});

test("the real promotion guard still rejects changed bytes without writable source LFS storage", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    const changed = readFileSync(fixture.asset);
    changed[100] ^= 1;
    writeFileSync(fixture.asset, changed);
    fixture.forceContentCheck();
    withReadOnlySourceLfs(fixture, () => {
      const result = runIdentityGuard(fixture);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /build source identity .*dirty.* does not match promote target/);
      assert.doesNotMatch(result.stdout, /identity-accepted=/);
    });
  });
});

test("the real promotion guard refuses genuinely changed LFS bytes before building", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    writeFileSync(fixture.asset, Buffer.concat([readFileSync(fixture.asset), Buffer.from("changed content")]));
    fixture.forceContentCheck();
    const result = runIdentityGuard(fixture);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /build source identity .*dirty.* does not match promote target/);
    assert.doesNotMatch(result.stdout, /identity-accepted=/);
  });
});

test("the real promotion guard refuses a failed required LFS filter", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    fixture.git(["config", "--system", "filter.lfs.process", "dpf-regression-missing-lfs-filter"]);
    const result = runIdentityGuard(fixture);
    assert.notEqual(result.status, 0, "a failed LFS filter must never become a clean source identity");
    assert.doesNotMatch(result.stdout, /identity-accepted=/);
  });
});

test("the real promotion guard refuses Git status errors instead of treating empty output as clean", sourceTestOptions, () => {
  withLfsFixture(fixture => {
    const realGit = execFileSync(bash, ["-c", "command -v git"], { env: fixture.env, encoding: "utf8" }).trim();
    const shim = join(fixture.root, "git");
    writeFileSync(shim, `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = status ]; then printf 'fixture status failure\\n' >&2; exit 23; fi\ndone\nexec ${shellQuote(realGit)} "$@"\n`);
    chmodSync(shim, 0o755);
    const result = runIdentityGuard(fixture, { [pathKey]: `${fixture.root}${delimiter}${fixture.env[pathKey]}` });
    assert.notEqual(result.status, 0, "Git verification errors must block image construction");
    assert.match(result.stderr, /fixture status failure/);
    assert.match(result.stderr, /cannot verify build source status/);
    assert.doesNotMatch(result.stdout, /identity-accepted=/);
  });
});

const artifactImage = process.env.DPF_PROMOTE_IDENTITY_TEST_IMAGE;
test("the built promoter verifies its own filters against a read-only source mount", {
  timeout: 120_000,
  skip: artifactImage ? false : "requires the promoter artifact built by the CI acceptance job",
}, () => {
  // This optional artifact acceptance runs only in the governed CI job. It has
  // no network or daemon socket inside the container and receives no fixture
  // Git configs: the LFS executable and system filters must come from the image.
  // ambient-host-guard: allow explicitly gated CI artifact test; reads only the supplied built image, without network or live-service mounts.
  const bakedScript = execFileSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "cat", artifactImage, "/promoter/promote.sh"], {
    encoding: "utf8", timeout: 30_000,
  });
  const bakedBlock = sourceIdentityBlock(bakedScript);
  assert.equal(bakedBlock, sourceIdentityBlock(), "the built artifact must carry the exact tested source identity guard");
  withLfsFixture(fixture => {
    for (const changed of [false, true]) {
      if (changed) {
        const bytes = readFileSync(fixture.asset);
        bytes[100] ^= 1;
        writeFileSync(fixture.asset, bytes);
        fixture.forceContentCheck();
      }
      // ambient-host-guard: allow explicitly gated CI artifact test; disposable read-only container, owned fixture, no daemon socket or live services.
      const result = spawnSync("docker", [
        "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev",
        "--memory", "256m", "--cpus", "1", "--mount", `type=bind,source=${fixture.source},target=/host-source,readonly`,
        "--entrypoint", "bash", "-e", "PROMOTE_SOURCE=/host-source", "-e", `PROMOTE_TARGET_SHA=${fixture.head}`,
        "-e", "GIT_OPTIONAL_LOCKS=0", "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=/host-source",
        artifactImage, "-eu", "-c", `${bakedBlock}\nprintf 'identity-accepted=%s\\n' "$DPF_VERSION"`,
      ], { encoding: "utf8", timeout: 30_000 });
      if (changed) {
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /build source identity .*dirty.* does not match promote target/);
        assert.doesNotMatch(result.stdout, /identity-accepted=/);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`identity-accepted=${fixture.head}\\n`));
      }
    }
  });
});

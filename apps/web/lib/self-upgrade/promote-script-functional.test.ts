import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// High-fidelity functional proof of scripts/promote.sh: run the REAL script
// through all six steps against a REAL git repo, faking only the external
// boundaries — `docker` (the image build is orthogonal to the stamp logic) and
// `curl` (the portal's /api/health/sha). The fake portal "reports" whatever
// DPF_VERSION the build stamped, by echoing $DPF_VERSION — which is exactly how
// the real round-trip works (DPF_VERSION build-arg → /app/.dpf-image-version →
// /api/health/sha). So a passing sha-verify here means the same thing it means
// in production: the running runtime reports the SHA of the code that was built.

const SCRIPT = resolve(__dirname, "../../../../scripts/promote.sh");
const BASH_OK = spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0;
const GIT_OK = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
const PROMOTE_TEST_TIMEOUT_MS = 30_000;

let bashDrivePrefix: string | undefined;

function toBashPath(value: string): string {
  if (process.platform !== "win32") return value;
  const normalized = value.replace(/\\/g, "/");
  const drivePath = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drivePath) return normalized;

  const drive = drivePath[1].toLowerCase();
  const rest = drivePath[2];
  if (bashDrivePrefix === undefined) {
    const cwdDrive = /^([A-Za-z]):/.exec(process.cwd())?.[1]?.toLowerCase();
    const pwd = spawnSync("bash", ["-lc", "pwd"], { encoding: "utf8" }).stdout.trim();
    bashDrivePrefix = cwdDrive && pwd.startsWith(`/mnt/${cwdDrive}/`) ? "/mnt" : "";
  }
  return `${bashDrivePrefix}/${drive}/${rest}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function gitInit(dir: string): string {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  execFileSync("git", ["init", "-b", "main", dir], { env });
  execFileSync("git", ["-C", dir, "config", "core.autocrlf", "false"], { env });
  execFileSync("git", ["-C", dir, "config", "core.eol", "lf"], { env });
  writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
  writeFileSync(join(dir, "docker-compose.macos.yml"), "services: {}\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env });
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-m", "seed"], { env });
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { env }).toString().trim();
}

/** Fake `docker` and `curl` on PATH. */
function makeFakeBin(root: string): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  // docker: `build`/`up` are no-ops; any `cat /app/.dpf-source-content-hash`
  // (the content-verify guard — step 3 `docker run` and step 7
  // `docker compose exec`) returns a single stable hash so built==running.
  writeFileSync(
    join(bin, "docker"),
    '#!/bin/sh\n[ -n "$DOCKER_LOG" ] && printf "%s\\n" "$*" >> "$DOCKER_LOG"\ncase "$*" in\n  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;\nesac\nexit 0\n',
  );
  // For any URL ending in /sha, report the stamped DPF_VERSION (inherited from
  // the script's exported env) — modelling a correctly-stamped portal. Other
  // health probes just succeed.
  writeFileSync(
    join(bin, "curl"),
    '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "%s" "$DPF_VERSION" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
  );
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  return bin;
}

function runPromote(opts: {
  source: string;
  backup: string;
  targetSha: string;
  fakeBin: string;
  composeEnvFile?: string;
  dockerLog?: string;
}): { status: number | null; stdout: string; stderr: string } {
  const exports = [
    `export PATH=${shellQuote(toBashPath(opts.fakeBin))}:"$PATH"`,
    `export PROMOTE_SOURCE=${shellQuote(toBashPath(opts.source))}`,
    `export PROMOTE_TARGET_SHA=${shellQuote(opts.targetSha)}`,
    `export PROMOTE_BACKUP_PATH=${shellQuote(toBashPath(opts.backup))}`,
    "export PROMOTE_HEALTH_URL='http://127.0.0.1:9/api/health'",
    "export PROMOTE_COMPOSE_PROJECT='dpf-functest'",
    ...(opts.composeEnvFile
      ? [`export PROMOTE_COMPOSE_ENV_FILE=${shellQuote(toBashPath(opts.composeEnvFile))}`]
      : []),
    ...(opts.dockerLog ? [`export DOCKER_LOG=${shellQuote(toBashPath(opts.dockerLog))}`] : []),
  ];
  const r = spawnSync("bash", ["-lc", `${exports.join("\n")}\nexec bash ${shellQuote(toBashPath(SCRIPT))} --self-upgrade`], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Scratch root with a clean git source dir (src/) + isolated bin/ and backup/. */
function makeScratch(): { root: string; source: string; backup: string; fakeBin: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "dpf-promote-"));
  const source = join(root, "src");
  mkdirSync(source, { recursive: true });
  const head = gitInit(source);
  const fakeBin = makeFakeBin(root);
  return { root, source, backup: join(root, "backup"), fakeBin, head };
}

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh — real-script functional run", () => {
  it("stamps the source HEAD and sha-verify passes against a correctly-stamped portal", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator passes the intended target; it equals HEAD here, so the
      // pre-swap identity assertion (stamp == built HEAD == target) holds and
      // the run completes cleanly through sha-verify + content-verify.
      const r = runPromote({ source, backup, targetSha: head, fakeBin });
      expect(r.status).toBe(0);
      // sha-verify completed against the SHA actually built (HEAD).
      expect(r.stdout).toContain(`step=done target=${head}`);
      expect(r.stderr).not.toContain("does not match promote target");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("sweeps dangling images and build cache after a successful promote", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    const dockerLog = join(root, "docker.log");
    try {
      const r = runPromote({ source, backup, targetSha: head, fakeBin, dockerLog });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("step=cleanup");
      const dockerCalls = readFileSync(dockerLog, "utf8");
      // Best-effort disk reclaim on the success path — dangling images + build cache.
      expect(dockerCalls).toContain("image prune -f");
      expect(dockerCalls).toContain("builder prune -f");
      // Conservative scope: never the destructive `-a` (would delete in-use tagged images).
      expect(dockerCalls).not.toContain("image prune -a");
      // Volumes are operator state — cleanup must never touch them.
      expect(dockerCalls).not.toContain("volume");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("derives a -dirty stamp when the build source has uncommitted changes", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      writeFileSync(join(source, "Dockerfile"), "FROM scratch\n# changed\n"); // dirty a tracked file
      const r = runPromote({ source, backup, targetSha: `${head}-dirty`, fakeBin });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`step=done target=${head}-dirty`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD (does not deploy) when the build tree identity differs from the promote target", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator's intended target ≠ what's on disk → the bytes about to be
      // deployed are not the bytes that were resolved. Spec §4.3 / BI-5B6C1C35:
      // stamp == built HEAD == target must hold pre-swap; a divergence is a hard
      // failure, NOT a warning that lets a mislabeled image ship.
      const r = runPromote({ source, backup, targetSha: "0000000000000000000000000000000000000000", fakeBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("does not match promote target");
      // It never reached the swap/verify steps — no image was recreated.
      expect(r.stdout).not.toContain(`step=done`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD when a -dirty build tree cannot equal the clean target SHA", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Uncommitted bytes in the build tree → stamp becomes `${head}-dirty`,
      // which can never equal the clean target `head`. Promoting uncommitted
      // bytes is never intended, so the script must refuse before building.
      writeFileSync(join(source, "Dockerfile"), "FROM scratch\n# uncommitted\n");
      const r = runPromote({ source, backup, targetSha: head, fakeBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("does not match promote target");
      expect(r.stdout).not.toContain("step=done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("FAILS LOUD when the running portal reports an EMPTY /sha (DEPLOYED_SHA unpopulated)", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Model the BI-5B6C1C35 symptom: DEPLOYED_SHA never made it into the
      // running container, so /sha returns blank. The verify step must treat an
      // empty stamp as a hard failure (the runtime cannot prove its identity),
      // not retry-until-timeout then pass.
      const emptyShaBin = join(root, "bin-emptysha");
      mkdirSync(emptyShaBin, { recursive: true });
      writeFileSync(
        join(emptyShaBin, "docker"),
        '#!/bin/sh\ncase "$*" in\n  *"/app/.dpf-source-content-hash"*) printf "deadbeefhash" ;;\nesac\nexit 0\n',
      );
      // /sha → empty (the bug); other probes → ok.
      writeFileSync(
        join(emptyShaBin, "curl"),
        '#!/bin/sh\nfor a in "$@"; do url="$a"; done\ncase "$url" in\n  */sha) printf "" ;;\n  *) printf "ok" ;;\nesac\nexit 0\n',
      );
      chmodSync(join(emptyShaBin, "docker"), 0o755);
      chmodSync(join(emptyShaBin, "curl"), 0o755);

      const r = runPromote({ source, backup, targetSha: head, fakeBin: emptyShaBin });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("EMPTY deployed SHA");
      expect(r.stdout).not.toContain("step=done");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);

  it("passes the canonical install env file to docker compose when configured", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const envFile = join(root, "install.env");
      const dockerLog = join(root, "docker.log");
      writeFileSync(envFile, "AUTH_SECRET=test-secret\n");

      const r = runPromote({ source, backup, targetSha: head, fakeBin, composeEnvFile: envFile, dockerLog });

      expect(r.status).toBe(0);
      const log = readFileSync(dockerLog, "utf8");
      expect(log).toContain(
        `compose --env-file ${toBashPath(envFile)} --project-directory ${toBashPath(source)}`,
      );
      expect(log).toContain("build portal");
      // BI-D9BAB4FA: migrations run from the freshly-built image, before the swap.
      expect(log).toContain("run --rm -T --no-deps --entrypoint sh portal -c cd /app && pnpm --filter @dpf/db exec prisma migrate deploy");
      expect(log).toContain("up -d --no-deps --force-recreate portal");
      // BI-86FC0336: seed runs the full entrypoint from the freshly swapped image, after the swap.
      expect(log).toContain("run --rm -T --no-deps --entrypoint /docker-entrypoint.sh portal");
      expect(log).toContain("exec -T portal cat /app/.dpf-source-content-hash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, PROMOTE_TEST_TIMEOUT_MS);
});

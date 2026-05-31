import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from "node:fs";
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
  execFileSync("mkdir", ["-p", bin]);
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
  const r = spawnSync("bash", [SCRIPT, "--self-upgrade"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${opts.fakeBin}:${process.env.PATH}`,
      PROMOTE_SOURCE: opts.source,
      PROMOTE_TARGET_SHA: opts.targetSha,
      // Backup path is OUTSIDE the source tree (as in production: /backups/...),
      // so it never dirties the build source.
      PROMOTE_BACKUP_PATH: opts.backup,
      PROMOTE_HEALTH_URL: "http://127.0.0.1:9/api/health",
      PROMOTE_COMPOSE_PROJECT: "dpf-functest",
      ...(opts.composeEnvFile ? { PROMOTE_COMPOSE_ENV_FILE: opts.composeEnvFile } : {}),
      ...(opts.dockerLog ? { DOCKER_LOG: opts.dockerLog } : {}),
    },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Scratch root with a clean git source dir (src/) + isolated bin/ and backup/. */
function makeScratch(): { root: string; source: string; backup: string; fakeBin: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "dpf-promote-"));
  const source = join(root, "src");
  execFileSync("mkdir", ["-p", source]);
  const head = gitInit(source);
  const fakeBin = makeFakeBin(root);
  return { root, source, backup: join(root, "backup"), fakeBin, head };
}

describe.skipIf(!BASH_OK || !GIT_OK)("promote.sh — real-script functional run", () => {
  it("stamps the source HEAD and sha-verify passes against a correctly-stamped portal", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator passes the prepared stamp as the expected identity; it
      // equals HEAD here, so no warning and a clean verify.
      const r = runPromote({ source, backup, targetSha: head, fakeBin });
      expect(r.status).toBe(0);
      // sha-verify completed against the SHA actually built (HEAD).
      expect(r.stdout).toContain(`step=done target=${head}`);
      expect(r.stderr).not.toContain("warning: build source identity");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
  });

  it("warns (does not silently mislabel) when the tree identity differs from the expected stamp", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      // Orchestrator expected a different SHA than what's on disk → drift.
      const r = runPromote({ source, backup, targetSha: "0000000000000000000000000000000000000000", fakeBin });
      expect(r.status).toBe(0);
      // It still stamps the TRUTH (HEAD), and flags the drift.
      expect(r.stdout).toContain(`step=done target=${head}`);
      expect(r.stderr).toContain("warning: build source identity");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes the canonical install env file to docker compose when configured", () => {
    const { root, source, backup, fakeBin, head } = makeScratch();
    try {
      const envFile = join(root, "install.env");
      const dockerLog = join(root, "docker.log");
      writeFileSync(envFile, "AUTH_SECRET=test-secret\n");

      const r = runPromote({ source, backup, targetSha: head, fakeBin, composeEnvFile: envFile, dockerLog });

      expect(r.status).toBe(0);
      const log = readFileSync(dockerLog, "utf8");
      expect(log).toContain(`compose --env-file ${envFile} --project-directory ${source}`);
      expect(log).toContain("build portal");
      expect(log).toContain("up -d --no-deps --force-recreate portal");
      expect(log).toContain("exec -T portal cat /app/.dpf-source-content-hash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

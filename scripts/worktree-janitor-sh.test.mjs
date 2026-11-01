import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// BI-2EF2E6D3 — the bash janitor died with exit 141 and no output once the clone
// held ~500 worktrees: `git worktree list | awk '{...; exit}'` closed the pipe
// early, git took SIGPIPE, and pipefail + set -e killed the run. The lease check
// had the same shape (`printf | grep -q`), where a SIGPIPE turned a FOUND lease
// into "no lease". Both are exercised with output larger than a pipe buffer.

const script = join(dirname(fileURLToPath(import.meta.url)), "worktree-janitor.sh");

function makeStubs({ root, leased }) {
  const bin = mkdtempSync(join(tmpdir(), "janitor-stub-"));
  // Porcelain list: root, one feature worktree, then ~200 KB of HEAD lines so
  // git is still writing after awk has seen the first worktree.
  const padding = Array.from({ length: 4000 }, () => `HEAD ${"a".repeat(40)}`).join("\n");
  const listing = `worktree ${root}\nHEAD ${"b".repeat(40)}\n\nworktree ${leased}\nbranch refs/heads/feat/leased\n${padding}\n`;
  const listingFile = join(bin, "listing.txt");
  writeFileSync(listingFile, listing);
  writeFileSync(
    join(bin, "git"),
    `#!/usr/bin/env bash
case " $* " in
  *" worktree list "*) cat "${listingFile}" ;;
  *" branch --show-current "*) echo feat/leased ;;
  *) exit 0 ;;
esac
`,
  );
  // Lease response larger than a pipe buffer with the match near the start.
  const leaseFile = join(bin, "lease.json");
  writeFileSync(leaseFile, `{"worktreePath":"${leased}"}` + "x".repeat(200_000));
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\ncat "${leaseFile}"\n`);
  writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 1\n");
  for (const f of ["git", "curl", "gh"]) chmodSync(join(bin, f), 0o755);
  return bin;
}

describe("worktree-janitor.sh with large outputs (BI-2EF2E6D3)", () => {
  it("survives a worktree list larger than the pipe buffer and keeps a leased worktree", () => {
    const work = mkdtempSync(join(tmpdir(), "janitor-wt-"));
    const root = join(work, "root clone");
    const leased = join(work, "leased wt");
    mkdirSync(root);
    mkdirSync(leased);
    const bin = makeStubs({ root, leased });
    try {
      const res = spawnSync("bash", [script, "--dry-run"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DPF_MCP_BEARER_TOKEN: "test-token" },
      });
      assert.equal(res.status, 0, `janitor exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      assert.match(res.stdout, /Summary:/);
      assert.match(res.stdout, /active NonProductionEnvironmentLease/, "leased worktree must be KEEP");
      assert.doesNotMatch(res.stdout, /PRUNE.*leased wt/);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

// BI-EBBBDF40 — the stale-prune path ran `branch -D` unconditionally, so a stale,
// clean, unmerged branch whose commits were on no remote survived only in the
// reflog. Before deleting, the janitor must write refs/janitor-backup/<date>/<b>
// for any branch with unpushed commits, and KEEP the worktree if it cannot.
function makeStaleStubs({ root, worktrees }) {
  const bin = mkdtempSync(join(tmpdir(), "janitor-stale-stub-"));
  const log = join(bin, "git-calls.log");
  const listing =
    `worktree ${root}\nHEAD ${"b".repeat(40)}\n\n` +
    worktrees.map((w) => `worktree ${w.path}\nHEAD ${w.sha}\nbranch refs/heads/${w.branch}\n`).join("\n");
  const listingFile = join(bin, "listing.txt");
  writeFileSync(listingFile, listing);
  const byPath = worktrees.map((w) => `    "${w.path}") echo ${w.branch} ;;`).join("\n");
  const byRef = worktrees
    .map((w) => `    *"refs/heads/${w.branch} "*) echo ${w.unpushed} ;;`)
    .join("\n");
  const shaByRef = worktrees.map((w) => `    *"refs/heads/${w.branch} "*) echo ${w.sha} ;;`).join("\n");
  const failRef = worktrees.find((w) => w.backupFails)?.branch ?? "__none__";
  writeFileSync(
    join(bin, "git"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${log}"
case " $* " in
  *" worktree list "*) cat "${listingFile}" ;;
  *" branch --show-current "*)
    case "$2" in
${byPath}
    esac ;;
  *" merge-base "*) exit 1 ;;
  *" status --porcelain "*) ;;
  *" log -1 "*) echo 1000000000 ;;
  *" rev-list --count "*)
    case " $* " in
${byRef}
    esac ;;
  *" rev-parse "*)
    case " $* " in
${shaByRef}
    esac ;;
  *" update-ref refs/janitor-backup/"*"/${failRef} "*) exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  writeFileSync(join(bin, "gh"), "#!/usr/bin/env bash\nexit 1\n");
  for (const f of ["git", "gh"]) chmodSync(join(bin, f), 0o755);
  // The janitor removes through $root/scripts/lib/junction-safe-worktree-remove.mjs.
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  writeFileSync(join(root, "scripts", "lib", "junction-safe-worktree-remove.mjs"), "process.exit(0);\n");
  return { bin, log };
}

describe("worktree-janitor.sh backs up unpushed work before deleting a stale branch (BI-EBBBDF40)", () => {
  it("writes a backup ref for an unpushed branch, none for a pushed one, and keeps a worktree it cannot back up", () => {
    const work = mkdtempSync(join(tmpdir(), "janitor-stale-wt-"));
    const root = join(work, "root");
    const worktrees = [
      { path: join(work, "unpushed"), branch: "feat/unpushed", sha: "1".repeat(40), unpushed: 2 },
      { path: join(work, "pushed"), branch: "feat/pushed", sha: "2".repeat(40), unpushed: 0 },
      { path: join(work, "nobackup"), branch: "feat/nobackup", sha: "3".repeat(40), unpushed: 1, backupFails: true },
    ];
    for (const d of [root, ...worktrees.map((w) => w.path)]) mkdirSync(d, { recursive: true });
    const { bin, log } = makeStaleStubs({ root, worktrees });
    try {
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      delete env.DPF_MCP_BEARER_TOKEN;
      const res = spawnSync("bash", [script, "--live"], { encoding: "utf8", env });
      const out = `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
      assert.equal(res.status, 0, `janitor exited ${res.status}\n${out}`);
      const calls = readFileSync(log, "utf8").split("\n");
      const updates = calls.filter((c) => c.includes("update-ref"));
      const deletes = calls.filter((c) => c.includes("branch -D"));

      assert.ok(
        updates.some((c) => /update-ref refs\/janitor-backup\/\d{4}-\d{2}-\d{2}\/feat\/unpushed 1{40}/.test(c)),
        `unpushed branch must get a backup ref at its tip\n${updates.join("\n")}\n${out}`,
      );
      assert.ok(!updates.some((c) => c.includes("feat/pushed")), "a pushed branch needs no backup ref");
      assert.ok(deletes.some((c) => c.endsWith("branch -D feat/unpushed")), "backed-up branch is then deleted");
      assert.ok(deletes.some((c) => c.endsWith("branch -D feat/pushed")), "pushed branch is deleted");
      assert.match(res.stdout + res.stderr, /backup.*feat\/unpushed/i, "the backup is logged");

      assert.ok(!deletes.some((c) => c.includes("feat/nobackup")), "a branch that could not be backed up is not deleted");
      assert.match(res.stdout, /KEEP\s+\S*nobackup/, `worktree that could not be backed up must be KEEP\n${out}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

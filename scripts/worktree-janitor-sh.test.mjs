import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

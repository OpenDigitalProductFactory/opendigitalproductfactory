// apps/web/lib/self-upgrade/impact/change-set.ts
//
// Collect the upstream change set as RawCommit[] from `git log <a>..<b>` over
// the host clone — mirrors the no-auth read pattern used by
// resolveTargetSha in apps/web/lib/self-upgrade/version.ts (same execFile
// dep injection, same HOST_SOURCE_PATH default). No git fetch here —
// resolveTargetSha freshens the local ref itself whenever the remote head is
// ahead of it (BI-4746F2A9), so the target's objects are present by the time
// this range is walked.

import type { RawCommit } from "./types";

// ASCII Unit Separator + Record Separator — chosen because neither byte
// appears in commit subjects or file paths, so splitting on them is safe.
// Spelled with \x escapes so the source file stays all-ASCII-printable.
const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";
const FORMAT = [
  `${RECORD_SEP}%H`,
  "%s",
  "%an",
  "%aI",
].join(FIELD_SEP);

export type GitLogDeps = {
  execFile: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
};

export type GitLogConfig = {
  hostSourcePath?: string;
};

async function defaultExecFile(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile: nodeExecFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(nodeExecFile);
  // 10MB cap — DPF rarely has >10k changed files between lineage SHAs, but
  // capping here keeps a runaway log from OOM'ing the portal.
  const result = await execAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024 });
  return { stdout: result.stdout.toString() };
}

/** Build `git log` argv for the lineage-to-target range. */
export function buildLogCommand(input: {
  hostSourcePath: string;
  currentLineageSha: string;
  targetSha: string;
}): string[] {
  return [
    "git",
    "-C",
    input.hostSourcePath,
    "log",
    "--reverse",
    "--no-merges",
    "--name-only",
    `--format=${FORMAT}`,
    `${input.currentLineageSha}..${input.targetSha}`,
  ];
}

/** Parse the raw stdout of `git log` (above format) into RawCommit[]. */
export function parseGitLogOutput(stdout: string): RawCommit[] {
  if (!stdout.trim()) return [];
  // Records start with RECORD_SEP, so the first split chunk is empty - drop it.
  const records = stdout.split(RECORD_SEP).slice(1);
  const out: RawCommit[] = [];
  for (const record of records) {
    // record shape: <sha><FIELD_SEP><subject><FIELD_SEP><author><FIELD_SEP><authorDate>\n<file1>\n<file2>...
    const newlineIdx = record.indexOf("\n");
    const headerLine = newlineIdx === -1 ? record : record.slice(0, newlineIdx);
    const rest = newlineIdx === -1 ? "" : record.slice(newlineIdx + 1);

    const parts = headerLine.split(FIELD_SEP);
    if (parts.length < 4 || !parts[0]) continue;
    const [sha, subject, author, authorDate] = parts;

    const files = rest
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    out.push({
      sha: sha!,
      subject: (subject ?? "").trim(),
      author: (author ?? "").trim(),
      authorDate: (authorDate ?? "").trim(),
      files,
    });
  }
  return out;
}

/** Collect the lineage-to-target change set from the host clone. */
export async function collectChangeSet(
  input: {
    currentLineageSha: string;
    targetSha: string;
    config?: GitLogConfig;
  },
  deps: GitLogDeps = { execFile: defaultExecFile },
): Promise<RawCommit[]> {
  const hostSourcePath =
    input.config?.hostSourcePath ?? process.env["HOST_SOURCE_PATH"] ?? "/workspace";
  const [, ...gitArgs] = buildLogCommand({
    hostSourcePath,
    currentLineageSha: input.currentLineageSha,
    targetSha: input.targetSha,
  });
  const { stdout } = await deps.execFile("git", gitArgs);
  return parseGitLogOutput(stdout);
}

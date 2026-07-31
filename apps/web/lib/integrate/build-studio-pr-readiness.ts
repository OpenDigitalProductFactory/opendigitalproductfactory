export interface BuildVerificationReadinessInput {
  typecheckPassed: boolean;
  testsFailed: number;
  acceptanceMet: number;
  acceptanceTotal: number;
}

export interface ReadinessVerdict {
  ready: boolean;
  blockers: string[];
  warnings?: string[];
}

const SAFE_BRANCH = /^(?![-/])(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]+$/;
const FULL_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;

function assertSafeBranch(value: string, label: string): void {
  if (!SAFE_BRANCH.test(value) || value.endsWith("/") || value.endsWith(".")) {
    throw new Error(`${label} is not a safe Git branch name.`);
  }
}

export function evaluateBuildVerificationReadiness(
  input: BuildVerificationReadinessInput,
): ReadinessVerdict {
  const blockers: string[] = [];
  if (!input.typecheckPassed) blockers.push("TypeCheck did not pass.");
  if (input.testsFailed > 0) blockers.push(`${input.testsFailed} test(s) failed.`);
  if (input.acceptanceTotal < 1) {
    blockers.push("No acceptance criteria were recorded as verification evidence.");
  } else if (input.acceptanceMet < input.acceptanceTotal) {
    blockers.push(
      `${input.acceptanceTotal - input.acceptanceMet} acceptance criterion/criteria remain unmet.`,
    );
  }
  return { ready: blockers.length === 0, blockers };
}

export function buildPublishedReadinessCommand(input: {
  branchName: string;
  commitSha: string;
  restoreBranch: string;
  prBodyBase64: string;
  repositoryOwner: string;
  repositoryName: string;
}): string {
  assertSafeBranch(input.branchName, "Published branch");
  assertSafeBranch(input.restoreBranch, "Restore branch");
  if (!FULL_SHA.test(input.commitSha)) throw new Error("Published commit is not a full Git SHA.");
  if (!/^[A-Za-z0-9+/=]+$/.test(input.prBodyBase64)) {
    throw new Error("PR body is not valid base64.");
  }
  if (!REPOSITORY_PART.test(input.repositoryOwner) || !REPOSITORY_PART.test(input.repositoryName)) {
    throw new Error("Published repository identity is not safe.");
  }

  const remoteRef = `refs/remotes/origin/${input.branchName}`;
  const remoteUrl = `https://github.com/${input.repositoryOwner}/${input.repositoryName}.git`;
  const bodyFile = `.dpf-pr-body-${input.commitSha}.md`;
  return [
    "cd /workspace",
    "IFS= read -r DPF_GITHUB_TOKEN",
    "export DPF_GITHUB_TOKEN",
    "askpass=$(mktemp)",
    "printf '%s\\n' '#!/bin/sh' 'case \"$1\" in *Username*) echo x-access-token ;; *) printf \"%s\\\\n\" \"$DPF_GITHUB_TOKEN\" ;; esac' > \"$askpass\"",
    "chmod 700 \"$askpass\"",
    `printf '%s' '${input.prBodyBase64}' | base64 -d > '${bodyFile}'`,
    `GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch '${remoteUrl}' '+refs/heads/${input.branchName}:${remoteRef}' >/tmp/dpf-pr-fetch.log 2>&1`,
    "fetch_rc=$?",
    "readiness_rc=99",
    `if [ \"$fetch_rc\" -eq 0 ]; then git checkout --detach '${input.commitSha}' >/tmp/dpf-pr-checkout.log 2>&1; checkout_rc=$?; else checkout_rc=99; fi`,
    `if [ \"$checkout_rc\" -eq 0 ]; then node scripts/pr-readiness.mjs --pr-body-file '${bodyFile}' --published-ref '${remoteRef}' --json 2>&1; readiness_rc=$?; fi`,
    `git checkout '${input.restoreBranch}' >/tmp/dpf-pr-restore.log 2>&1`,
    "restore_rc=$?",
    `rm -f '${bodyFile}' \"$askpass\"`,
    "printf '\\nDPF_PR_READINESS_COMMAND fetch=%s checkout=%s readiness=%s restore=%s\\n' \"$fetch_rc\" \"$checkout_rc\" \"$readiness_rc\" \"$restore_rc\"",
    "exit 0",
  ].join("; ");
}

export function parsePublishedReadinessOutput(output: string): ReadinessVerdict {
  const jsonLine = String(output)
    .split(/\r?\n/)
    .find((line) => line.startsWith("DPF_PR_READINESS_JSON="));
  const commandLine = String(output)
    .split(/\r?\n/)
    .find((line) => line.startsWith("DPF_PR_READINESS_COMMAND "));

  const commandStatus = commandLine?.match(
    /^DPF_PR_READINESS_COMMAND fetch=(\d+) checkout=(\d+) readiness=(\d+) restore=(\d+)$/,
  );
  if (!commandStatus || commandStatus[1] !== "0" || commandStatus[2] !== "0"
    || !["0", "1"].includes(commandStatus[3] ?? "") || commandStatus[4] !== "0") {
    return {
      ready: false,
      blockers: [`Exact published-tree readiness could not complete: ${commandLine ?? "missing command status"}.`],
    };
  }
  if (!jsonLine) {
    return {
      ready: false,
      blockers: ["Exact published-tree readiness returned no machine-readable verdict."],
    };
  }
  try {
    const parsed = JSON.parse(jsonLine.slice("DPF_PR_READINESS_JSON=".length)) as ReadinessVerdict;
    if (typeof parsed.ready !== "boolean" || !Array.isArray(parsed.blockers)) {
      throw new Error("invalid shape");
    }
    const expectedExit = parsed.ready ? "0" : "1";
    if (commandStatus[3] !== expectedExit) {
      throw new Error("verdict and command exit disagree");
    }
    return parsed;
  } catch {
    return {
      ready: false,
      blockers: ["Exact published-tree readiness returned an invalid machine-readable verdict."],
    };
  }
}

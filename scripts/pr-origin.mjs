#!/usr/bin/env node
// pr-origin.mjs — "which client and which thread produced this PR?"
// (BI-3A34D7A9)
//
// The PR number is the one identifier a human works with, so it is the only
// argument. Everything else is derived:
//
//   PR number --(gh)--> head SHA + every commit SHA + branch
//             --(MCP lookup_change_origin)--> client, thread, parent thread
//
// Nothing internal is published to the PR to make this work. The correlation
// runs entirely against this install's own governed pregate records, which is
// the point: an operator can trace a PR without the PR body carrying lease ids,
// evidence ids, session ids, or worktree paths for the whole world to read.
//
// Matching is by SHA, not branch. Branch names are reused across threads and
// deleted on merge; commits are unique and permanent.

import { mcpCall } from "./lib/mcp-client.mjs";
import { spawnSync } from "node:child_process";

function die(message) {
  process.stderr.write(`pr-origin: ${message}\n`);
  process.exit(1);
}

function usage() {
  return `Usage: node scripts/pr-origin.mjs <pr-number> [--json] [--all]

Resolve which agent client and thread produced a pull request, using this
install's governed local-CI gate records.

Options:
  --json   Emit the raw lookup result instead of a human summary.
  --all    List every matching record, not just the best one.
  --help   Show this help.

Environment:
  DPF_MCP_URL   MCP endpoint (default http://127.0.0.1:3000/api/mcp/v1)
`;
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    die(
      `gh ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "unknown error").trim()}`,
    );
  }
  return result.stdout;
}

function parseArgs(argv) {
  const options = { prNumber: null, json: false, all: false };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (/^\d+$/.test(arg)) options.prNumber = Number(arg);
    else if (/^#\d+$/.test(arg)) options.prNumber = Number(arg.slice(1));
    else die(`unknown argument: ${arg}`);
  }
  return options;
}

function describeMatch(match) {
  const parts = [];
  parts.push(`client:  ${match.provider ?? "unknown"}`);
  parts.push(`thread:  ${match.sessionId ?? "unknown"}`);
  if (match.rootSessionId) parts.push(`parent:  ${match.rootSessionId} (sub-thread)`);
  if (match.branch) parts.push(`branch:  ${match.branch}`);
  if (match.sha) parts.push(`sha:     ${match.sha}`);
  if (match.worktreePath) parts.push(`worktree: ${match.worktreePath}`);
  if (match.leaseId) parts.push(`lease:   ${match.leaseId}`);
  if (match.evidenceRecordId) parts.push(`evidence: ${match.evidenceRecordId}`);
  if (match.gatePassed !== null) parts.push(`gate:    ${match.gatePassed ? "passed" : "not passed"}`);
  parts.push(`matched: ${match.matchedOn}`);
  parts.push(`recorded: ${match.recordedAt}`);
  return parts.map((line) => `  ${line}`).join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.prNumber === null) {
    process.stdout.write(usage());
    die("a PR number is required");
  }

  const view = JSON.parse(
    gh(["pr", "view", String(options.prNumber), "--json", "headRefName,headRefOid,commits,title,url"]),
  );
  // Every SHA the PR contains, not just the head: a PR gated before a rebase
  // still matches exactly on the SHA that was actually gated.
  const shas = [
    view.headRefOid,
    ...(Array.isArray(view.commits) ? view.commits.map((c) => c.oid) : []),
  ].filter((s) => typeof s === "string" && /^[0-9a-f]{40}$/i.test(s));

  const response = await mcpCall("lookup_change_origin", {
    shas,
    branchName: view.headRefName,
  });
  const result = response?.data ?? response?.structuredContent?.data ?? null;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ pr: options.prNumber, ...view, result }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`PR #${options.prNumber} — ${view.title ?? ""}\n`);
  process.stdout.write(`  ${view.url ?? ""}\n\n`);

  if (!result || !result.origin) {
    // Not an error: an outside contributor's PR has no local origin, and saying
    // so plainly beats implying the lookup broke.
    process.stdout.write(
      "No governed gate record on this install matches this PR.\n" +
        "That is expected for an outside contribution, or for a change pushed\n" +
        "without the local-CI pregate.\n",
    );
    return;
  }

  process.stdout.write("Origin\n");
  process.stdout.write(`${describeMatch(result.origin)}\n`);
  if (result.unattributed) {
    process.stdout.write(
      "\nNOTE: the gate ran but could not identify its caller, so this thread id\n" +
        "is a placeholder. Have that client pass --owner-provider/--owner-session-id\n" +
        "(or DPF_GATE_OWNER_PROVIDER/DPF_GATE_OWNER_SESSION_ID) to the pregate.\n",
    );
  }

  if (options.all && Array.isArray(result.matches) && result.matches.length > 1) {
    process.stdout.write(`\nAll ${result.matches.length} matching records\n`);
    for (const match of result.matches) {
      process.stdout.write(`\n${describeMatch(match)}\n`);
    }
  } else if (Array.isArray(result.matches) && result.matches.length > 1) {
    process.stdout.write(
      `\n${result.matches.length - 1} other record(s) match this branch — rerun with --all.\n`,
    );
  }
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));

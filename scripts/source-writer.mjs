#!/usr/bin/env node
// Authorized source writer (BI-224F56F1, owner decision DI-250233FBDD9B).
//
// The qualified portal mounts the install checkout read-only. Source changes
// the platform makes to itself run here instead: a short-lived container from
// the canonical promoter image, launched by the private actuator only for an
// admitted owner, with the install checkout as its only writable source mount
// at /host-dpf (the same path the portal reads, so existing workspaces keep
// their origin). It runs a fixed set of operations. Inputs are refnames and
// flags, never paths, options or git argv.
//
//   node source-writer.mjs <operation>    (input JSON in DPF_SOURCE_WRITER_INPUT)
//
// The result is one JSON line on stdout. Exit 0 carries any governed result,
// including prep refusals such as merge conflicts. Exit 2 is an invalid request.

import { pathToFileURL } from "node:url";
import { scriptArgv } from "./lib/script-argv.mjs";
import { defaultGitRunner, prepareUpgradeSource } from "./lib/upgrade-source/prepare-source.mjs";

export const SOURCE_WRITER_ROOT = "/host-dpf";
const WORKSPACE = `${SOURCE_WRITER_ROOT}/.upgrade-workspace`;
const MAX_INPUT_BYTES = 4096;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const invalid = () => { throw new Error("source_writer_request_invalid"); };

/** git check-ref-format, restricted further to a conservative character set. */
function isRefname(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && !value.includes("..") && !value.includes("//") && !value.endsWith("/")
    && !value.endsWith(".lock") && !value.endsWith(".") && !value.split("/").some((part) => part.startsWith("."));
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseSourceWriterRequest(operation, raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_INPUT_BYTES) return invalid();
  let input;
  try { input = JSON.parse(raw); } catch { return invalid(); }
  if (operation === "prepare-upgrade-source") {
    if (!exactKeys(input, ["sourceMode", "remote", "branch", "installBranch", "isolatedWorkspace"])
      || !["upstream", "local"].includes(input.sourceMode) || !REMOTE.test(input.remote ?? "")
      || !isRefname(input.branch) || !isRefname(input.installBranch) || typeof input.isolatedWorkspace !== "boolean") return invalid();
    return { operation, input };
  }
  if (operation === "refresh-upstream-head") {
    if (!exactKeys(input, ["remote", "branch"]) || !REMOTE.test(input.remote ?? "") || !isRefname(input.branch)) return invalid();
    return { operation, input };
  }
  return invalid();
}

export async function runSourceWriter(request, run = defaultGitRunner) {
  const { operation, input } = request;
  if (operation === "prepare-upgrade-source") {
    return prepareUpgradeSource({
      sourceMode: input.sourceMode, hostSourcePath: SOURCE_WRITER_ROOT, remote: input.remote, branch: input.branch,
      installBranch: input.installBranch, ...(input.isolatedWorkspace ? { workspacePath: WORKSPACE } : {}),
    }, run);
  }
  await run(["-C", SOURCE_WRITER_ROOT, "fetch", input.remote, input.branch]);
  const head = await run(["-C", SOURCE_WRITER_ROOT, "rev-parse", `${input.remote}/${input.branch}`]);
  const sha = head.code === 0 ? head.stdout.trim() : "";
  return /^[a-f0-9]{40}$/.test(sha) ? { ok: true, upstreamSha: sha } : { ok: false, reason: "no-target" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let request;
  try {
    request = parseSourceWriterRequest(scriptArgv()[0], process.env.DPF_SOURCE_WRITER_INPUT ?? "");
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: "invalid-request" })}\n`);
    process.exit(2);
  }
  // The checkout is owned by the host user; trust exactly the fixed root and
  // workspace through environment-scoped config, without writing global config.
  process.env.GIT_CONFIG_COUNT = "2";
  process.env.GIT_CONFIG_KEY_0 = "safe.directory";
  process.env.GIT_CONFIG_VALUE_0 = SOURCE_WRITER_ROOT;
  process.env.GIT_CONFIG_KEY_1 = "safe.directory";
  process.env.GIT_CONFIG_VALUE_1 = WORKSPACE;
  const result = await runSourceWriter(request);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

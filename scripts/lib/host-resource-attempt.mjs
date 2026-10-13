// BI-25CB699C: invocation identity is stable across processes, not across work.
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { gitText } from "./git.mjs";
import { readGuardInputStamp } from "./pregate-preflight-receipt.mjs";
import { readClientCredentials } from "./mcp-credential.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function readHostAttemptContext(input, env = process.env) {
  const cwd = input.worktreePath;
  const git = args => gitText(args, { cwd, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  const root = git(["rev-parse", "--show-toplevel"]);
  const untracked = gitText(["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: root, trim: false, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
  return {
    ...input,
    source: {
      head: git(["rev-parse", "HEAD"]),
      changes: digest(git(["diff", "--no-ext-diff", "--binary", "HEAD"])),
      untracked: untracked.split("\0").filter(Boolean).sort().map(path => readGuardInputStamp(resolve(root, path))),
    },
    dependencies: ["node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml", "packages/db/generated/client/client.ts",
      ".env", "apps/web/.env.local"]
      .map(path => readGuardInputStamp(resolve(root, path))),
    localEnvironment: [".env", ".env.local"].map(path => readGuardInputStamp(resolve(cwd, path))),
    toolchain: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
    // The only expected environment change is the recursion marker. Never
    // persist environment values (which may carry credentials) in the pin.
    environment: digest(Object.entries(env).filter(([key]) => key !== "DPF_DURABLE_RESUME")
      .sort(([a], [b]) => a.localeCompare(b))),
    credential: digest(readClientCredentials(env)),
  };
}

export function resolveHostAttempt(context, resumePin, newId = randomUUID) {
  const fingerprint = digest(context);
  const pin = resumePin ? JSON.parse(resumePin) : { attemptId: newId(), fingerprint };
  if (!/^[a-f0-9-]{36}$/.test(pin?.attemptId ?? "") || pin.fingerprint !== fingerprint
    || (resumePin && (typeof pin.leaseId !== "string" || !pin.leaseId))) {
    throw new Error("host_resource_resume_identity_changed");
  }
  return { ...pin, claimKey: `host-resource:v2:${pin.attemptId}:${fingerprint}` };
}

export function hostResumePin(attempt, leaseId) {
  return JSON.stringify({ attemptId: attempt.attemptId, fingerprint: attempt.fingerprint, leaseId });
}

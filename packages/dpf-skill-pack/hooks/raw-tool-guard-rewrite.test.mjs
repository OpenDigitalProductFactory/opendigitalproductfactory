// packages/dpf-skill-pack/hooks/raw-tool-guard-rewrite.test.mjs
//
// Rewrite instead of refuse (BI-F17F2188). Over 21 days, 34 refusals in 26
// Claude sessions were all deterministic substitutions: the agent retyped the
// command the refusal named. Where the package resolves from the command's
// folder, the guard now hands Claude the rewritten command. It still refuses
// when it cannot resolve, and on any client with no proven rewrite.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, planRewrite, refusalHint, rewriteEnvelope } from "./raw-tool-guard.mjs";

const WS = mkdtempSync(join(tmpdir(), "raw-tool-rewrite-")).replace(/\\/g, "/");
after(() => rmSync(WS, { recursive: true, force: true }));
writeFileSync(join(WS, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
writeFileSync(join(WS, "package.json"), JSON.stringify({ name: "dpf-root", private: true }));
mkdirSync(join(WS, "packages", "dpf-skill-pack"), { recursive: true });
mkdirSync(join(WS, "apps", "web", "lib"), { recursive: true });
mkdirSync(join(WS, "apps", "web", "node_modules", ".bin"), { recursive: true });
writeFileSync(join(WS, "apps", "web", "node_modules", ".bin", "prisma"), "");
writeFileSync(
  join(WS, "apps", "web", "package.json"),
  JSON.stringify({
    name: "web",
    scripts: { typecheck: "node ../../scripts/run-tsc.mjs --noEmit", "typecheck:tests": "node ../../scripts/run-tsc.mjs --noEmit -p tsconfig.test.json" },
  }),
);
writeFileSync(join(WS, "apps", "web", "tsconfig.json"), "{}");
writeFileSync(join(WS, "apps", "web", "tsconfig.test.json"), "{}");
mkdirSync(join(WS, "packages", "db"), { recursive: true });
writeFileSync(join(WS, "packages", "db", "package.json"), JSON.stringify({ name: "@dpf/db", scripts: {} }));
const WEB = `${WS}/apps/web`;

// Built from parts so this file's own text never reads as a raw invocation.
const NPX = ["n", "px"].join("");

test("rewrites npx to pnpm exec when the tool is pinned in the package's node_modules/.bin", () => {
  const plan = planRewrite({ command: `${NPX} prisma generate`, cwd: WEB });
  assert.equal(plan.command, "pnpm exec prisma generate");
  assert.match(plan.context, new RegExp(`${NPX} prisma generate`));
  assert.match(plan.context, /pnpm exec prisma generate/);
});

test("follows a cd in the same command to find the package", () => {
  const plan = planRewrite({ command: `cd apps/web && ${NPX} prisma generate --schema x.prisma`, cwd: WS });
  assert.equal(plan.command, "cd apps/web && pnpm exec prisma generate --schema x.prisma");
});

test("rewrites tsc --noEmit to the package's typecheck script", () => {
  assert.equal(planRewrite({ command: "pnpm --filter web exec tsc --noEmit", cwd: WS }).command, "pnpm --filter web typecheck");
  assert.equal(planRewrite({ command: `${NPX} tsc --noEmit`, cwd: WEB }).command, "pnpm --filter web typecheck");
  assert.equal(
    planRewrite({ command: "cd apps/web && pnpm exec tsc --noEmit -p tsconfig.test.json", cwd: WS }).command,
    "cd apps/web && pnpm --filter web typecheck:tests",
  );
  assert.equal(
    planRewrite({ command: "tsc --noEmit 2>&1 | head -40", cwd: `${WEB}/lib` }).command,
    "pnpm --filter web typecheck 2>&1 | head -40",
  );
});

test("rewrites root vitest to the owning package with package-relative paths", () => {
  assert.equal(
    planRewrite({ command: "pnpm vitest run apps/web/lib/a.test.ts apps/web/lib/b.test.ts", cwd: WS }).command,
    "pnpm --filter web exec vitest run lib/a.test.ts lib/b.test.ts",
  );
  assert.equal(
    planRewrite({ command: `${NPX} vitest run apps/web/lib/a.test.ts -t "one case"`, cwd: WS }).command,
    'pnpm --filter web exec vitest run lib/a.test.ts -t "one case"',
  );
});

test("every rewrite is one the guard itself allows", () => {
  for (const [command, cwd] of [
    [`${NPX} prisma generate`, WEB],
    [`${NPX} tsc --noEmit`, WEB],
    ["pnpm vitest run apps/web/lib/a.test.ts", WS],
  ]) {
    const plan = planRewrite({ command, cwd });
    assert.ok(plan.command, command);
    assert.equal(decide({ command: plan.command, cwd }).block, false, plan.command);
  }
});

test("refuses (no rewrite) when the package or the substitution cannot be resolved", () => {
  for (const [command, cwd] of [
    [`${NPX} prisma generate`, WS], // nothing pinned at the root
    [`${NPX} create-next-app x`, WEB], // tool not pinned anywhere
    [`${NPX} -y prisma generate`, WEB], // npx flags change resolution
    ["tsc --noEmit", WS], // root: which package?
    ["tsc -p tsconfig.json", WEB], // emits; typecheck does not
    ["pnpm --filter @dpf/db exec tsc --noEmit", WS], // no typecheck script
    ["tsc --noEmit --watch", WEB], // a flag typecheck cannot carry
    ["tsc --noEmit -p tsconfig.json", `${WEB}/lib`], // names lib/tsconfig.json, not the package's
    ["npm run tsc --noEmit", WEB], // a package script, not the compiler
    ["pnpm vitest run", WS], // no file to place
    ["pnpm vitest run apps/web/lib/a.test.ts packages/db/x.test.ts", WS], // two packages
    ["pnpm vitest run scripts/foo.test.mjs", WS], // not in a package
    [`node -e "1" && ${NPX} prisma generate $(cat x)`, WEB], // command substitution
  ]) {
    assert.equal(planRewrite({ command, cwd }).command, undefined, command);
  }
});

test("rewrite envelope keeps the other input fields and asks unless permissions are bypassed", () => {
  const ask = rewriteEnvelope({
    toolInput: { command: `${NPX} prisma generate`, description: "gen" },
    command: "pnpm exec prisma generate",
    context: "c",
    permissionMode: "default",
  });
  assert.deepEqual(ask.hookSpecificOutput.updatedInput, { command: "pnpm exec prisma generate", description: "gen" });
  assert.equal(ask.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(ask.hookSpecificOutput.additionalContext, "c");
  const allow = rewriteEnvelope({ toolInput: { command: "x" }, command: "y", context: "c", permissionMode: "bypassPermissions" });
  assert.equal(allow.hookSpecificOutput.permissionDecision, "allow");
});

const GUARD = join(fileURLToPath(new URL(".", import.meta.url)), "raw-tool-guard.mjs");
function runGuard(payload) {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify(payload),
    env: { ...process.env, DPF_ALLOW_RAW_TOOL: "", DPF_GUARDS_WORKSPACE_ANY: "1" },
    encoding: "utf8",
  });
  return out ? JSON.parse(out) : null;
}

test("per client: Claude gets the rewrite; Codex and Grok keep the refusal", () => {
  const command = `${NPX} prisma generate`;
  const claude = runGuard({ hook_event_name: "PreToolUse", session_id: "s", permission_mode: "bypassPermissions", cwd: WEB, tool_name: "Bash", tool_input: { command } });
  assert.equal(claude.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(claude.hookSpecificOutput.updatedInput.command, "pnpm exec prisma generate");
  const codex = runGuard({ hook_event_name: "PreToolUse", session_id: "s", turn_id: "t", model: "gpt", permission_mode: "default", cwd: WEB, tool_name: "Bash", tool_input: { command } });
  assert.equal(codex.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(codex.hookSpecificOutput.updatedInput, undefined);
  const grok = runGuard({ hookEventName: "PreToolUse", toolName: "run_terminal_command", toolInput: { command }, cwd: WEB, workspaceRoot: WEB });
  assert.equal(grok.decision, "deny");
  assert.equal(grok.hookSpecificOutput.updatedInput, undefined);
});

test("a refusal names the exact command for the package it was run in", () => {
  assert.equal(refusalHint({ command: "tsc --noEmit --watch", cwd: WEB }), "pnpm --filter web typecheck");
  assert.equal(refusalHint({ command: `${NPX} create-next-app x`, cwd: `${WEB}/lib` }), "pnpm --filter web exec create-next-app x");
  assert.equal(refusalHint({ command: "pnpm vitest run", cwd: `${WEB}/lib` }), "pnpm --filter web exec vitest run <files>");
  assert.equal(refusalHint({ command: "tsc --noEmit", cwd: WS }), null); // root: no package to name
  const out = runGuard({ hook_event_name: "PreToolUse", permission_mode: "bypassPermissions", cwd: WEB, tool_name: "Bash", tool_input: { command: "tsc --noEmit --watch" } });
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /In this package:\s+pnpm --filter web typecheck/);
});

test("Claude still gets the refusal when the rewrite cannot be resolved", () => {
  const out = runGuard({ hook_event_name: "PreToolUse", permission_mode: "bypassPermissions", cwd: WS, tool_name: "Bash", tool_input: { command: "tsc --noEmit" } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
});

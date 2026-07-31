import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDERS,
  buildAttributionEvidence,
  resolveAgentIdentity,
} from "./agent-identity.mjs";

// A live Claude Code session's actual markers.
const CLAUDE_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
  CLAUDE_CODE_SESSION_ID: "79495644-27dd-4631-bed1-06e294056a4f",
  CLAUDE_CODE_HOST_SESSION_ID: "local_a8854bf0-b9f6-4862-80b8-ef1c5e2222ed",
  CLAUDE_CODE_CHILD_SESSION: "1",
};

test("the provider vocabulary carries no 'unknown' member", () => {
  // The MCP tool's enum is closed; an unresolved provider must be null, never
  // a fabricated enum value that the tool would reject downstream.
  assert.ok(!PROVIDERS.includes("unknown"));
  assert.ok(PROVIDERS.includes("claude"));
  assert.ok(PROVIDERS.includes("codex"));
});

test("detects Claude Code from its own environment, not as codex", () => {
  const id = resolveAgentIdentity({ env: CLAUDE_ENV, pid: 4242 });
  assert.equal(id.provider, "claude");
  assert.equal(id.providerSource, "detected");
  assert.equal(id.sessionId, "79495644-27dd-4631-bed1-06e294056a4f");
  assert.equal(id.sessionSource, "detected");
  assert.equal(id.attribution, "attributed");
  assert.deepEqual(id.warnings, []);
});

test("rolls a sub-thread up to its parent thread", () => {
  const id = resolveAgentIdentity({ env: CLAUDE_ENV, pid: 1 });
  assert.equal(id.rootSessionId, "local_a8854bf0-b9f6-4862-80b8-ef1c5e2222ed");
  assert.equal(id.isChildThread, true);
});

test("a top-level thread is not marked as a child", () => {
  const id = resolveAgentIdentity({
    env: {
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "same-id",
      CLAUDE_CODE_HOST_SESSION_ID: "same-id",
    },
    pid: 1,
  });
  assert.equal(id.isChildThread, false);
});

test("detects codex from its own environment", () => {
  const id = resolveAgentIdentity({
    env: { CODEX_THREAD_ID: "019f974a-8e62-7f03-8556-4104f2d41cc6" },
    pid: 7,
  });
  assert.equal(id.provider, "codex");
  assert.equal(id.sessionId, "019f974a-8e62-7f03-8556-4104f2d41cc6");
  assert.equal(id.attribution, "attributed");
});

test("never guesses a provider when the environment is silent", () => {
  // The whole defect: this case used to record itself as codex/gate-<pid>.
  const id = resolveAgentIdentity({ env: {}, pid: 95708 });
  assert.equal(id.provider, null);
  assert.equal(id.providerSource, "unresolved");
  assert.equal(id.attribution, "unattributed");
  assert.match(id.warnings.join(" "), /--owner-provider/);
});

test("labels an unattributed session so it cannot pass as a real thread id", () => {
  const id = resolveAgentIdentity({ env: {}, pid: 95708 });
  assert.equal(id.sessionId, "unattributed-95708");
  assert.notEqual(id.sessionId, "gate-95708");
  assert.match(id.warnings.join(" "), /--owner-session-id/);
});

test("an explicit provider wins over a detected one", () => {
  // A Claude Code session driving a Build Studio run on behalf of the platform
  // must be able to say so; detection is the fallback, not the authority.
  const id = resolveAgentIdentity({
    env: CLAUDE_ENV,
    providerOverride: "build-studio",
    pid: 1,
  });
  assert.equal(id.provider, "build-studio");
  assert.equal(id.providerSource, "explicit");
});

test("an explicit session wins over a detected one", () => {
  const id = resolveAgentIdentity({
    env: CLAUDE_ENV,
    sessionOverride: "codex-pm-loop-final",
    pid: 1,
  });
  assert.equal(id.sessionId, "codex-pm-loop-final");
  assert.equal(id.sessionSource, "explicit");
});

test("refuses an out-of-vocabulary provider instead of coercing it", () => {
  const id = resolveAgentIdentity({
    env: {},
    providerOverride: "chatgpt",
    pid: 1,
  });
  assert.equal(id.provider, null);
  assert.match(id.warnings.join(" "), /not one of/);
});

test("reports partial attribution when only one half resolves", () => {
  const id = resolveAgentIdentity({
    env: {},
    sessionOverride: "some-thread",
    pid: 1,
  });
  assert.equal(id.provider, null);
  assert.equal(id.sessionId, "some-thread");
  assert.equal(id.attribution, "partial");
});

test("ignores blank and whitespace-only environment values", () => {
  const id = resolveAgentIdentity({
    env: { CLAUDECODE: "   ", CODEX_THREAD_ID: "" },
    pid: 3,
  });
  assert.equal(id.provider, null);
});

test("trims explicit overrides", () => {
  const id = resolveAgentIdentity({
    env: {},
    providerOverride: "  codex  ",
    sessionOverride: "  thread-1  ",
    pid: 1,
  });
  assert.equal(id.provider, "codex");
  assert.equal(id.sessionId, "thread-1");
});

test("attribution evidence carries provenance without touching the lease enum", () => {
  const evidence = buildAttributionEvidence(
    resolveAgentIdentity({ env: CLAUDE_ENV, pid: 1 }),
  );
  assert.deepEqual(evidence, {
    attribution: "attributed",
    providerSource: "detected",
    sessionSource: "detected",
    rootSessionId: "local_a8854bf0-b9f6-4862-80b8-ef1c5e2222ed",
    isChildThread: true,
  });
});

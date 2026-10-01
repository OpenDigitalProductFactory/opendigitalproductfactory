import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_AGENT_SESSION_OVERRIDE_REASON,
  classifyLocalCiOverride,
  cloudAgentSessionOverride,
} from "./local-ci-override.mjs";

test("the cloud-session reason is an allowlisted external-contribution-no-install override", () => {
  const c = classifyLocalCiOverride(CLOUD_AGENT_SESSION_OVERRIDE_REASON);
  assert.equal(c.ok, true);
  assert.equal(c.code, "external-contribution-no-install");
  assert.match(c.detail, /CLAUDE_CODE_REMOTE=true/);
});

test("cloudAgentSessionOverride applies only when CLAUDE_CODE_REMOTE is exactly 'true'", () => {
  assert.equal(cloudAgentSessionOverride({ CLAUDE_CODE_REMOTE: "true" }), CLOUD_AGENT_SESSION_OVERRIDE_REASON);
  assert.equal(cloudAgentSessionOverride({}), null);
  assert.equal(cloudAgentSessionOverride({ CLAUDE_CODE_REMOTE: "false" }), null);
  assert.equal(cloudAgentSessionOverride({ CLAUDE_CODE_REMOTE: "1" }), null);
  assert.equal(cloudAgentSessionOverride(undefined), null);
});

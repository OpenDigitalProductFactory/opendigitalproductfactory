import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeForLog } from "./safe-log.mjs";

describe("sanitizeForLog", () => {
  it("replaces CR, LF, and other C0 controls so a value cannot forge a log line", () => {
    assert.equal(sanitizeForLog("ok\nforged: admin\r\nnext"), "ok_forged: admin_next");
    assert.equal(sanitizeForLog("a\u0000b\u007fc\u2028d"), "a_b_c_d");
  });

  it("leaves an ordinary path and branch alone", () => {
    assert.equal(sanitizeForLog("D:/DPF-worktrees/topic"), "D:/DPF-worktrees/topic");
    assert.equal(sanitizeForLog("fix/security-log-injection"), "fix/security-log-injection");
  });
});

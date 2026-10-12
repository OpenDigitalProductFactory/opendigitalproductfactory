import assert from "node:assert/strict";
import { test } from "node:test";

import { collectSlotVerdicts } from "./pregate-status.mjs";

// BI-A9031FF3: the CLI hands each superseded record its named winner's CURRENT
// record, so the classifier can refuse to repeat a pass that no longer exists.
const HEAD = "ec0a2efc41103fd8033045d4dc2eb84cb9abc7ec";
const context = {
  headSha: HEAD,
  headBranch: "feat/x",
  rootClone: "/repo",
  gitCommonDir: "/repo/.git",
  candidateGitDir: "/repo/.git/worktrees/x",
};

function readerFor(slotStates) {
  return (path) => {
    for (const [slotKey, state] of Object.entries(slotStates)) {
      const marker = slotKey === "slot-0" ? /dpf-local-ci-gate[.]json$/ : new RegExp(`dpf-local-ci-gate-${slotKey}[.]json$`);
      if (marker.test(String(path).split(String.fromCharCode(92)).join("/"))) return state;
    }
    return null;
  };
}

test("a superseded slot-0 record reads slot-1's current record before claiming a pass", () => {
  const slots = collectSlotVerdicts(context, {
    findWaiterImpl: () => null,
    readJsonImpl: readerFor({
      "slot-0": { branch: "feat/x", sha: HEAD, gatePassed: false, status: "superseded", supersededStatus: "queued", supersededBy: { slotKey: "slot-1" } },
      "slot-1": { branch: "feat/x", sha: HEAD, gatePassed: false, status: "blocked_control_plane_starvation" },
    }),
  });
  const slot0 = slots.find((s) => s.slotKey === "slot-0");
  assert.ok(slot0, "slot-0 classified");
  assert.doesNotMatch(slot0.reason, /passed/);
  assert.match(slot0.reason, /blocked_control_plane_starvation/);
});

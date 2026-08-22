import assert from "node:assert/strict";
import test from "node:test";

import { classifyRepository, unreachableCommitArgs } from "./salvage-sweep.mjs";

test("third-party read-only clones are upstream caches, not operator work", () => {
  assert.equal(classifyRepository({ remoteUrl: "https://github.com/anthropics/claude-code.git", operatorOwners: ["OpenDigitalProductFactory", "markbodman"] }), "UPSTREAM-CACHE");
  assert.equal(classifyRepository({ remoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git", operatorOwners: ["OpenDigitalProductFactory"] }), "OPERATOR-REMOTE");
  assert.equal(classifyRepository({ remoteUrl: null, operatorOwners: ["OpenDigitalProductFactory"] }), "LOCAL-ONLY");
});

test("risk counts commits unreachable from every remote", () => {
  assert.deepEqual(unreachableCommitArgs("refs/heads/fix/example"), [
    "rev-list", "--count", "refs/heads/fix/example", "--not", "--remotes",
  ]);
});

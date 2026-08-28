import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectPlatformCompositionSingleHome } from "./check-platform-composition-single-home.mjs";

test("platform software composition has one canonical product home", () => {
  assert.deepEqual(inspectPlatformCompositionSingleHome(), []);
});

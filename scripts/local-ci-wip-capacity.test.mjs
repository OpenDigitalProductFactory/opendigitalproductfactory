import assert from "node:assert/strict";
import test from "node:test";

import {
  decideUnifiedWip,
} from "../apps/web/lib/build/wip-cap.ts";

test("shared-lease WIP reporting accepts the effective local-CI pool capacity", () => {
  assert.deepEqual(
    decideUnifiedWip("shared-lease", 1, { sharedLeaseCapacity: 2 }),
    {
      pool: "shared-lease",
      pressure: 1,
      capacity: 2,
      admitted: true,
    },
  );
  assert.equal(
    decideUnifiedWip("shared-lease", 1, { sharedLeaseCapacity: 1 }).admitted,
    false,
  );
});

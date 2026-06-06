import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("portal image build uses the webpack builder under Docker", () => {
  assert.match(
    dockerfile,
    /pnpm --filter web exec next build --webpack/
  );
  assert.doesNotMatch(dockerfile, /NEXT_TURBOPACK_USE_WORKER=0/);
});

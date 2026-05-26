import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("portal image build keeps Turbopack in-process under Docker", () => {
  assert.match(
    dockerfile,
    /NEXT_TURBOPACK_USE_WORKER=0 pnpm --filter web build/
  );
});

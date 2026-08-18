// Self-test for scripts/check-no-monolith-schema.mjs (auto-run by check-guards).
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, SCHEMA_DIR, LEGACY_MONOLITH } from "./check-no-monolith-schema.mjs";

const model = "model Thing {\n  id String @id\n}\n";
const main = 'generator client {\n  provider = "prisma-client"\n}\n';

test("a healthy folder-split schema passes", () => {
  const failures = evaluate([
    { path: `${SCHEMA_DIR}/main.prisma`, text: main },
    { path: `${SCHEMA_DIR}/finance.prisma`, text: model },
  ]);
  assert.deepEqual(failures, []);
});

test("a reborn schema.prisma monolith fails", () => {
  const failures = evaluate([
    { path: LEGACY_MONOLITH, text: model },
    { path: `${SCHEMA_DIR}/finance.prisma`, text: model },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /monolith is retired/);
});

test("a model declared in a stray .prisma file outside the folder fails", () => {
  const failures = evaluate([
    { path: "packages/db/prisma/extra.prisma", text: model },
    { path: `${SCHEMA_DIR}/finance.prisma`, text: model },
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /only live under packages\/db\/prisma\/schema\//);
});

test("an enum outside the folder fails; declaration-free .prisma elsewhere passes", () => {
  const bad = evaluate([
    { path: "tools/fixture.prisma", text: "enum Color {\n  red\n}\n" },
    { path: `${SCHEMA_DIR}/finance.prisma`, text: model },
  ]);
  assert.equal(bad.length, 1);
  const ok = evaluate([
    { path: "tools/fixture.prisma", text: "// just a comment\n" },
    { path: `${SCHEMA_DIR}/finance.prisma`, text: model },
  ]);
  assert.deepEqual(ok, []);
});

test("a missing or hollow schema folder fails loudly", () => {
  assert.match(evaluate([])[0], /holds no \.prisma files/);
  const hollow = evaluate([{ path: `${SCHEMA_DIR}/main.prisma`, text: main }]);
  assert.match(hollow[0], /declares no models/);
});

// Self-test for check-no-postgres-initdb-host-mount.mjs (BI-4796D52B).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { findInitdbHostMounts } from "./check-no-postgres-initdb-host-mount.mjs";

test("flags a ./scripts host bind mount into initdb.d", () => {
  const compose = `
  postgres:
    image: pgvector/pgvector:pg16
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-inngest-db.sh:/docker-entrypoint-initdb.d/20-create-inngest-db.sh:ro
`;
  const v = findInitdbHostMounts(compose);
  assert.equal(v.length, 1);
  assert.match(v[0].text, /init-inngest-db\.sh/);
});

test("flags an absolute-path and a ${VAR} bind into initdb.d", () => {
  const compose = `
      - /host-source/scripts/init.sh:/docker-entrypoint-initdb.d/10.sh:ro
      - \${INIT_DIR}/x.sh:/docker-entrypoint-initdb.d/30.sh
`;
  assert.equal(findInitdbHostMounts(compose).length, 2);
});

test("passes when there is no initdb host mount (baked image form)", () => {
  const compose = `
  postgres:
    build:
      context: .
      dockerfile: docker/postgres/Dockerfile
    volumes:
      - pgdata:/var/lib/postgresql/data
`;
  assert.deepEqual(findInitdbHostMounts(compose), []);
});

test("does not flag an unrelated ./scripts bind (different target)", () => {
  const compose = `      - ./scripts/other.sh:/somewhere/else.sh:ro`;
  assert.deepEqual(findInitdbHostMounts(compose), []);
});

test("the live docker-compose.yml is clean (baked, not bind-mounted)", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const text = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
  assert.deepEqual(
    findInitdbHostMounts(text),
    [],
    "docker-compose.yml must bake init scripts into the image, not host-bind-mount them (BI-4796D52B)",
  );
});

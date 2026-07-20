import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function composeService(source, serviceName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} must exist in docker-compose.yml`);

  const end = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:$/.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("Contributor preview waits for a pgvector-capable database", async () => {
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const postgres = composeService(compose, "dev-postgres");
  const init = composeService(compose, "dev-init");

  assert.match(postgres, /^    image: pgvector\/pgvector:pg16$/m);
  assert.match(
    postgres,
    /pg_available_extensions[^\n]*name[^\n]*vector/,
    "dev-postgres readiness must prove the required vector extension is available",
  );
  assert.match(
    init,
    /dev-postgres:\n        condition: service_healthy/,
    "dev-init must not run migrations until extension-aware readiness passes",
  );
});

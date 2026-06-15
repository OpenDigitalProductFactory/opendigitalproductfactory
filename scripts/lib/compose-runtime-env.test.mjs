import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.docker.example", import.meta.url), "utf8");

test("installed compose runtime enables background job registration by default", () => {
  assert.match(
    compose,
    /DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED:\s*\$\{DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED:-1\}/,
  );
  assert.match(
    compose,
    /DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED:\s*\$\{DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED:-1\}/,
  );
  assert.match(
    compose,
    /DPF_OPTIONAL_STARTUP_TASKS_ENABLED:\s*\$\{DPF_OPTIONAL_STARTUP_TASKS_ENABLED:-1\}/,
  );
});

test("example compose env documents background job override flags", () => {
  assert.match(envExample, /DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED=/);
  assert.match(envExample, /DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED=/);
  assert.match(envExample, /DPF_OPTIONAL_STARTUP_TASKS_ENABLED=/);
});

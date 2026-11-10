import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skill = (name) => readFile(resolve(here, "..", "skills", name, "SKILL.md"), "utf8");

const [tdd, blast] = await Promise.all([
  skill("dpf-tdd"),
  skill("dpf-blast-radius"),
]);

assert.match(
  tdd,
  /find_related_tests[\s\S]{0,500}Code graph unavailable[\s\S]{0,500}(?:fallback|grep)/i,
  "TDD guidance must stop retrying an unavailable graph and use the bounded source fallback",
);
assert.match(
  blast,
  /find_related_tests[\s\S]{0,700}Code graph unavailable[\s\S]{0,700}(?:fallback|grep)/i,
  "blast-radius guidance must make the unavailable-graph fallback explicit",
);
assert.match(
  tdd,
  /do not retry|never retry|one attempt/i,
  "guidance must prevent blind retries when the graph is unavailable",
);

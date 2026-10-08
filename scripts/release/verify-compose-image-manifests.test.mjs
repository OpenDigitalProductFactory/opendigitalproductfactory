import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KNOWN_UNRESOLVABLE,
  evaluateManifestResults,
  isThirdPartyImage,
  selectImages,
} from "./verify-compose-image-manifests.mjs";

test("release image manifest verification renders services behind profiles", async () => {
  const source = await readFile(new URL("./verify-compose-image-manifests.mjs", import.meta.url), "utf8");
  assert.match(source, /args\.push\("--profile", "\*", "config", "--images"\)/);
});

// BI-DB87D925: dpf-tts pinned travisvn/chatterbox-tts-api:v0.1.0 by TAG. The
// publisher deleted the tag; every caller ran --only digest-pinned and, after
// BI-F7E9A541 removed the last digest pin, the guard checked nothing at all.
test("third-party mode covers tag-pinned images from other publishers and skips DPF's own", () => {
  assert.equal(isThirdPartyImage("travisvn/chatterbox-tts-api:v0.1.0"), true);
  assert.equal(isThirdPartyImage("redis:7-alpine"), true);
  assert.equal(isThirdPartyImage("gcr.io/cadvisor/cadvisor:v0.52.1"), true);
  assert.equal(isThirdPartyImage(`prom/prometheus@sha256:${"a".repeat(64)}`), true);
  // Built by this repository: published by the same release, or local-only.
  assert.equal(isThirdPartyImage("ghcr.io/opendigitalproductfactory/dpf-portal:latest"), false);
  assert.equal(isThirdPartyImage("dpf-dev-portal"), false);

  const rendered = [
    "dpf-dev-init",
    "ghcr.io/opendigitalproductfactory/dpf-sandbox:latest",
    "grafana/loki:3.4.3",
    "travisvn/chatterbox-tts-api:v0.1.0",
  ];
  assert.deepEqual(selectImages(rendered, "third-party"), ["grafana/loki:3.4.3", "travisvn/chatterbox-tts-api:v0.1.0"]);
  assert.deepEqual(selectImages(rendered, "digest-pinned"), []);
});

test("every CI caller verifies third-party images, not only digest pins", async () => {
  for (const workflow of ["release-gates.yml", "publish-image.yml", "install-verification.yml"]) {
    const source = await readFile(new URL(`../../.github/workflows/${workflow}`, import.meta.url), "utf8");
    assert.match(source, /verify-compose-image-manifests\.mjs [^\n]*--only third-party/, workflow);
    assert.doesNotMatch(source, /verify-compose-image-manifests\.mjs [^\n]*--only digest-pinned/, workflow);
  }
});

test("an unresolvable image fails unless it is a named known exception", () => {
  const known = new Map([["travisvn/chatterbox-tts-api:v0.1.0", "BI-E2763038"]]);
  const verdict = evaluateManifestResults(
    [
      { image: "grafana/loki:3.4.3", ok: true },
      { image: "travisvn/chatterbox-tts-api:v0.1.0", ok: false },
      { image: "someone/gone:1.0", ok: false },
    ],
    known,
  );
  assert.deepEqual(verdict.failures, ["someone/gone:1.0"]);
  assert.deepEqual(verdict.knownMissing, [{ image: "travisvn/chatterbox-tts-api:v0.1.0", item: "BI-E2763038" }]);
});

test("a known exception that resolves again, or is no longer rendered, fails so the list only shrinks", () => {
  const known = new Map([
    ["travisvn/chatterbox-tts-api:v0.1.0", "BI-E2763038"],
    ["retired/image:1", "BI-00000000"],
  ]);
  const verdict = evaluateManifestResults([{ image: "travisvn/chatterbox-tts-api:v0.1.0", ok: true }], known);
  assert.deepEqual(verdict.staleExceptions.sort(), ["retired/image:1", "travisvn/chatterbox-tts-api:v0.1.0"]);
});

test("every known exception names its backlog item", () => {
  for (const [image, item] of KNOWN_UNRESOLVABLE) {
    assert.match(item, /^BI-[0-9A-F]{8}$/, image);
  }
});

// BI-E2763038: a tag alone is not identity — the publisher deleted v0.1.0 and every
// install lost dpf-tts. The default stays pinned by tag (names the variant) AND digest.
test("dpf-tts defaults to a tag-and-digest pin, with no exception carried for it", async () => {
  const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  const match = compose.match(/image: \$\{DPF_TTS_IMAGE:-([^}]+)\}/);
  assert.ok(match, "dpf-tts image default not found");
  assert.match(match[1], /^travisvn\/chatterbox-tts-api:[\w.-]+@sha256:[0-9a-f]{64}$/);
  assert.equal([...KNOWN_UNRESOLVABLE.keys()].some((image) => image.startsWith("travisvn/chatterbox-tts-api")), false);
});

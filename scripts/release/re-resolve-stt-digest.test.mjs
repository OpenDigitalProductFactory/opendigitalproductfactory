// Tests for the STT digest re-resolver (BI-A9EAEE2C). Pure fixtures, no
// network, no docker — runs under the bare-runner CI test job.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyRepin,
  parseContractCurrentDigest,
  parsePinnedDigest,
  resolveLiveDigest,
} from "./re-resolve-stt-digest.mjs";

const OLD = `sha256:${"1".repeat(64)}`;
const OLDER = `sha256:${"0".repeat(64)}`;
const NEW = `sha256:${"2".repeat(64)}`;

const COMPOSE = `services:
  dpf-stt:
    # Pinned to the multi-arch index digest for hwdsl2/whisper-server:latest
    # resolved on 2026-07-05 (the prior ${"0".repeat(8)}… digest was deleted from the
    # registry — Release Image Manifest Guard caught it again).
    image: \${DPF_STT_IMAGE:-hwdsl2/whisper-server@${OLD}}
`;

const CONTRACT_TEST = `const RETIRED_STT_DIGEST =
  "hwdsl2/whisper-server@${OLDER}";
const CURRENT_STT_DIGEST =
  "hwdsl2/whisper-server@${OLD}";
`;

test("parsePinnedDigest reads the compose pin", () => {
  assert.equal(parsePinnedDigest(COMPOSE), OLD);
  assert.equal(parsePinnedDigest("no pin here"), "");
});

test("parseContractCurrentDigest reads the test constant across the line break", () => {
  assert.equal(parseContractCurrentDigest(CONTRACT_TEST), OLD);
  assert.equal(parseContractCurrentDigest("nothing"), "");
});

test("applyRepin rotates compose pin, comment date, and both test constants", () => {
  const { composeText, testText, oldDigest } = applyRepin({
    composeText: COMPOSE,
    testText: CONTRACT_TEST,
    newDigest: NEW,
    today: "2027-01-02",
  });
  assert.equal(oldDigest, OLD);
  assert.equal(parsePinnedDigest(composeText), NEW);
  assert.match(composeText, /resolved on 2027-01-02 \(the prior 11111111… digest/);
  assert.doesNotMatch(composeText, new RegExp(OLD));
  assert.match(testText, new RegExp(`RETIRED_STT_DIGEST =\\n  "hwdsl2/whisper-server@${OLD}"`));
  assert.match(testText, new RegExp(`CURRENT_STT_DIGEST =\\n  "hwdsl2/whisper-server@${NEW}"`));
  assert.doesNotMatch(testText, new RegExp(OLDER));
});

test("applyRepin refuses no-op and malformed inputs", () => {
  assert.throws(() => applyRepin({ composeText: COMPOSE, testText: CONTRACT_TEST, newDigest: OLD, today: "2027-01-02" }), /already pins/);
  assert.throws(() => applyRepin({ composeText: COMPOSE, testText: CONTRACT_TEST, newDigest: "sha256:zz", today: "2027-01-02" }), /invalid digest/);
  assert.throws(() => applyRepin({ composeText: "no pin", testText: CONTRACT_TEST, newDigest: NEW, today: "2027-01-02" }), /no hwdsl2/);
  assert.throws(() => applyRepin({ composeText: COMPOSE, testText: "no constant", newDigest: NEW, today: "2027-01-02" }), /CURRENT_STT_DIGEST/);
});

test("applyRepin round-trips against the REAL repo files", () => {
  // Guards against the fixture and the actual docker-compose.yml / contract
  // test drifting apart structurally (comment shape, constant layout).
  const compose = readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  const contractTest = readFileSync(new URL("../../tests/release/installer-release-contract.test.mjs", import.meta.url), "utf8");
  const { composeText, testText } = applyRepin({ composeText: compose, testText: contractTest, newDigest: NEW, today: "2027-01-02" });
  assert.equal(parsePinnedDigest(composeText), NEW);
  assert.equal(parseContractCurrentDigest(testText), NEW);
  assert.match(composeText, /resolved on 2027-01-02/);
});

test("resolveLiveDigest validates the API response shape", async () => {
  const ok = await resolveLiveDigest({
    fetchImpl: async () => ({ ok: true, json: async () => ({ digest: NEW }) }),
  });
  assert.equal(ok, NEW);
  await assert.rejects(
    resolveLiveDigest({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /503/,
  );
  await assert.rejects(
    resolveLiveDigest({ fetchImpl: async () => ({ ok: true, json: async () => ({ digest: "not-a-digest" }) }) }),
    /no valid index digest/,
  );
});

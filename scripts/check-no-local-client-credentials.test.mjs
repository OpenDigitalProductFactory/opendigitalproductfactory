/**
 * BI-ABC88965 — tests for the local client-credentials duplication ratchet.
 * Run: node --test scripts/check-no-local-client-credentials.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL,
  isClientCredentialsGrantClient,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-local-client-credentials.mjs";

const RAW_CLIENT = `
import { request, type Dispatcher } from "undici";
export async function exchange(params) {
  const response = await request("https://oauth.example.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }).toString(),
  });
  return response;
}
`;

test("flags a raw undici client_credentials client", () => {
  assert.equal(isClientCredentialsGrantClient(RAW_CLIENT), true);
});

test("flags the .set(...) grant form too", () => {
  const body = `
import { request } from "undici";
const p = new URLSearchParams();
p.set("grant_type", "client_credentials");
await request(url, { method: "POST", body: p.toString() });
`;
  assert.equal(isClientCredentialsGrantClient(body), true);
});

test("does NOT flag a thin wrapper that calls the shared helper", () => {
  const body = `
import { exchangeClientCredentials } from "@dpf/integration-shared";
import { type Dispatcher } from "undici";
export async function exchange(params) {
  return exchangeClientCredentials({ endpoint, clientId: params.clientId, clientSecret: params.secret });
}
`;
  assert.equal(isClientCredentialsGrantClient(body), false);
});

test("does NOT flag a refresh_token client (different grant)", () => {
  const body = `
import { request } from "undici";
await request(url, {
  method: "POST",
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }).toString(),
});
`;
  assert.equal(isClientCredentialsGrantClient(body), false);
});

test("does NOT flag a client_credentials grant sent over fetch (no undici request)", () => {
  const body = `
const data = { grant_type: "client_credentials", client_id: id, client_secret: secret };
const res = await fetch(tokenUrl, { method: "POST", body: new URLSearchParams(data).toString() });
`;
  assert.equal(isClientCredentialsGrantClient(body), false);
});

test("the live repo passes the guard — no raw client-credentials clients outside canonical/allowlist", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is not stale — every entry still hand-rolls a client", () => {
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the canonical home is not itself allowlisted (it is the sanctioned source)", () => {
  assert.equal(ALLOWLIST.has(CANONICAL), false);
});

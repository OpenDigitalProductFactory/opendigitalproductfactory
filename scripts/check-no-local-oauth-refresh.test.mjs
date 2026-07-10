/**
 * BI-ABC88965 — tests for the local-oauth-refresh duplication ratchet.
 * Run: node --test scripts/check-no-local-oauth-refresh.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL,
  isRefreshTokenGrantClient,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-local-oauth-refresh.mjs";

const RAW_CLIENT = `
import { request, type Dispatcher } from "undici";
export async function exchange(params) {
  const response = await request("https://oauth.example.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }).toString(),
  });
  return response;
}
`;

test("flags a raw undici refresh_token client", () => {
  assert.equal(isRefreshTokenGrantClient(RAW_CLIENT), true);
});

test("flags the .set(...) grant form too", () => {
  const body = `
import { request } from "undici";
const p = new URLSearchParams();
p.set("grant_type", "refresh_token");
await request(url, { method: "POST", body: p.toString() });
`;
  assert.equal(isRefreshTokenGrantClient(body), true);
});

test("does NOT flag a thin wrapper that calls the shared helper", () => {
  const body = `
import { refreshOAuthToken } from "@dpf/integration-shared";
import { type Dispatcher } from "undici";
export async function exchange(params) {
  return refreshOAuthToken({ endpoint, credentialPlacement: "basic-header", refreshToken: params.refreshToken });
}
`;
  assert.equal(isRefreshTokenGrantClient(body), false);
});

test("does NOT flag a client_credentials client (different grant)", () => {
  const body = `
import { request } from "undici";
await request(url, {
  method: "POST",
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: id }).toString(),
});
`;
  assert.equal(isRefreshTokenGrantClient(body), false);
});

test("does NOT flag a refresh_token grant sent over fetch (no undici request)", () => {
  const body = `
const refreshData = { grant_type: "refresh_token", refresh_token: decrypted };
const res = await fetch(provider.tokenUrl, { method: "POST", body: new URLSearchParams(refreshData).toString() });
`;
  assert.equal(isRefreshTokenGrantClient(body), false);
});

test("the live repo passes the guard — no raw refresh_token clients outside the canonical home", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is not stale — every entry still hand-rolls a client", () => {
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the canonical home is not itself allowlisted (it is the sanctioned source)", () => {
  assert.equal(ALLOWLIST.has(CANONICAL), false);
});

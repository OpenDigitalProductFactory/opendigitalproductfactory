import assert from "node:assert/strict";
import { test } from "node:test";

import { assertAutomationSignInOrigin, assertPreviewAuthenticationContext, resolveE2eLoginConfig } from "./global-setup";

test("preview login configuration honors explicit E2E overrides", () => {
  assert.deepEqual(
    resolveE2eLoginConfig({
      E2E_BASE_URL: "http://localhost:3001/",
      E2E_USER_EMAIL: "preview-admin@dpf.test",
      E2E_USER_PASSWORD: "preview-only",
    }),
    {
      baseUrl: "http://localhost:3001",
      email: "preview-admin@dpf.test",
      password: "",
    },
  );
});

test("automation bootstrap does not borrow the install administrator password", () => {
  const config = resolveE2eLoginConfig({ ADMIN_PASSWORD: "local-admin" });

  assert.equal(config.baseUrl, "http://localhost:3000");
  assert.equal(config.email, "admin@dpf.local");
  assert.equal(config.password, "");
});

test("automation sign-in cannot import a production session into preview", () => {
  assertAutomationSignInOrigin("http://localhost:3001/api/automation/sign-in?token=one-use", "http://localhost:3001");
  assert.throws(() => assertAutomationSignInOrigin("http://localhost:3000/api/automation/sign-in?token=one-use", "http://localhost:3001"), /does not belong/);
  assert.equal(resolveE2eLoginConfig({}).password, "");
});

 test("preview authentication requires admission and never selects a password form", () => {
  const base = { E2E_BASE_URL: "http://localhost:3001", E2E_USER_PASSWORD: "explicit", ADMIN_PASSWORD: "install" };
  assert.throws(() => assertPreviewAuthenticationContext(base), /admitted preview/);
  assert.equal(assertPreviewAuthenticationContext({ ...base, DPF_DEV_PORTAL_LEASE_ID: "lease", DPF_DEV_PORTAL_OWNER_SESSION_ID: "owner" }), true);
  assert.equal(resolveE2eLoginConfig(base).password, "");
  assert.throws(() => assertPreviewAuthenticationContext({ E2E_BASE_URL: "http://localhost:3000", DPF_DEV_PORTAL_LEASE_ID: "lease", DPF_DEV_PORTAL_OWNER_SESSION_ID: "owner" }), /admitted preview/);
  assert.equal(assertPreviewAuthenticationContext({ E2E_BASE_URL: "http://localhost:3000", E2E_USER_PASSWORD: "explicit-test" }), false);
});

test("disposable CI login consumes configured test credentials without borrowing install files", () => {
  assert.equal(resolveE2eLoginConfig({ CI: "true", E2E_BASE_URL: "http://localhost:3000", ADMIN_PASSWORD: "ephemeral-ci" }).password, "ephemeral-ci");
  assert.equal(resolveE2eLoginConfig({ CI: "true", E2E_BASE_URL: "https://production.example", ADMIN_PASSWORD: "install" }).password, "");
  assert.equal(resolveE2eLoginConfig({ CI: "true", E2E_BASE_URL: "http://localhost:3001", ADMIN_PASSWORD: "install" }).password, "");
});

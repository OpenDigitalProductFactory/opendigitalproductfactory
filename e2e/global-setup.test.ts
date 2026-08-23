import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveE2eLoginConfig } from "./global-setup";

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
      password: "preview-only",
    },
  );
});

test("default login configuration preserves the existing local workflow", () => {
  const config = resolveE2eLoginConfig({ ADMIN_PASSWORD: "local-admin" });

  assert.equal(config.baseUrl, "http://localhost:3000");
  assert.equal(config.email, "admin@dpf.local");
  assert.equal(config.password, "local-admin");
});

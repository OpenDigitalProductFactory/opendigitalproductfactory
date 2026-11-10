import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RuntimeSecretBootstrapError,
  resolveRuntimeSecrets,
  runRuntimeSecretCommand,
} from "./runtime-secret-bootstrap.mjs";

const ROOT_VALUES = {
  AUTH_SECRET: "auth-canary-never-print",
  CREDENTIAL_ENCRYPTION_KEY: "encryption-canary-never-print",
};

function connectEnv(overrides = {}) {
  return {
    DPF_SECRET_PROVIDER: "onepassword-connect",
    DPF_ONEPASSWORD_CONNECT_HOST: "https://connect.internal",
    DPF_ONEPASSWORD_CONNECT_TOKEN: "token-canary-never-print",
    DPF_ONEPASSWORD_VAULT_ID: "runtime-vault",
    DPF_ONEPASSWORD_ITEM_ID: "portal-roots",
    ...overrides,
  };
}

function item(fields = ROOT_VALUES) {
  return {
    fields: Object.entries(fields).map(([label, value]) => ({ label, value })),
  };
}

function response(body, { ok = true } = {}) {
  return {
    ok,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof RuntimeSecretBootstrapError);
    return error;
  }
  assert.fail("expected runtime-secret bootstrap refusal");
}

function assertValueFree(error) {
  const rendered = `${error.name}: ${error.message}`;
  for (const canary of [
    ...Object.values(ROOT_VALUES),
    "token-canary-never-print",
    "response-canary-never-print",
  ]) {
    assert.equal(rendered.includes(canary), false, `error exposed ${canary}`);
  }
}

test("environment is the default provider and preserves selected values without fetch", async () => {
  let fetched = false;
  const env = { ...ROOT_VALUES, DATABASE_URL: "postgresql://example" };

  const resolved = await resolveRuntimeSecrets({
    env,
    fetch: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });

  assert.equal(fetched, false);
  assert.deepEqual(resolved, ROOT_VALUES);
});

test("environment provider refuses a missing default root before command execution", async () => {
  let spawned = false;
  const error = await captureError(() =>
    runRuntimeSecretCommand({
      argv: ["ignored"],
      env: { AUTH_SECRET: ROOT_VALUES.AUTH_SECRET },
      spawn: () => {
        spawned = true;
      },
    }),
  );

  assert.equal(error.code, "secret-missing");
  assert.equal(error.secretName, "CREDENTIAL_ENCRYPTION_KEY");
  assert.equal(spawned, false);
  assertValueFree(error);
});

test("1Password Connect fetches one item and returns only requested allow-listed fields", async () => {
  const calls = [];
  const resolved = await resolveRuntimeSecrets({
    env: connectEnv({ DPF_RUNTIME_SECRET_NAMES: "AUTH_SECRET,DATABASE_URL" }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(item({
        ...ROOT_VALUES,
        DATABASE_URL: "postgresql://resolved",
        UNRELATED_SECRET: "must-not-escape",
      }));
    },
  });

  assert.deepEqual(resolved, {
    AUTH_SECRET: ROOT_VALUES.AUTH_SECRET,
    DATABASE_URL: "postgresql://resolved",
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://connect.internal/v1/vaults/runtime-vault/items/portal-roots",
  );
  assert.deepEqual(calls[0].options.headers, {
    Authorization: "Bearer token-canary-never-print",
    Accept: "application/json",
  });
  assert.equal(calls[0].options.method, "GET");
});

test("token files are preferred without placing token contents in errors", async () => {
  const env = connectEnv({
    DPF_ONEPASSWORD_CONNECT_TOKEN: undefined,
    DPF_ONEPASSWORD_CONNECT_TOKEN_FILE: "/run/secrets/connect-token",
  });
  let authorization;
  await resolveRuntimeSecrets({
    env,
    readFile: async (path, encoding) => {
      assert.equal(path, "/run/secrets/connect-token");
      assert.equal(encoding, "utf8");
      return "token-canary-never-print\n";
    },
    fetch: async (_url, options) => {
      authorization = options.headers.Authorization;
      return response(item());
    },
  });
  assert.equal(authorization, "Bearer token-canary-never-print");
});

test("configuration and response failures are stable, fail closed, and value-free", async (t) => {
  const cases = [
    ["provider-unsupported", { DPF_SECRET_PROVIDER: "other" }],
    ["secret-name-empty", connectEnv({ DPF_RUNTIME_SECRET_NAMES: "AUTH_SECRET," })],
    ["secret-name-duplicate", connectEnv({ DPF_RUNTIME_SECRET_NAMES: "AUTH_SECRET,AUTH_SECRET" })],
    ["secret-name-unsupported", connectEnv({ DPF_RUNTIME_SECRET_NAMES: "RESPONSE_CANARY" })],
    ["connect-host-invalid", connectEnv({ DPF_ONEPASSWORD_CONNECT_HOST: "not-a-url" })],
    ["connect-token-ambiguous", connectEnv({ DPF_ONEPASSWORD_CONNECT_TOKEN_FILE: "/token" })],
    ["connect-token-missing", connectEnv({ DPF_ONEPASSWORD_CONNECT_TOKEN: "" })],
    ["connect-vault-missing", connectEnv({ DPF_ONEPASSWORD_VAULT_ID: "" })],
    ["connect-item-missing", connectEnv({ DPF_ONEPASSWORD_ITEM_ID: "" })],
    ["timeout-invalid", connectEnv({ DPF_SECRET_PROVIDER_TIMEOUT_MS: "0" })],
  ];

  for (const [code, env] of cases) {
    await t.test(code, async () => {
      const error = await captureError(() =>
        resolveRuntimeSecrets({ env, readFile: async () => "token-canary-never-print" }),
      );
      assert.equal(error.code, code);
      assertValueFree(error);
    });
  }

  const fetchCases = [
    ["connect-network", async () => { throw new Error("token-canary-never-print"); }],
    ["connect-http", async () => response({ error: "response-canary-never-print" }, { ok: false })],
    ["connect-json", async () => response(new Error("response-canary-never-print"))],
    ["connect-shape", async () => response({ fields: "response-canary-never-print" })],
    ["secret-missing", async () => response(item({ CREDENTIAL_ENCRYPTION_KEY: ROOT_VALUES.CREDENTIAL_ENCRYPTION_KEY }))],
    ["secret-empty", async () => response(item({ ...ROOT_VALUES, AUTH_SECRET: "" }))],
    ["secret-duplicate", async () => response({ fields: [
      { label: "AUTH_SECRET", value: ROOT_VALUES.AUTH_SECRET },
      { label: "AUTH_SECRET", value: "response-canary-never-print" },
      { label: "CREDENTIAL_ENCRYPTION_KEY", value: ROOT_VALUES.CREDENTIAL_ENCRYPTION_KEY },
    ] })],
  ];

  for (const [code, fetch] of fetchCases) {
    await t.test(code, async () => {
      const error = await captureError(() => resolveRuntimeSecrets({ env: connectEnv(), fetch }));
      assert.equal(error.code, code);
      assertValueFree(error);
    });
  }
});

test("a timed-out Connect request refuses before command execution", async () => {
  let spawned = false;
  const error = await captureError(() =>
    runRuntimeSecretCommand({
      argv: ["ignored"],
      env: connectEnv({ DPF_SECRET_PROVIDER_TIMEOUT_MS: "10" }),
      fetch: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      spawn: () => {
        spawned = true;
      },
    }),
  );

  assert.equal(error.code, "connect-timeout");
  assert.equal(spawned, false);
  assertValueFree(error);
});

test("launcher overlays resolved values only in the child environment", async () => {
  const parent = connectEnv();
  let childOptions;
  await runRuntimeSecretCommand({
    argv: ["portal-boot", "serve"],
    env: parent,
    fetch: async () => response(item()),
    spawn: (command, args, options) => {
      assert.equal(command, "portal-boot");
      assert.deepEqual(args, ["serve"]);
      childOptions = options;
      return Promise.resolve({ code: 0, signal: null });
    },
  });

  assert.equal(parent.AUTH_SECRET, undefined);
  assert.equal(childOptions.env.AUTH_SECRET, ROOT_VALUES.AUTH_SECRET);
  assert.equal(childOptions.env.CREDENTIAL_ENCRYPTION_KEY, ROOT_VALUES.CREDENTIAL_ENCRYPTION_KEY);
  assert.equal(childOptions.env.DPF_ONEPASSWORD_CONNECT_TOKEN, undefined);
  assert.equal(childOptions.stdio, "inherit");
});

test("production image and compose route portal startup through the provider boundary", async () => {
  const [dockerfile, compose] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
  ]);

  assert.match(dockerfile, /COPY scripts\/runtime-secret-bootstrap\.mjs \/usr\/local\/bin\/runtime-secret-bootstrap\.mjs/);
  assert.match(dockerfile, /CMD \["node", "\/usr\/local\/bin\/runtime-secret-bootstrap\.mjs", "--", "\/usr\/local\/bin\/portal-migrate-boot\.sh"/);
  assert.match(compose, /DPF_SECRET_PROVIDER: \$\{DPF_SECRET_PROVIDER:-environment\}/);
  assert.match(
    compose,
    /portal-init:[\s\S]*?command: \["node", "\/usr\/local\/bin\/runtime-secret-bootstrap\.mjs", "--", "\/docker-entrypoint\.sh"\]/,
  );
  assert.match(compose, /AUTH_SECRET: \$\{AUTH_SECRET:-\}/);
  assert.doesNotMatch(compose, /AUTH_SECRET: \$\{AUTH_SECRET:\?/);
  assert.match(compose, /CREDENTIAL_ENCRYPTION_KEY: \$\{CREDENTIAL_ENCRYPTION_KEY:-\}/);
  assert.doesNotMatch(compose, /CREDENTIAL_ENCRYPTION_KEY: \$\{CREDENTIAL_ENCRYPTION_KEY:\?/);
});

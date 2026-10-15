// scripts/bootstrap-grok-credential-issuer.test.mjs (BI-8D152751)
//
// The bootstrap's Grok credential step passed a multi-line issuer script to
// `docker exec ... sh -c <script>` as a native argument. It arrived truncated:
// docker exited 0 with no output, the issuer never ran, and write-client failed
// on empty input, so Grok never got a bearer file. Reproduced on PowerShell
// 7.6 against the dev portal; feeding the same script on stdin (`sh -s`) works.
//
// Run: node --test scripts/bootstrap-grok-credential-issuer.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const bootstrap = readFileSync(new URL("./dpf-bootstrap-agent-toolchain.ps1", import.meta.url), "utf8");

test("the Grok issuer script is fed to the portal on stdin, not as a sh -c argument", () => {
  assert.doesNotMatch(bootstrap, /sh -c \$grokIssuer/, "a multi-line script as a native argument arrives truncated");
  assert.match(bootstrap, /\$grokIssuer \| & docker exec -i \$portal sh -s/);
});

test("an issuer that printed nothing is not treated as a created client", () => {
  assert.match(bootstrap, /IsNullOrWhiteSpace\("\$clientOut"\)/);
});

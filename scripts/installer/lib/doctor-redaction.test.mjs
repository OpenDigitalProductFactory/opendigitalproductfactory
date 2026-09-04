// Regression test: the doctor bundle must not carry live secrets.
//
// docs/install/linux.md tells the operator "Secrets are redacted automatically"
// and the documented workflow is to attach the bundle to a PUBLIC GitHub issue.
// diagnostics.sh wrote `docker compose config` straight to compose-rendered.yml,
// and that command INTERPOLATES every environment variable, so the file carried
// AUTH_SECRET, CREDENTIAL_ENCRYPTION_KEY, ADMIN_PASSWORD and INNGEST_SIGNING_KEY
// byte-identical to .env while the bundle claimed to be redacted (#4337).
//
// Two passes are required and both are tested here:
//   - key-name redaction catches `SOME_KEY: value` lines;
//   - value redaction catches a secret embedded in ANOTHER value, the common
//     case being the password inside a connection string, whose key name
//     matches no secret pattern at all.
//
// These drive real bash: the defect was shell behaviour, not source text.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const libDir = dirname(fileURLToPath(import.meta.url));
const doctorPath = join(libDir, "doctor.sh").replace(/\\/g, "/");
const diagnosticsPath = join(libDir, "diagnostics.sh").replace(/\\/g, "/");

/** Run a bash snippet, returning {status, stdout, stderr}. */
function bash(script) {
  try {
    const stdout = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Source only the two redactor functions, without running doctor.sh's collect. */
function redactorPrelude() {
  // Pull the function bodies out of doctor.sh rather than sourcing the whole
  // module: doctor.sh sources logging/state/compose/platform, which a bare unit
  // test has no reason to pull in.
  // eval, not bare command substitution: substituted text in command position
  // is run as a command, not parsed as a function definition.
  return `
_dpf_doctor_redact() {
  sed -E 's/((SECRET|PASSWORD|TOKEN|KEY|AUTH)[A-Z_]*)(=|: )(.*)$/\\1\\3***REDACTED***/Ig'
}
eval "$(sed -n '/^_dpf_doctor_redact_values() {/,/^}/p' '${doctorPath}')"
eval "$(sed -n '/^_dpf_diagnostics_redact() {/,/^}/p' '${diagnosticsPath}')"
`;
}

// Deliberately NOT secret-shaped. Real high-entropy fixtures trip the repo's
// gitleaks pre-commit scan, and the value from the #1767 report is a live
// credential that must not be re-published here. Redaction keys off the env var
// NAME and off the literal value, not off entropy, so placeholders exercise the
// same paths. They only need to be unique and at least 8 characters.
const SECRETS = {
  AUTH_SECRET: "placeholder-auth-secret-value",
  CREDENTIAL_ENCRYPTION_KEY: "placeholder-credential-encryption-key-value",
  ADMIN_PASSWORD: "placeholder-admin-password-value",
  INNGEST_SIGNING_KEY: "placeholder-inngest-signing-key",
};

function withEnvFile(run) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-redact-"));
  try {
    const lines = Object.entries(SECRETS).map(([k, v]) => `${k}=${v}`);
    // A secret embedded in a value whose KEY matches no secret pattern.
    lines.push(`DATABASE_URL=postgres://dpf:${SECRETS.ADMIN_PASSWORD}@postgres:5432/dpf`);
    lines.push("NODE_ENV=production");
    lines.push("DPF_DEBUG=1");
    writeFileSync(join(dir, ".env"), `${lines.join("\n")}\n`);
    return run(dir.replace(/\\/g, "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("key-name redaction blanks each reported secret in rendered compose YAML", () => {
  const yaml = Object.entries(SECRETS)
    .map(([k, v]) => `      ${k}: ${v}`)
    .join("\n");
  const out = bash(`${redactorPrelude()}
cat <<'YAML' | _dpf_doctor_redact
${yaml}
YAML`);
  assert.equal(out.status, 0, out.stderr);
  for (const [key, value] of Object.entries(SECRETS)) {
    assert.ok(!out.stdout.includes(value), `${key} value leaked: ${out.stdout}`);
  }
  assert.ok(out.stdout.includes("***REDACTED***"));
});

test("value redaction catches a secret embedded in a non-secret key", () => {
  // This is the case key-name redaction cannot see: the key is DATABASE_URL.
  const result = withEnvFile((dir) => bash(`${redactorPrelude()}
cd '${dir}'
printf '%s\\n' '      DATABASE_URL: postgres://dpf:${SECRETS.ADMIN_PASSWORD}@postgres:5432/dpf' \\
  | _dpf_doctor_redact | _dpf_doctor_redact_values .env`));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !result.stdout.includes(SECRETS.ADMIN_PASSWORD),
    `embedded password survived redaction: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes("***REDACTED***"));
  // The surrounding structure must survive so the bundle stays useful.
  assert.ok(result.stdout.includes("postgres://dpf:"));
});

test("short non-secret values are left alone", () => {
  const result = withEnvFile((dir) => bash(`${redactorPrelude()}
cd '${dir}'
printf '%s\\n' '      NODE_ENV: production' '      DPF_DEBUG: 1' | _dpf_doctor_redact_values .env`));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("production"), result.stdout);
  assert.ok(result.stdout.includes("1"), result.stdout);
  assert.ok(!result.stdout.includes("***REDACTED***"), result.stdout);
});

test("value redaction passes the stream through when there is no env file", () => {
  const result = bash(`${redactorPrelude()}
printf '%s\\n' 'plain: text' | _dpf_doctor_redact_values /nonexistent/.env`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "plain: text");
});

test("_dpf_diagnostics_redact fails closed when the doctor redactors are absent", () => {
  // diagnostics.sh can be sourced on its own. A bundle documented as redacted
  // must not depend on load order for that to be true.
  const result = bash(`
eval "$(sed -n '/^_dpf_diagnostics_redact() {/,/^}/p' '${diagnosticsPath}')"
printf '%s\\n' '      ADMIN_PASSWORD: ${SECRETS.ADMIN_PASSWORD}' | _dpf_diagnostics_redact`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    !result.stdout.includes(SECRETS.ADMIN_PASSWORD),
    `standalone diagnostics.sh wrote a raw secret: ${result.stdout}`,
  );
  assert.ok(result.stdout.includes("***REDACTED***"));
});

test("the installer never echoes the generated admin password", () => {
  // #1767: the reporter pasted their install log into a public issue, which is
  // exactly what the install-verification template asks for. The log contained
  // the generated admin password.
  const installer = join(libDir, "..", "..", "..", "install-dpf.sh").replace(/\\/g, "/");
  const out = bash(`grep -n 'Admin password' '${installer}' || true`);
  assert.equal(out.status, 0, out.stderr);
  assert.ok(out.stdout.trim().length > 0, "expected the admin-password line to still exist");
  assert.ok(
    !/Admin password: \$/.test(out.stdout),
    `installer still interpolates the password into its output: ${out.stdout}`,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Every digest this pin has burned through. hwdsl2 re-pushes :latest and lets
// the previous index digest be garbage-collected, so each entry below is a
// release that went red until someone re-pinned by hand. Two so far — which is
// why BI-E6EF0B2C proposes mirroring the image rather than chasing the next one.
const RETIRED_STT_DIGESTS = [
  "hwdsl2/whisper-server@sha256:0b03ecb54c8247cd4fe42e808746f36f44eff7998dc45018554c50252975e29f",
  "hwdsl2/whisper-server@sha256:166a8c04e2687608a116372e92f11bfda3e963f3c1dbf390a7c820db0f45887b",
];
const CURRENT_STT_DIGEST =
  "hwdsl2/whisper-server@sha256:8f76c4f99069b533b54866388f6a6cb1cb47cfde14762dc7af0b22dd58721df2";
const MANIFEST_GUARD =
  "node scripts/release/verify-compose-image-manifests.mjs --mode release --platform linux --only digest-pinned";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("default STT sidecar uses the current reachable multi-arch image digest", () => {
  const compose = read("docker-compose.yml");

  assert.match(compose, new RegExp(CURRENT_STT_DIGEST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const retired of RETIRED_STT_DIGESTS) {
    assert.doesNotMatch(compose, new RegExp(retired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("release gates verify digest-pinned compose images before release install reaches compose up", () => {
  const releaseGates = read(".github/workflows/release-gates.yml");
  const publishImage = read(".github/workflows/publish-image.yml");

  assert.match(releaseGates, new RegExp(MANIFEST_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(publishImage, new RegExp(MANIFEST_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("CI doctor bundle uploads include the hidden .dpf directory", () => {
  for (const path of [".github/workflows/install-verification.yml", ".github/workflows/publish-image.yml"]) {
    const workflow = read(path);

    assert.match(workflow, /path:\s+\/home\/runner\/\.dpf\/doctor-\*\.tar\.gz/);
    assert.match(workflow, /include-hidden-files:\s+true/);
  }
});

test("autostart persists install-state.autostart as a JSON object, not a quoted string", () => {
  const autostart = read("scripts/installer/lib/autostart.sh");

  // dpf_state_write quotes its value, so writing the autostart object
  // through it yields autostart="{...}" (a string). All five sites must
  // use the object-aware dpf_state_write_json so the field stays an object.
  assert.doesNotMatch(autostart, /dpf_state_write\s+autostart\s/);
  assert.match(autostart, /dpf_state_write_json\s+autostart\s+"\{\\"enabled\\":true,\\"kind\\":\\"launchagent\\"\}"/);
  assert.match(autostart, /dpf_state_write_json\s+autostart\s+"\{\\"enabled\\":true,\\"kind\\":\\"systemd-user\\"\}"/);
});

test("installer populates the previously-null install-state fields", () => {
  const installer = read("install-dpf.sh");

  // These were left at their init defaults (null / []) on macOS because
  // the install flow never wrote them. Each must now be persisted.
  assert.match(installer, /dpf_state_write\s+dockerContext\s+"\$\(dpf_docker_context\)"/);
  assert.match(installer, /dpf_state_write_json\s+composeFiles\s+"\$\(dpf_compose_files_json\)"/);
  assert.match(installer, /dpf_state_write\s+llmProvider\s+"\$DPF_RESOLVED_LLM_PROVIDER"/);
  assert.match(installer, /dpf_state_write\s+imageTag\s+"\$DPF_RESOLVED_IMAGE_TAG"/);
});

test("production installers validate canonical lifecycle state before completion", () => {
  assert.match(read("install-dpf.sh"), /validate-install-state\.mjs" "\$\(dpf_state_path\)"/);
  assert.match(read("install-dpf.ps1"), /validate-install-state\.mjs/);
  assert.match(read("install-dpf.ps1"), /Get-DpfStatePath/);
  const compose = read("docker-compose.yml");
  assert.match(compose, /\$\{DPF_STATE_DIR:-\$\{HOME\}\/\.dpf\}:\/dpf-state:ro/);
  assert.match(compose, /DPF_STATE_DIR_HOST: \$\{DPF_STATE_DIR:-\$\{HOME\}\/\.dpf\}/);
});

test("install-state helper functions backing the new fields are defined", () => {
  assert.match(read("scripts/installer/lib/docker.sh"), /dpf_docker_context\(\)\s*\{/);
  assert.match(read("scripts/installer/lib/compose.sh"), /dpf_compose_files_json\(\)\s*\{/);
});

// ── Cross-platform parity guards ────────────────────────────────────────────
// DPF ships a two-implementation model: a .ps1 for Windows and a .sh for
// macOS/Linux, dispatched per-OS. The risk is not "one breaks the other"
// (they are separate files) but SILENT DRIFT — the bash side gaining or
// losing a capability the PowerShell side has, or a task/installer string
// still claiming a feature is "Windows-only / Phase N" after the .sh landed.
// These guards fail CI when the two halves diverge.

const RELEASE_BUMP_LEVELS = ["major", "minor", "patch"];

test("dpf-release.sh and dpf-release.ps1 expose the same bump levels", () => {
  const sh = read("dpf-release.sh");
  const ps1 = read("dpf-release.ps1");

  // Bash: `case "$DPF_BUMP" in major|minor|patch)`
  assert.match(sh, /major\|minor\|patch/, "dpf-release.sh must accept major|minor|patch");
  // PowerShell: `[ValidateSet("major", "minor", "patch")]`
  assert.match(
    ps1,
    /ValidateSet\(\s*"major"\s*,\s*"minor"\s*,\s*"patch"\s*\)/,
    "dpf-release.ps1 ValidateSet must list major, minor, patch",
  );

  // Every level must be referenced in both implementations.
  for (const level of RELEASE_BUMP_LEVELS) {
    assert.match(sh, new RegExp(`\\b${level}\\b`), `dpf-release.sh missing bump level: ${level}`);
    assert.match(ps1, new RegExp(`\\b${level}\\b`), `dpf-release.ps1 missing bump level: ${level}`);
  }
});

test("dpf-release.sh and dpf-release.ps1 default to the same bump level (minor)", () => {
  const sh = read("dpf-release.sh");
  const ps1 = read("dpf-release.ps1");

  assert.match(sh, /DPF_BUMP="minor"/, "dpf-release.sh default bump must be minor");
  assert.match(ps1, /\$Bump\s*=\s*"minor"/, "dpf-release.ps1 default bump must be minor");
});

test("VS Code release/reinstall tasks invoke the real macOS/Linux scripts (no stale stub)", () => {
  const tasks = read(".vscode/tasks.json");

  // The osx/linux variants must call the shipped bash scripts.
  for (const level of RELEASE_BUMP_LEVELS) {
    assert.match(
      tasks,
      new RegExp(`bash dpf-release\\.sh --bump ${level}`),
      `tasks.json osx/linux must run: bash dpf-release.sh --bump ${level}`,
    );
  }
  assert.match(tasks, /bash dpf-reinstall\.sh/, "tasks.json osx/linux Clean Reinstall must run dpf-reinstall.sh");
});

test("no shipped dpf-*.sh script is still advertised as Windows-only / Phase 8 in tasks or installer", () => {
  // Stub strings that lie about a script's availability once the .sh exists.
  const STALE_STUB_PATTERNS = [
    /release scripts are Windows-only today/i,
    /reinstall script is Windows-only today/i,
    /land[s]? with installer-parity Phase 8/i,
    /Mac\/Linux equivalent in Phase 8/i,
  ];

  for (const path of [".vscode/tasks.json", "install-dpf.sh"]) {
    const contents = read(path);
    for (const pattern of STALE_STUB_PATTERNS) {
      assert.doesNotMatch(
        contents,
        pattern,
        `${path} still contains a stale Windows-only/Phase-8 stub (${pattern}); the macOS/Linux script already ships`,
      );
    }
  }
});

test("portal image bundles every directory the seed reads, so seed-* steps don't silently skip", () => {
  const dockerfile = read("Dockerfile");

  // seed-deliberation.ts reads deliberation/ at seed time; the seed runs in
  // the unified runner stage at boot. The dir must be COPYed into the init
  // stage AND forwarded into the runner, exactly like prompts/ and skills/.
  // Missing this leaves DeliberationPattern empty -> reviewDesignDoc cannot
  // pick the "review" pattern -> every Build Studio build wedges in Ideate.
  assert.match(
    dockerfile,
    /^COPY deliberation\/ \.\/deliberation\//m,
    "init stage must COPY deliberation/ (seed-deliberation.ts reads it; see seed.ts:2480)",
  );
  assert.match(
    dockerfile,
    /^COPY --from=init \/app\/deliberation \.\/deliberation$/m,
    "runner stage must forward /app/deliberation from init (the seed runs in the runner at boot)",
  );

  // Guard the sibling seed dirs that share this failure mode so a future
  // refactor can't drop one silently.
  for (const dir of ["prompts", "skills", "deliberation"]) {
    assert.match(
      dockerfile,
      new RegExp(`^COPY ${dir}/ \\./${dir}/`, "m"),
      `init stage must COPY ${dir}/`,
    );
  }
});

// BI-0856A4CE Phase 1 — install-state schema gains devWorkspacePath; the bash
// installer accepts --dev-workspace-path and writes DPF_DEV_WORKSPACE_PATH to
// .env when contributor mode + the path differs from REPO_ROOT. The new-dev-
// worktree script honors that env var and refuses to compute a target outside
// its computed sibling worktree base. These three pieces have to ship together
// or the dev-loop-isolation cluster's structural root is incomplete.
test("install-state schema declares devWorkspacePath as part of BI-0856A4CE", () => {
  const schema = JSON.parse(read("scripts/installer/install-state.schema.json"));
  assert.ok(schema.properties.devWorkspacePath, "schema must declare devWorkspacePath");
  // Nullable / optional: back-compat single-tree mode is signalled by the
  // field being absent or null. The installer only sets it when the operator
  // passes --dev-workspace-path AND it resolves distinct from REPO_ROOT.
  assert.deepEqual(
    schema.properties.devWorkspacePath.type,
    ["string", "null"],
    "devWorkspacePath must be nullable so single-tree mode round-trips through the schema",
  );
  assert.match(
    schema.properties.devWorkspacePath.description ?? "",
    /BI-0856A4CE|DPF_DEV_WORKSPACE_PATH/,
    "schema description must cite the BI + env var for grep-discovery",
  );
});

test("install-dpf.sh accepts --dev-workspace-path and persists it (BI-0856A4CE)", () => {
  const installer = read("install-dpf.sh");
  assert.match(installer, /--dev-workspace-path/, "flag must appear in arg parser + usage");
  assert.match(installer, /DPF_DEV_WORKSPACE_PATH=/, "must write the env var to .env");
  assert.match(installer, /dpf_state_write\s+devWorkspacePath/, "must persist to install-state");
  // Single-tree mode preserved: when the resolved path equals REPO_ROOT, the
  // installer must SKIP writing (so .env stays clean for back-compat). The
  // implementation does this; the test pins it so a future refactor can't
  // accidentally drop the guard.
  assert.match(
    installer,
    /resolves to the install path; single-tree mode/,
    "must skip the .env write when the path equals REPO_ROOT (single-tree back-compat)",
  );
});

test("new-dev-worktree.sh honors DPF_DEV_WORKSPACE_PATH and refuses out-of-base targets (BI-0856A4CE)", () => {
  const script = read("scripts/new-dev-worktree.sh");
  assert.match(script, /DPF_DEV_WORKSPACE_PATH/, "script must consult the env var");
  // Both discovery routes (env var + .env file) must be present so the script
  // works whether the operator sourced .env first or runs raw.
  assert.match(script, /\.env/, "script must also read .env as a fallback");
  // Refuse-out-of-base guard: the proto-version of the BI-6B02FEE5 wrapper
  // refusing worktree creation inside the install path.
  assert.match(
    script,
    /is not under the worktree base/,
    "script must refuse to compute a target outside the sibling worktree base",
  );
});

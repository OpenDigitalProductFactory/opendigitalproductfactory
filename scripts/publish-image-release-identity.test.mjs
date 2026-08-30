import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/publish-image.yml", "utf8");

function jobBlock(jobName, nextJobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);

  const next = workflow.indexOf(`\n  ${nextJobName}:`, start + 1);
  assert.notEqual(next, -1, `missing workflow job after ${jobName}: ${nextJobName}`);
  return workflow.slice(start, next);
}

test("published image identity uses the resolved immutable release tag", () => {
  const build = jobBlock("build", "merge");

  assert.match(build, /DPF_PLATFORM_VERSION=\$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.match(build, /org\.opencontainers\.image\.version=\$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.doesNotMatch(build, /github\.ref_name/);
});

test("published promoter identity is bound to its checked-out contract", () => {
  const build = jobBlock("build", "merge");

  assert.match(build, /id: promoter-contract/);
  assert.match(
    build,
    /sha256sum promoter-contract\.json[^\n]*GITHUB_OUTPUT/,
    "the release workflow must derive the digest from the contract in the release commit",
  );
  assert.match(
    build,
    /DPF_PROMOTER_CONTRACT_DIGEST=sha256:\$\{\{ steps\.promoter-contract\.outputs\.digest \}\}/,
    "the promoter Dockerfile must receive the derived contract digest instead of its 'unknown' default",
  );
  assert.match(build, /DPF_PROMOTER_SOURCE_SHA=\$\{\{ github\.sha \}\}/);
  assert.match(build, /DPF_PROMOTER_RELEASE_TAG=\$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.match(build, /DPF_PROMOTER_RELEASE_OWNER=\$\{\{ steps\.owner\.outputs\.value \}\}/);
});

test("latest is promoted only from the verified immutable release tag", () => {
  const promotion = workflow.slice(workflow.indexOf("  promote-latest:"));

  assert.match(promotion, /needs: \[verify, gate\]/);
  assert.match(promotion, /TAG: \$\{\{ needs\.gate\.outputs\.tag \}\}/);
  assert.match(promotion, /imagetools create --tag "\$\{IMAGE\}:latest" "\$\{IMAGE\}:\$\{TAG\}"/);
});

test("the image build context materializes Git LFS assets", () => {
  const build = jobBlock("build", "merge");

  // The build job supplies the docker context. `.dockerignore` deliberately
  // admits docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx and the
  // Dockerfile COPYs it, but that path is tracked in Git LFS. Without this
  // input, actions/checkout leaves a ~130-byte pointer stub, the COPY bakes it
  // in, and every install's eaReferenceModels seed dies on "invalid zip data"
  // (BI-FEE26C36). No PR check builds the image, so this shape test is the only
  // thing standing between a removed input and a broken published release.
  assert.match(
    build,
    /uses: actions\/checkout@v7\s*\n\s*with:\s*\n\s*lfs: true/,
    "the build job must check out with lfs: true or the image ships LFS pointer stubs",
  );
});

test("the Dockerfile refuses to bake an unmaterialized LFS pointer", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const copyIndex = dockerfile.indexOf(
    "COPY docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx",
  );
  assert.notEqual(copyIndex, -1, "the IT4IT workbook COPY must exist");

  // The assertion has to sit where the bytes enter the artifact: the row-count
  // guard in seed-ea-reference-models.ts runs after the workbook read, and the
  // xlsx parser throws on a stub before it is reached.
  const afterCopy = dockerfile.slice(copyIndex);
  assert.match(
    afterCopy,
    /head -c 2 docs\/Reference\/IT4IT_Functional_Criteria_Taxonomy\.xlsx \| grep -q '\^PK'/,
    "the COPY must be followed by a zip-magic assertion so a pointer stub fails the publish, not the install",
  );
});

test("the runner stage ships git-lfs for the git-source upgrade shape", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const runnerIndex = dockerfile.indexOf("FROM base AS runner");
  assert.notEqual(runnerIndex, -1, "the runner stage must exist");

  // The zip-magic assertion above is enforced on EVERY build of this Dockerfile,
  // including the one the self-upgrade promoter runs on a git-source install.
  // That build's context is a workspace the RUNNER container clones
  // (lib/self-upgrade/prepare-source.ts). Without git-lfs in this stage the clone
  // can only ever produce pointer stubs, so the assertion fails the operator's
  // upgrade instead of a publish — which is what happened to every scheduled run
  // after #4843 merged. The publish path gets materialization from
  // actions/checkout; this stage is that guarantee for the path with no runner.
  const runner = dockerfile.slice(runnerIndex);
  const apkLine = runner.split("\n").find((l) => l.startsWith("RUN apk add"));
  assert.ok(apkLine, "the runner stage must install its OS packages via apk add");
  assert.match(
    apkLine,
    /\bgit-lfs\b/,
    "the runner stage must install git-lfs or self-upgrade cannot materialize the LFS-tracked assets it then asserts",
  );
});

test("the image carries the BIAN landscape the banking seed reads", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const dockerignore = readFileSync(".dockerignore", "utf8");

  // .dockerignore excludes docs/Reference/ wholesale. The BIAN JSON was never
  // re-admitted, so seedBianReferenceModel's readFileSync threw on every
  // install, its own catch swallowed the error, and the model imported zero
  // Service Domains — including on the banking installs it exists for. The
  // negation and the COPY have to move together or the build context loses it.
  assert.match(
    dockerignore,
    /^!docs\/Reference\/bian\//m,
    "the BIAN landscape must be re-admitted to the build context",
  );

  const copyIndex = dockerfile.indexOf(
    "COPY docs/Reference/bian/bian-v14-service-landscape.json",
  );
  assert.notEqual(copyIndex, -1, "the BIAN landscape COPY must exist");

  // Assert the bytes where they enter the artifact, same rule as the workbook.
  assert.match(
    dockerfile.slice(copyIndex),
    /head -c 1 docs\/Reference\/bian\/bian-v14-service-landscape\.json \| grep -q '\{'/,
    "the COPY must be followed by a JSON-shape assertion so a missing or truncated file fails the build",
  );
});

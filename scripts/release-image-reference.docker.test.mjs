// Real-daemon guard for release image addressing (BI-578131A3).
//
// SUR-F2A0D477 refused every release because the portal ran
// `docker run --pull never <configDigest>`. Mocked runDocker tests passed, and
// the N-1 acceptance job runs on the classic image store, where that works. On
// the containerd image store (the Docker Desktop default) it is "No such image".
// This test pulls a real multi-arch image by its index digest and proves the
// resolver returns an id the daemon will run, on whichever store it uses. CI runs
// it once per store (.github/workflows/self-upgrade-acceptance.yml).
//
// Without a reachable daemon it skips, unless DPF_REQUIRE_DOCKER=1.
// DPF_EXPECT_IMAGE_STORE=classic|containerd asserts that CI configured the
// store it claims to test.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePulledReleaseImage } from "../apps/web/lib/self-upgrade/release-image-reference.ts";

const run = promisify(execFile);
const REPOSITORY = "docker.io/library/alpine";
// alpine:3.20.3, frozen like a DPF release: index, per-platform manifest, config.
const CHANNEL_DIGEST = "sha256:1e42bbe2508154c9126d48c2b8a75420c3544343bf86fd041fb7527e017a4b4a";
const PLATFORMS = {
  amd64: { platformManifestDigest: "sha256:029a752048e32e843bd6defe3841186fb8d19a28dae8ec287f433bb9d6d1ad85", configDigest: "sha256:63b790fccc9078ab8bb913d94a5d869e19fca9b77712b315da3fa45bb8f14636" },
  arm64: { platformManifestDigest: "sha256:ea3c5a9671f7b3f7eb47eab06f73bc6591df978b0d5955689a9e6f943aa368c0", configDigest: "sha256:511a44083d3a23416fadc62847c45d14c25cbace86e7a72b2b350436978a0450" },
};

async function docker(args) {
  try {
    const { stdout, stderr } = await run("docker", args, { timeout: 120_000 });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: typeof error.code === "number" ? error.code : 1, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
}

const info = await docker(["info", "--format", "{{json .DriverStatus}}|{{.Architecture}}"]);
const daemon = info.exitCode === 0;
if (!daemon && process.env.DPF_REQUIRE_DOCKER === "1") throw new Error(`docker daemon required but unreachable: ${info.stderr}`);
const [driverStatus = "", hostArch = ""] = info.stdout.trim().split("|");
const store = driverStatus.includes("io.containerd.snapshotter") ? "containerd" : "classic";
const arch = { x86_64: "amd64", amd64: "amd64", aarch64: "arm64", arm64: "arm64" }[hostArch];

test("the daemon uses the image store this job claims to test", { skip: !daemon }, () => {
  const expected = process.env.DPF_EXPECT_IMAGE_STORE;
  if (expected) assert.equal(store, expected, `driver status: ${driverStatus}`);
});

test("a release pulled by its index digest resolves to an id docker run accepts", { skip: !daemon || !arch }, async () => {
  const pulled = await docker(["pull", "--quiet", `${REPOSITORY}@${CHANNEL_DIGEST}`]);
  assert.equal(pulled.exitCode, 0, pulled.stderr);
  const release = { channelDigest: CHANNEL_DIGEST, ...PLATFORMS[arch] };

  const resolution = await resolvePulledReleaseImage(docker, REPOSITORY, release);
  assert.ok(resolution.image, `unresolved on the ${store} store: ${resolution.attempts.join("; ")}`);
  // Engine ids are store-specific; pin which one each store yields so a daemon
  // change that moves it is seen here, not on an install.
  assert.equal(resolution.image.id, store === "containerd" ? CHANNEL_DIGEST : release.configDigest);

  const ran = await docker(["run", "--rm", "--pull", "never", "--network", "none", resolution.image.id, "true"]);
  assert.equal(ran.exitCode, 0, `docker run by the resolved id failed on the ${store} store: ${ran.stderr}`);
});

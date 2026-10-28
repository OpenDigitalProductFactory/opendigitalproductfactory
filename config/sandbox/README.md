# Build Studio sandbox containment

The `sandbox` compose service runs Claude Code, Codex, Grok and OpenCode with
their own approval prompts turned off, so the container is the only boundary
between an agent and everything else. This directory holds that boundary.
It is Phase 2 of the
[agent sandbox containment design](../../docs/superpowers/specs/2026-10-21-agent-sandbox-containment-and-grader-integrity-design.md)
(AC-1 wired, AC-2 staged).

| File | Used by | What it is |
| --- | --- | --- |
| `seccomp.json` | `docker-compose.yml` `sandbox.security_opt` | Docker's default profile ([moby/profiles](https://github.com/moby/profiles/blob/main/seccomp/default.json), sha256 `6416b477…3053f6` as fetched 2026-10-28) with one rule removed: the unconditional allow of `ptrace`, `process_vm_readv` and `process_vm_writev`. The `CAP_SYS_PTRACE`-gated rule stays, and that capability is dropped. |
| `egress-allowlist.txt` | not yet wired | Hosts the sandbox may reach once egress runs through a proxy (AC-2). |
| `tinyproxy.conf` | not yet wired | The deny-by-default forward proxy configuration that reads the allowlist. |

## What the `sandbox` service gets

- `cap_drop: [ALL]`, then `cap_add` of six capabilities. Each one was removed
  in turn and the sandbox broke without it:
  - `CHOWN`: the boot-time `pnpm install` failed with
    `EPERM ... chown '/workspace/node_modules/.pnpm/lock.yaml...'`.
  - `DAC_OVERRIDE`: boot failed restoring `/home/node`, which the root
    entrypoint cannot write into without it.
  - `FOWNER`: `cp -a` of the node home failed with
    `can't preserve permissions`.
  - `SETUID`, `SETGID`: `su node` failed (`setuid: Operation not permitted`).
  - `KILL`: root could not kill a node-owned process
    (`kill: can't kill pid 72: Operation not permitted`).
- `no-new-privileges:true`.
- `seccomp=./config/sandbox/seccomp.json`. Compose resolves the path against
  the compose file's directory. The release bundle ships the file next to
  `docker-compose.yml` (see `Dockerfile`, `/dpf-release-assets/config/sandbox/`).
- `read_only: true`. Writable paths are the `/workspace` volume and three
  tmpfs mounts: `/tmp` (2 GiB), `/root` (512 MiB) and `/home/node` (2 GiB).
  All three are mounted `exec`, because the portal runs its runner scripts
  directly from `/tmp` and corepack runs pnpm from the home cache. They empty on
  every container restart. The image keeps its built homes under
  `/opt/dpf-home-seed`, and `scripts/sandbox-entrypoint.sh` restores them
  (codex config, git identity, the pre-seeded OpenCode provider) into an empty
  home.
- Engines provisioned at runtime (`provisionBuildEngine`, an admin action) go
  to their own prefix, `/opt/dpf-engines/provisioned`, which is the
  `sandbox_engines` volume. `/usr/local` stays read-only, because a volume over
  it would hide or freeze the image's node. `npm-global` recipes run
  `npm install -g --prefix /opt/dpf-engines/provisioned`, and prestaged and
  curl-installer recipes write to `/opt/dpf-engines/provisioned/bin`.
  `Dockerfile.sandbox` appends that directory to `PATH`, so the readiness
  probes (`docker exec <sandbox> <engine> --version`) find it. A baked engine
  still wins over a provisioned copy that an older image left on the volume.
  The volume sits below `/opt/dpf-engines` rather than replacing it, because
  that directory holds the image's prestaged binaries, and a named volume would
  freeze them at whatever the first image put there.

AppArmor is not set. Docker applies its default AppArmor profile on hosts that
support it. The verification host did not support AppArmor, so a stricter DPF
profile is left for a host that can test it.

## How the profile reaches an install

Compose loads `seccomp.json` on the client side, relative to the project
directory, so the file has to be on disk wherever compose runs.

- **Source and dev installs** (`install-dpf.sh`, `promote.sh` source mode,
  where `_compose_root=$PROMOTE_SOURCE`) run compose from the checkout, which
  contains `config/sandbox/`.
- **Consumer install** (`install-dpf.ps1`, `Export-DPFConsumerReleaseAssets`):
  `docker cp <image>:/dpf-release-assets/.` into a staging dir,
  `Test-DPFReleaseAssetManifest -RejectUnlisted`, then `Copy-Item -Recurse`
  of the whole staging dir into the install dir.
- **Self-upgrade** (`promote.sh` release mode): the candidate image's
  `/dpf-release-assets` is exported and checked with `sha256sum -c SHA256SUMS`,
  then becomes `_compose_root`. The sandbox refresh (step 7b) runs
  `docker compose --project-directory "$_compose_root" ... up sandbox` against
  it. `install-release-assets.mjs` then writes every `SHA256SUMS` entry into the
  install root, creating parent directories.

All three paths ship exactly the files in the bundle. `Dockerfile` copies
`seccomp.json` into `/dpf-release-assets/config/sandbox/` before it generates
`SHA256SUMS`, and the contract test holds that order.

## Verification record (2026-10-28)

The image was built from `Dockerfile.sandbox` and booted with these exact
settings. The real `sandbox-entrypoint.sh` ran against a small pnpm workspace:
corepack fetched pnpm into the tmpfs home, `pnpm install --frozen-lockfile`
ran, prisma generate ran, and the dev server served. 26 checks passed:

- **Portal operations:** `ensureSandboxNodeUser` (`chown -R` and
  `su node git config`), writing, chowning and chmod-ing a node-owned file as
  root, `pkill` of a node-owned process.
- **Agent CLIs as node:** `claude`, `codex`, `grok` and `opencode --version`;
  a git commit in `/workspace/.builds`; `git clone` over HTTPS; `pnpm add`;
  a runner script executed from `/tmp`.
- **Refused:** writing to `/etc` or `/usr/local/bin` (`Read-only file system`),
  `mount`, `unshare -Urm`, `chroot`, `su` from node, raw sockets
  (`ping: permission denied`), and `strace` (allowed under Docker's default
  profile, refused under this one).
- **Capped:** `yes > /tmp/fill` stopped at the tmpfs cap
  (`No space left on device`).

### Egress (AC-2) mechanism, verified but not wired

The same image ran on a Docker `--internal` network whose only way out was
tinyproxy with `tinyproxy.conf` and `egress-allowlist.txt`. 12 checks passed:

- **Blocked:** direct egress was unroutable.
- **Allowed through the proxy:** `registry.npmjs.org`,
  `git ls-remote https://github.com/...`, `pnpm add`, and Node `fetch`
  (with `NODE_USE_ENV_PROXY=1`).
- **Refused with 403:** `example.com`, `1.1.1.1`, `pypi.org`,
  `github.com.evil.example`, and CONNECT to port 8443.
- **Still reachable:** a peer on the internal network by name, and the
  preview port through a socat relay. Internal networks cannot publish ports.

Wiring this into `docker-compose.yml` needs work that this change does not do:

- **New services:** a proxy service and a preview relay service. Each needs an
  image published or pinned for release installs and an entry in the service
  classification and resource-budget registries.
- **Network changes:** `portal` and `sandbox-postgres` must join the sandbox's
  internal network, and `host.docker.internal` and
  `model-runner.docker.internal` must be reached through the proxy.
- **Client checks:** confirm on a full install that the Grok and OpenCode
  binaries honour `HTTPS_PROXY`.

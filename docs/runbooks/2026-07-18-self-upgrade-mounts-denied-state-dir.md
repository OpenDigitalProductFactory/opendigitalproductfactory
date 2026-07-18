# Self-upgrade fails at `step=migrate` with "mounts denied" (DPF_STATE_DIR)

**Symptom.** A self-upgrade builds the portal image cleanly (`Successfully tagged
dpf-portal:latest`), reaches `step=migrate`, and dies. The `SelfUpgradeRun.failureLog`
tail shows:

```
step=migrate target=<sha>
Error response from daemon: mounts denied:
The path /root/.dpf is not shared from the host and is not known to Docker.
```

Each failure arms a 30-minute cooldown, so the upgrade looks permanently stuck.
Classifier class: `docker-mount-denied`.

## Root cause (#3262)

The portal service mounts the runtime state dir:

```yaml
- ${DPF_STATE_DIR:-${HOME}/.dpf}:/dpf-state:ro
```

`/dpf-state` holds signed capability-transition receipts **and** `install-state.json`,
so it must point at the operator's real `~/.dpf`. On a normal `docker compose up`
(operator shell) `${HOME}/.dpf` resolves correctly. But the self-upgrade **promoter
runs as root**, so `${HOME}=/root` — and when `DPF_STATE_DIR` is unset the mount
resolves to `/root/.dpf`, which Docker Desktop (macOS/Windows) refuses to share.
`DPF_STATE_DIR` shipped in #3262 without being added to `.env.example` or written by
the installer, so every Docker Desktop install fell into the fallback. (Linux-native
Docker has no file-sharing gate and is unaffected.)

## Fix — per install (unblocks now)

Run the repair script from the install directory — it pins `DPF_STATE_DIR` to an
absolute, Docker-Desktop-shared path, verifies Docker can share it, and is
idempotent:

```sh
scripts/repair-self-upgrade-state-dir.sh          # or: … /path/to/install
```

Then re-trigger the upgrade (Self-Upgrade page → Emergency override). To do it by
hand instead, add to `.env`:

- macOS: `DPF_STATE_DIR=/Users/<user>/.dpf`
- Windows: `DPF_STATE_DIR=C:\Users\<user>\.dpf`

Verify the path is shareable before re-triggering:

```sh
docker run --rm --entrypoint sh -v /Users/<user>/.dpf:/dpf-state:ro dpf-promoter:latest -c 'ls /dpf-state'
```

`mounts denied` means the path is not shared (Docker → Settings → Resources → File
Sharing); a clean listing means you're good.

## Fix — durable (this PR)

- `install-dpf.sh` / `install-dpf.ps1` now write `DPF_STATE_DIR` (absolute `~/.dpf`)
  into `.env` on both fresh and existing installs.
- `.env.example` documents `DPF_STATE_DIR` (+ the other mount host-path vars).
- `scripts/check-compose-env-contract.mjs` (CI: **Compose Env Contract Guard**) fails
  any future PR whose compose volume host-path references an undocumented `DPF_*`
  var or uses a shell var (`HOME`/`USER`/…) as the primary path — the exact #3262
  shape — before it can reach the fleet.
- The build-failure classifier now recognizes `mounts denied` and names the fix.

---
name: Install verification report
about: Tried install-dpf.sh on macOS or Linux? Tell us how it went.
title: "Install verification — "
labels: ["install-verification", "community-report"]
assignees: []
---

<!-- Thank you for trying the early-access macOS / Linux installer!
     The information below helps us close the gap between "we believe
     it works" and "we've seen it work on real hardware." Partial
     reports are useful too — fill in what you can. -->

## Quick fingerprint

**Platform:** <!-- macOS / Linux -->
**OS version:** <!-- e.g. macOS 14.5, Ubuntu 22.04.4, Debian 12.6, Fedora 39 -->
**Architecture:** <!-- arm64 / x86_64 -->
**Hardware notes:** <!-- e.g. M2 Pro MacBook Air; bare-metal Ryzen; AWS t3.large; etc. -->

Paste the output of (one block, redact anything you don't want public):

```
uname -a
# macOS:
sw_vers 2>/dev/null
# Linux:
cat /etc/os-release 2>/dev/null | head -5

docker --version 2>/dev/null
docker compose version 2>/dev/null
node -v
pnpm -v
grep DPF_INSTALLER_VERSION install-dpf.sh
```

<details>
<summary>Environment output</summary>

```
<paste here>
```

</details>

## How it went

**Install command used:**

```bash
# e.g. bash install-dpf.sh
# or:  bash install-dpf.sh --headless --release
```

**Outcome:** <!-- pick one -->
- [ ] Installed cleanly; portal at `http://localhost:3000` reachable; login worked
- [ ] Installed with warnings (described below)
- [ ] Hit a wall — install did not complete

## Runbook checklist

Tick the boxes for steps you observed working. Skipped steps are
fine — leave them unchecked.

<!-- See docs/install/verification-runbook.md for context on each. -->

**Preflight + install:**
- [ ] Preflight passed (no unsupported-host refusal)
- [ ] Port-conflict preflight passed
- [ ] Docker auto-install completed (Docker Desktop `.dmg` on macOS / Docker Engine via `apt`/`dnf` on Linux)
- [ ] `~/.dpf/install-state.json` exists with `"schemaVersion": 1`
- [ ] `docker compose -p dpf ps` shows expected services running
- [ ] `curl http://localhost:3000/api/health` returned 200
- [ ] Login at the portal with `admin@dpf.local` succeeded

**Autostart:**
- [ ] LaunchAgent (macOS) `~/Library/LaunchAgents/local.dpf-autostart.plist` present
- [ ] OR systemd-user unit (Linux) `~/.config/systemd/user/dpf.service` present + enabled
- [ ] **Rebooted host; portal came back at `localhost:3000` within 60 seconds**

**Discovery / observability (optional but valuable):**
- [ ] Discovery sweep emitted real installed-software rows (`pkgutil` on macOS, `dpkg`/`rpm` on Linux)
- [ ] Prometheus targets at `http://localhost:9090/api/v1/targets` show `health: "up"`
- [ ] Grafana at `http://localhost:3002` reachable

**Lifecycle:**
- [ ] `bash dpf-stop.sh && bash dpf-start.sh` round-tripped cleanly
- [ ] `bash uninstall-dpf.sh --purge --yes` removed volumes + state + `.env`

## Diagnostic bundle

Please attach the diagnostic bundle. Secrets are redacted automatically:

```bash
bash install-dpf.sh doctor
# Then drag-and-drop ~/.dpf/doctor-<timestamp>.tar.gz into this issue.
```

## Anything else

<!-- Surprises, papercuts, copy issues in the install output, anything
     unexpected. Failure reports are equally valuable — tell us where
     it broke and what the error said. -->

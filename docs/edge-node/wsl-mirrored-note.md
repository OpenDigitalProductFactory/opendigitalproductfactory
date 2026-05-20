# WSL2 Mirrored Networking and the DPF Edge Node

**Short answer:** if you've heard that WSL2 mirrored networking unlocks LAN visibility for Docker containers on Windows — it does for WSL distros, but not for Docker Desktop containers. The DPF installer does not configure it. This note explains why, what it actually does, and when an operator might still want to enable it.

## What WSL2 mirrored networking does

Microsoft shipped this mode in WSL 2.0 (Sept 2023). With `networkingMode=mirrored` in `%USERPROFILE%\.wslconfig`, the WSL2 VM stops NAT-ing and instead mirrors the Windows host's NICs into the WSL distribution. Inside any WSL distro (Ubuntu, etc.) `ip addr` then shows interfaces that match the host. mDNS works across the host/WSL boundary. DNS resolves through the host's resolver.

## What it doesn't do

It doesn't reach Docker containers. When Docker Desktop is the container engine, containers — even with `network_mode: host` — live in **Docker Engine's own host namespace**, which on Docker Desktop is the internal `192.168.65.0/24` services network (managed by vpnkit). That namespace is separate from the underlying `docker-desktop` WSL distro's networking, and mirrored mode doesn't cross the Docker Engine boundary.

We verified this on a Win 11 22H2 + WSL 2.6.3 + Docker Desktop 4.34+ install on 2026-05-20:

```text
Windows host:                eth0 = 192.168.0.200/24    (real LAN)
docker-desktop WSL distro:   eth1 = 192.168.0.200/24    (mirrored ✓)
Edge Node container
  with network_mode: host:   eth0 = 192.168.65.3/24     (Docker services only ✗)
```

The container saw 192.168.65.x. The docker-desktop distro saw 192.168.0.x. Mirrored mode worked at the distro level; it stopped at the engine boundary.

## What the DPF Edge Node uses instead

- **Linux hosts:** the existing `linux-host-network` profile gives the container `network_mode: host`, and on Linux that means the actual host namespace. Real LAN visibility — no extra configuration.
- **Windows + macOS hosts:** the Mode 4 native binary (per the [2026-05-16 Edge Node runtime decision ADR](../superpowers/specs/2026-05-16-edge-node-runtime-decision.md)). It runs as a Windows Service / macOS LaunchDaemon, reads the real host's NICs directly, no Docker translation layer.

The deployment matrix at [`docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md`](../superpowers/specs/2026-05-20-edge-node-deployment-matrix.md) lays out the per-platform recommendation.

## When you might want to enable WSL mirrored networking anyway

Even though it doesn't help the Edge Node, mirrored mode is independently useful for:

- **WSL development workflows.** `localhost` from a WSL distro reaches host services without NAT shenanigans.
- **mDNS / Bonjour from WSL.** Service discovery works across the WSL/Windows boundary.
- **Some VPN clients that resolve only through the host's network stack.**
- **DNS issues** where the WSL NAT-mode resolver gets confused on corporate networks.

If you want it, write this to `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
firewall=true
dnsTunneling=true
autoProxy=true
```

Then `wsl --shutdown` and let WSL come back up. Restart Docker Desktop if you have it running.

**Do not** expect this to give the Edge Node container real-LAN visibility. It won't.

## Reference

- Microsoft docs: [WSL mirrored mode networking](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking)
- Spec: [`docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md`](../superpowers/specs/2026-05-20-edge-node-deployment-matrix.md) §4
- ADR: [`docs/superpowers/specs/2026-05-16-edge-node-runtime-decision.md`](../superpowers/specs/2026-05-16-edge-node-runtime-decision.md)

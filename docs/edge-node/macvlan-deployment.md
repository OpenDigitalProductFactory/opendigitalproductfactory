# Edge Node — macvlan / ipvlan deployment (Linux)

This page covers an **optional** alternative to running the Edge Node container with `network_mode: host`. macvlan gives the container its own IP on the LAN — it appears to peer devices as a fully independent machine, distinct from the Docker host. ipvlan is the same idea over a single MAC (Wi-Fi compatible).

The bundled overlay is `docker-compose.edge.macvlan.yml`. The default Phase 0 path remains host networking, which is simpler and sufficient for most installs.

## When to choose this over host networking

| Driver factor | Host networking | macvlan / ipvlan |
|---|---|---|
| Setup complexity | Nearly zero | Must edit overlay with your CIDR, gateway, parent NIC, reserved IP |
| ARP-visible from peers as a distinct device? | No (looks like the host) | Yes (own MAC + IP for macvlan; own IP for ipvlan) |
| Host can talk to the container? | Yes, trivially | No (kernel forbids it — workaround exists) |
| Works on Wi-Fi? | Yes | macvlan often fails (AP MAC filtering); ipvlan usually works |
| Works on Docker Desktop (Win/Mac)? | **No** (use mirrored WSL or Mode 4 binary) | **No** (parent NIC resolves to the VM's vNIC) |
| Default port conflicts with other host services? | Possible (shares host's namespace) | Avoided (own IP) |

**Pick host networking unless one of these applies:**
- You want LAN-level identity separation (the edge node appears as its own device, not "the same MAC as my server").
- A different process on the host already owns ports the edge node would want.
- You're running multiple edge nodes on the same host and need each to look distinct on the LAN.

## How macvlan and ipvlan differ

Both attach a container to a physical NIC. The difference is the L2 identity:

- **macvlan** — container gets its own MAC. Peer devices ARP and see a distinct MAC + IP. Cleanest "first-class LAN citizen" semantics. Many Wi-Fi APs drop frames from unfamiliar MACs, so macvlan usually only works over wired Ethernet.
- **ipvlan L2** — container shares the host's MAC, gets its own IP. Peers see the host's MAC for both the host and the container. Works on Wi-Fi because the AP only sees the one authenticated MAC. Slightly worse for network forensics (host vs container traffic harder to distinguish).
- **ipvlan L3** — routed mode; container's IP is reachable only via the host. Less useful for discovery (broadcasts don't propagate cleanly).

The bundled overlay defaults to **ipvlan L2** because more operators have Wi-Fi than wired. Switch to macvlan in the overlay if you're on wired and want a separate MAC.

## Setup

1. **Identify your network:**
   ```bash
   ip addr            # find your NIC name + IP
   ip route            # find your gateway
   ```

2. **Pick a reserved IP outside your DHCP pool.** If your router hands out 192.168.0.100–200, reserve something like 192.168.0.50. Otherwise the macvlan container may collide with a DHCP-assigned device.

3. **Edit `docker-compose.edge.macvlan.yml`:**
   ```yaml
   lan_macvlan:
     driver: ipvlan                        # or macvlan if you're on wired Ethernet
     driver_opts:
       parent: enp3s0                      # your NIC name from `ip link`
     ipam:
       config:
         - subnet: 192.168.0.0/24          # your LAN CIDR
           gateway: 192.168.0.1            # your LAN gateway

   services:
     edge-node-macvlan:
       networks:
         lan_macvlan:
           ipv4_address: 192.168.0.50      # the IP you reserved
   ```

4. **Set `DPF_AUTHORITY_URL` in `.env`** to the host's LAN address — the macvlan container can't reach `host.docker.internal` or `localhost` because the kernel blocks host-talk (next section):
   ```
   DPF_AUTHORITY_URL=http://192.168.0.10:3000
   ```
   …where 192.168.0.10 is your DPF host's actual LAN IP.

5. **Bring it up:**
   ```bash
   docker compose -f docker-compose.yml \
                  -f docker-compose.linux.yml \
                  -f docker-compose.edge.macvlan.yml \
                  --profile macvlan up -d edge-node-macvlan
   ```

## The host-talk limitation + workaround

This is the most surprising thing about macvlan/ipvlan and bites everyone the first time. The Linux kernel deliberately drops traffic between a host and a macvlan child that share the same parent NIC. The container can ping every other device on the LAN — except the host it's running on.

For an Edge Node, this matters when it needs to reach the Authority Core (the DPF portal) on the same host.

**Workaround:** create a second macvlan interface on the host side, bridged to the same parent NIC. The host uses this auxiliary interface to talk to the macvlan container; container uses its own interface to reply.

```bash
# Pick a host-side IP also outside your DHCP pool (different from the container's IP).
sudo ip link add macvlan-host link enp3s0 type macvlan mode bridge
sudo ip addr add 192.168.0.49/32 dev macvlan-host
sudo ip link set macvlan-host up
sudo ip route add 192.168.0.50/32 dev macvlan-host

# Persist via your distro's network manager — netplan / NetworkManager / systemd-networkd.
```

After this the host can `curl http://192.168.0.50:8080/` (or whatever the container exposes) and the container can `curl http://192.168.0.49:3000/` (the host's auxiliary IP) to reach the Authority Core. Then set `DPF_AUTHORITY_URL=http://192.168.0.49:3000` in `.env` instead of the host's primary LAN IP.

This is fragile (the route gets lost on reboot unless persisted) and adds operational complexity. It's why host networking is the documented default for the common case.

## Wi-Fi caveats

- **macvlan over Wi-Fi rarely works.** Most consumer APs authenticate one MAC per client (the host's) and drop frames from any other MAC on the same association. Some enterprise APs in WPA2/3 Enterprise mode pass multiple MACs through, but the consumer ecosystem is hostile.
- **ipvlan L2 over Wi-Fi works.** Single MAC seen by the AP; the container's traffic goes out as the host's MAC. Multicast (mDNS, SSDP) may still be limited by the AP if AP-client-isolation is enabled.
- If you want full-fidelity LAN discovery over Wi-Fi (broadcast, mDNS) and your AP supports it, **disable AP-client-isolation / wireless isolation** in the AP's admin UI. Search for "wireless isolation," "AP isolation," "L2 isolation," or "client-to-client traffic."

## Reference

- Docker docs: [macvlan network driver](https://docs.docker.com/network/drivers/macvlan/), [ipvlan network driver](https://docs.docker.com/network/drivers/ipvlan/)
- Spec: [`docs/superpowers/specs/2026-05-20-edge-node-deployment-matrix.md`](../superpowers/specs/2026-05-20-edge-node-deployment-matrix.md) § 5
- Overlay: [`docker-compose.edge.macvlan.yml`](../../docker-compose.edge.macvlan.yml)

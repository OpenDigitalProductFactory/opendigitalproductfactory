---
status: draft
---

# Host-published ports bind to loopback by default

**Backlog item:** BI-FEE77B68
**Kernel decision:** DI-946636F6E8F6 (loopback default for every install mode; margin 0.86, high confidence)
**Profile:** fix

## Problem and reproduced cause

At commit `961ef9c8cf` (main, 2026-09-05), `docker-compose.yml:130-131` publishes the portal with short-syntax mappings (`"3000:3000"`, `"1455:3000"`). Compose binds short syntax to every interface. On the running development install `docker ps` shows `0.0.0.0:3000->3000/tcp`, and the same is true for postgres (`5432`), the sandbox (`3035`), redis (`6379`) and inngest (`8288-8289`). Only the step-ca ports (`636`, `9000`) are bound to `127.0.0.1`. GitHub issue #4337 reported the portal half from bare-metal Ubuntu with `curl http://<lan-ip>:3000/api/health` returning 200.

A second, related defect surfaced while verifying BI-899D7F00 on the same install: `GET /api/automation/sign-in?token=...` sent to `localhost:3000` answers `303 Location: http://0.0.0.0:3000/...`. The route builds its redirect from `request.nextUrl.origin`, and the standalone Next server derives that origin from the `HOSTNAME=0.0.0.0` it binds (`Dockerfile:292`), not from the `Host` header. The repository already has the correct resolver, `apps/web/lib/portal-url.ts` (`PUBLIC_URL` → forwarded host → `Host` header), and the sign-in route does not use it.

Candidate causes ruled out by running them:

- Compose `ports` long syntax with `host_ip` is not required: `"${VAR:-127.0.0.1}:3000:3000"` short syntax with a variable host part is accepted by Compose v2 (verified with `docker compose config` in the guard test fixture).
- The canonical-host middleware (`apps/web/lib/canonical-host.ts`) does not cause the `0.0.0.0` redirect: it only acts when `PUBLIC_URL` is set, and it is unset on this install.

## Objectives and acceptance criteria

1. A fresh install publishes every host port on `127.0.0.1` unless the operator opts into LAN exposure.
2. An existing install keeps the exposure it has today: the upgrade writes `DPF_HOST_BIND_ADDRESS=0.0.0.0` into its `.env` when the key is absent, so nobody loses LAN access silently, and the installer says so.
3. One `.env` value, `DPF_HOST_BIND_ADDRESS`, controls the host side of every published port in `docker-compose.yml`; the value is upgrade-safe because `.env` is operator-owned.
4. A guard fails CI when any `ports:` mapping in `docker-compose.yml` publishes without the variable, so the posture cannot regress by adding a new service.
5. In-app absolute redirects come from `portal-url.ts`, not `request.nextUrl.origin`; the sign-in route is fixed here and a follow-up covers the other 58 call sites.
6. The install guide states what is reachable on the network after a default install and how to opt into LAN exposure.

## Ordered fix sequence

1. `scripts/check-compose-bind-posture.mjs` + test: parse `docker-compose.yml`, fail on any `ports:` entry whose host part is not `${DPF_HOST_BIND_ADDRESS:-127.0.0.1}` (the local-CI overlay is exempt: it publishes on a slot port from the admitted manifest and stays loopback by construction). Register in `scripts/lib/ci-policy-guards.mjs`. The guard fails on the current tree; that is the failing-first proof.
2. `docker-compose.yml`: rewrite every published port as `"${DPF_HOST_BIND_ADDRESS:-127.0.0.1}:<host>:<container>"`. `.env.example`: declare `DPF_HOST_BIND_ADDRESS` with the two supported values and the reason.
3. `scripts/installer/install-release-assets.mjs` `updateEnv`: when `.env` already exists and lacks the key, append `DPF_HOST_BIND_ADDRESS=0.0.0.0` with a comment naming this decision; when `.env` is new, append `127.0.0.1`. Tests in `install-release-assets.test.mjs`.
4. `apps/web/app/api/automation/sign-in/route.ts`: build the redirect from `getPortalUrl()`.
5. `docs/install/*` and `docs/user-guide` (whichever guide the docs-impact gate maps): default exposure statement and the opt-in line.
6. Follow-up for the remaining 58 `request.nextUrl.origin` call sites: BI-48092F3A.
7. `scripts/promote.sh` (BI-55A30F8B, found on the first production self-upgrade after step 2 shipped): the promoter recreates the portal in its step 4, but step 3 above only runs in its step 7, so the first promotion binds every port to loopback with the old `.env` and a LAN install goes dark. Before any compose command, when the compose env file predates the key, the promoter exports `DPF_HOST_BIND_ADDRESS=0.0.0.0` (process environment wins over `--env-file`) and emits `step=host-bind-address-preserved`. An env file that carries the key, or an operator-set variable, is left alone. Test `promote-host-bind-address.test.mjs`, registered in the self-upgrade acceptance workflow.

## Boundaries

- No change to the edge-standalone overlay: an edge node on another machine has its own compose file and its LAN purpose is stated there.
- The OS overlays (`docker-compose.linux.yml`, `docker-compose.macos.yml`) are not rewritten in this change; the ollama port (`11434`) they publish stays as declared and is the first item for BI-48092F3A's sibling follow-up once the base file has settled. The guard covers `docker-compose.yml` only, on purpose, so the scope of this PR is one file plus its manifest mirror.
- No change to `PUBLIC_URL` semantics.
- `HOSTNAME=0.0.0.0` inside the container stays; the container must listen on all interfaces of its own network namespace for Compose to publish it.

## Rollback

Set `DPF_HOST_BIND_ADDRESS=0.0.0.0` in `.env` and `docker compose up -d`. No schema, no data.

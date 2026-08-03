# Title: Enforce host free-space floor before builds start
# Context
When the host machine runs out of disk space, docker containers crash, sometimes with SIGBUS, corrupting or crashing local DBs and portals. We should prevent builds from initiating when disk space falls below a defined minimum floor (configurable, 20GB default).
# Design
1. Determine the Docker data drive. For local-CI, this defaults to 'G:' on Windows or falls back to checking the default C: drive.
2. In the build preflight gate `scripts/local-integration-ci.mjs` and `scripts/pregate.mjs`, add a function `checkHostDiskSpace()` from `scripts/lib/disk-space-preflight.mjs`.
3. If free space is less than `DPF_MIN_DISK_GB` (default 20), exit with an error.

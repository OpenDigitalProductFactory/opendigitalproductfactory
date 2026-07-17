# Postgres Exporter Config Warning Plan

## Goal

Stop the benign `postgres_exporter.yml` missing-config warning at startup without changing the exporter from its existing single-target `DATA_SOURCE_NAME` mode.

## Current state

- `docker-compose.yml` starts `prometheuscommunity/postgres-exporter:v0.19.1` with `DATA_SOURCE_NAME` only.
- `install-dpf.ps1` generates a compose file with the same missing config surface for fresh installs.
- The warning is not platform-specific: it comes from the exporter default config lookup, not from a Windows/macOS/Linux bind mount quirk.

## Implementation

1. Add a minimal `monitoring/postgres-exporter/postgres_exporter.yml` with an empty `auth_modules` map.
2. Mount that config into the postgres-exporter service and pass `--config.file=/postgres_exporter.yml` explicitly.
3. Update the Windows installer's generated compose and monitoring file creation so fresh installs converge to the same runtime shape.
4. Lock the source invariant with a targeted compose/runtime test.

## Verification

- Run the targeted compose/runtime test.
- Render `docker compose config`.
- Start the exporter image with the mounted config and confirm the missing-config warning is gone.
- Run `pnpm --filter web build`.

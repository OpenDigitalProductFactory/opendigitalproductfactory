# Windows Local-CI Typecheck Heap

## Backlog

- `BI-LOCAL-CI-WINDOWS-TYPECHECK-HEAP` - Windows local-CI typecheck omits required Node heap headroom and exits 134.

## Problem

The local-CI plan already gives the host Next build an 8 GiB V8 heap via `NODE_OPTIONS=--max-old-space-size=8192`, but the Windows `docker-build` strategy still planned a plain `pnpm --filter web typecheck`. On Windows hosts, that leaves `tsc --noEmit` at the Node default heap and can terminate with exit 134 before the product gate produces useful evidence.

## Plan

1. Add a contract test that Windows local-CI plans the web typecheck through a heap-aware wrapper instead of the plain `pnpm --filter web typecheck` command.
2. Add a small Node wrapper that appends requested options to `NODE_OPTIONS` and then delegates to the existing command.
3. Keep the canonical typecheck entrypoint unchanged so package scripts and CI parity stay in one place.
4. Verify the plan contract and wrapper behavior with `node --test`.

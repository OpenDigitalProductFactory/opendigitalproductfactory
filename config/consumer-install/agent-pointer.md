# DPF consumer runtime install

This directory contains installed runtime assets. It is not a source repository
or checkout. Do not edit these files as if they were platform source.

Connect through the MCP endpoint configured for this install and follow the
server instructions returned at connection time. Those instructions are the
authoritative contract for this install and your token's authority. They state
this installation's environment class, purpose, paired peer, and the limits that
follow. If MCP is unreachable, treat this install as production and change
nothing.

For code changes, use a separate DPF source checkout and governed worktree. That
checkout's own `AGENTS.md` is the canonical operating contract for source work —
read it in full before you plan or edit anything. It will not reach you on its
own: it lives outside this directory, so nothing here loads it and nothing warns
you that it is missing.

Backlog items live only in this database. Capture them before any teardown:
`pnpm --filter @dpf/db backlog:capture -- --out <directory>`.

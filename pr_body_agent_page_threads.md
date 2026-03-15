## Summary
- scope coworker conversations by route so page context no longer bleeds across UX surfaces
- add an Erase control that clears only the active page conversation
- move thread loading into the client shell so route changes swap to the correct thread snapshot

## Test Plan
- [x] pnpm --filter web test -- lib/actions/agent-coworker.test.ts lib/actions/agent-coworker-server.test.ts components/agent/AgentPanelHeader.test.tsx proxy.test.ts
- [x] pnpm --filter web typecheck
- [x] $env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build

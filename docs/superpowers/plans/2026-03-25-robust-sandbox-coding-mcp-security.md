# Plan: Robust Sandbox Coding & MCP Security

**Spec:** `docs/superpowers/specs/2026-03-25-robust-sandbox-coding-mcp-security-design.md`
**Epic:** EP-CODEGEN-001 (Build Studio Code Generation Tools)
**Status:** Implemented (2026-03-25)

## Implementation Summary

All 15 backlog items completed. TypeScript check and production build pass.

### Backlog Items (EP-CODEGEN-001)

| Item ID | Title | Status |
|---------|-------|--------|
| BI-CODEGEN-001 | Fix false fabrication detection for sandbox tools | Done |
| BI-CODEGEN-002 | Add test-failure recovery workflow to build prompts | Done |
| BI-CODEGEN-003 | Add gatherCodeContext() for context-aware codegen | Done |
| BI-CODEGEN-004 | Add diagnoseTestFailures() for structured diagnostics | Done |
| BI-CODEGEN-005 | Replace iterate_sandbox stub with real implementation | Done |
| BI-CODEGEN-006 | Enhance generate_code with context gathering | Done |
| BI-CODEGEN-007 | Add auto_fix loop to run_sandbox_tests | Done |
| BI-CODEGEN-008 | Switch build pipeline to agentic loop | Done |
| BI-CODEGEN-009 | Persist test results instead of swallowing failures | Done |
| BI-CODEGEN-010 | Add coding event types to agent-event-bus | Done |
| BI-CODEGEN-011 | Inject build progress into coworker context | Done |
| BI-CODEGEN-012 | Production build gate verification | Done |
| BI-CODEGEN-013 | Seed default MCP servers for sandbox coding | Done |
| BI-CODEGEN-014 | Security: scope MCP servers to sandbox, block production bypass | Done |
| BI-CODEGEN-015 | Remove duplicate Playwright MCP server from seed | Done |

### Verification

- `tsc --noEmit`: Pass (0 errors)
- `next build`: Pass (all pages compiled)
- `vitest run` (affected files): 26/26 pass
- Pre-existing test failures (customer-endpoints, recurring): Not caused by this change

### Future Work (Epic Placeholders)

- **EP-MCP-SANDBOX-EXEC**: Route stdio MCP server execution through `docker exec` into sandbox container
- **EP-MCP-TOOL-PERMS**: Per-MCP-tool capability gating
- **EP-PROMOTE-ENFORCE**: Enforce destructive operation blocking in promotion flow

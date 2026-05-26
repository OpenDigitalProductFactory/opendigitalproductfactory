# Feedback Support Mode Entry Verification

Date: 2026-05-26

## Automated checks

Prisma client generation:

```sh
pnpm install
```

Result: passed. The worktree had no `node_modules`; install reused the pnpm
store and ran `packages/db postinstall: prisma generate` successfully.

Focused Phase 1 regression suite:

```sh
pnpm --filter web exec vitest run lib/feedback/feedback-event.test.ts components/feedback/FeedbackButton.test.tsx components/feedback/HeaderFeedbackButton.test.tsx components/agent/AgentCoworkerShell.test.tsx lib/actions/feedback-support.test.ts lib/quality/platform-issue-reports.test.ts app/api/quality/report/route.test.ts lib/actions/quality.test.ts
```

Result: passed.

- Test files: 8 passed.
- Tests: 55 passed.

TypeScript:

```sh
pnpm --filter web exec tsc --noEmit
```

Result: passed after regenerating the Prisma client for the rebased `main`
schema.

Full web Vitest gate:

```sh
cd apps/web && pnpm test
```

Result: passed on the rebased branch.

- Test files: 999 passed, 4 skipped.
- Tests: 8339 passed, 15 skipped, 18 todo.

Production build:

```sh
cd apps/web && pnpm exec next build
```

Result: passed. Build completed with pre-existing Edge Runtime warnings about
Node APIs imported by platform version/discovery paths.

Prisma schema validation:

```sh
pnpm --filter @dpf/db exec prisma validate
```

Result: passed.

## Migration check

Applied to the local live Postgres container:

```sh
pnpm --filter @dpf/db exec prisma migrate deploy
```

Result: passed.

- Datasource: PostgreSQL database `dpf`, schema `public`, at `127.0.0.1:5432`.
- Applied migration: `20260526000000_add_issue_report_support_context`.
- Prisma reported all migrations successfully applied.

## Production-path runtime

Rebuilt the Docker-served live portal from this worktree and recreated the live
portal services without dropping volumes:

```sh
docker compose --env-file D:\DPF\.env build --no-cache portal-init portal
docker compose --env-file D:\DPF\.env up -d --force-recreate portal-init portal
```

Result: passed. `dpf-portal-1` and `dpf-postgres-1` were healthy before browser
verification.

## Live UX verification

Browser route: `http://localhost:3000/build`.

Steps:

1. Logged in as `admin@dpf.local`.
2. Opened `/build`.
3. Clicked visible `Feedback`.
4. Waited for `[data-agent-panel="true"]`.
5. Verified support-mode copy was visible.
6. Verified no category form was visible.

Result: passed.

Observed browser state after click:

```json
{
  "url": "http://localhost:3000/build",
  "feedbackCountAfterLogin": 2,
  "supportVisibleAfterLogin": true,
  "categoryCountAfterLogin": 0,
  "fallbackSelectAfterLogin": 0
}
```

Postgres proof:

```sql
select "reportId", status, "routeContext", "triggerKind", "threadId",
       "supportSessionId", "featureBuildId", "createdAt"
from "PlatformIssueReport"
where status = 'support_triage'
order by "createdAt" desc
limit 1;
```

Result:

```text
PIR-5XDEW | support_triage | /build | manual | cmpiqce8s04g901o6tvepvzjc | dpf_support_be2e0d6d5dea9e097a3baa1cf4767dd9 | null | 2026-05-26 08:00:15.162
```

Notes:

- The live `/build` route rendered its existing error boundary with
  `Cannot read properties of undefined (reading 'toLowerCase')` before the
  Feedback click. The Phase 1 support entry still satisfied the acceptance path:
  support copy opened in the existing coworker shell, no category form appeared,
  and the local report captured route, trigger, thread, support session, and
  `support_triage` status.

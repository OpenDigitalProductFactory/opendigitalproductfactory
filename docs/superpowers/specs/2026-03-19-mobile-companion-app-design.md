# Mobile Companion App — iOS & Android

**Date:** 2026-03-19
**Status:** Draft
**Depends on:** REST API layer (Epic 1, built as prerequisite)

---

## Overview

A native iOS and Android companion app for the Open Digital Product Factory platform, enabling all authenticated users to access workspace dashboards, manage backlogs, converse with AI co-worker agents, handle governance approvals, manage customers, and view portfolio health — all from their phone.

The app also includes a dynamic content rendering engine that displays custom forms and views defined in the web portal, enabling field workers to use customer-built tools (maintenance forms, inspection checklists, field dashboards) without a desktop.

## Goals

1. Provide a genuinely native mobile experience for the platform's core workflows
2. Enable field use — customers, approvals, backlog triage, and agent conversations on the go
3. Support dynamic rendering of portal-defined forms and views for customer extensibility
4. Achieve hybrid connectivity — cached reads offline, online writes
5. Build entirely via AI agents with a comprehensive automated test harness
6. Share types, validation, and API client code between web and mobile via monorepo

## Non-Goals

- EA Modeler on mobile (canvas interaction doesn't translate to touch)
- Build Studio on mobile (development workflow belongs on desktop)
- Full admin/settings (rare actions, desktop-appropriate)
- Portal form/view builder UI (separate epic — mobile only renders definitions)
- Full offline CRUD with conflict resolution (v1 queues mutations for retry only)
- Tablet-optimized layouts (v1 targets phone form factor)
- Apple Watch / Wear OS companion
- White-labeling / per-customer app store listings
- Real-time collaboration / presence indicators
- SSO/SAML authentication (future enhancement)

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | React Native + Expo SDK 53+ (managed workflow) | Same TypeScript/React as web codebase; purpose-built AI agent tooling (Expo Skills, MCP Server); EAS handles builds/signing/submission |
| Language | TypeScript (strict mode) | Shared with web; best AI code generation quality |
| Navigation | Expo Router (file-based) | Matches Next.js App Router mental model |
| Styling | NativeWind v4 (Tailwind for RN) | AI agents know Tailwind deeply |
| State | Zustand | Minimal, TypeScript-native, AI-familiar |
| Offline Storage | expo-sqlite (relational), react-native-mmkv (key-value) | Production-stable, well-documented for Expo |
| Build/Deploy | EAS Build + EAS Submit + EAS Workflows | CLI-automatable, no Xcode/Android Studio needed |
| Push | expo-notifications + FCM/APNs | Official Expo SDK, production-stable |
| Testing | Jest + RNTL (unit/component), MSW (integration), Maestro (E2E) | Full AI-agent-driven test loop |

### Technology Selection Evidence

React Native + Expo scored 8.85/10 weighted across AI code generation quality (9/10), native feel (8/10), TypeScript alignment (10/10), offline support (9/10), build/deploy simplicity (9/10), and AI agent autonomy (9/10). The nearest competitor (Flutter, 6.85/10) was eliminated due to Dart language mismatch, lack of AI agent tooling, and no code sharing with the existing TypeScript codebase.

Capacitor/Ionic was eliminated due to a documented SSE bug (GitHub issue #6582) that blocks the agent streaming architecture. .NET MAUI and Kotlin Multiplatform were eliminated due to language mismatch and poor AI training data coverage.

Key evidence:
- Expo Skills: 11 structured instruction files for AI agents (Claude Code, Cursor, Codex)
- Expo MCP Server: direct AI agent project context integration
- Callstack React Native Agent Skills: 27+ machine-readable skill documents
- Callstack Agent-Device: open-source AI-native device automation
- CodeRabbit 2025 study: AI code produces 1.7x more issues — mitigated by automated testing layers

## Architecture

### Monorepo Structure

```
OpenDigitalProductFactory/
├── apps/
│   ├── web/                 ← existing Next.js 16
│   └── mobile/              ← NEW: Expo React Native
│       ├── app/             ← Expo Router (file-based routes)
│       ├── src/
│       │   ├── components/  ← native UI components
│       │   ├── features/    ← feature modules (auth, workspace, ops, etc.)
│       │   ├── stores/      ← Zustand state management
│       │   ├── repositories/← storage interfaces (SQLite, MMKV)
│       │   └── mocks/       ← MSW handlers for testing
│       ├── e2e/flows/       ← Maestro YAML test flows
│       └── eas.json         ← EAS build/submit config
├── packages/
│   ├── db/                  ← existing Prisma
│   ├── types/               ← NEW: shared entity types (generated from Prisma)
│   ├── api-client/          ← NEW: typed REST client (web + mobile)
│   ├── validators/          ← NEW: shared Zod schemas
│   └── api/                 ← NEW: REST route handlers
```

### Data Flow

```
Mobile App                          Server (Next.js 16)
─────────                          ─────────────────
Expo Router screens
  ↓ uses
Zustand stores ──── fetch ────→ REST API routes (/api/v1/*)
  ↓ caches                        ↓ calls
SQLite (offline reads)          Prisma → PostgreSQL
MMKV (tokens, prefs)
  ↓ receives
SSE stream ←──── push ──────── Agent event bus (foreground)
Push notifications ←──────── FCM/APNs (background wake-up)
```

### Key Principles

- Mobile never talks to Prisma directly — REST API is the only boundary
- Shared `packages/types/` means Prisma schema changes propagate to mobile types automatically
- Shared `packages/validators/` means validation runs identically on both clients
- Web app gradually migrates from server actions to the same `api-client` the mobile uses

## REST API Layer

### Endpoint Design

```
/api/v1/
├── auth/
│   ├── POST   /login              ← email + password → JWT
│   ├── POST   /refresh            ← refresh token → new JWT
│   ├── POST   /logout
│   └── GET    /me                 ← current user + role + capabilities
├── workspace/
│   ├── GET    /dashboard          ← tiles, metrics, calendar items
│   └── GET    /activity           ← recent activity feed
├── portfolio/
│   ├── GET    /tree               ← full portfolio hierarchy
│   ├── GET    /:id                ← portfolio detail + health
│   └── GET    /:id/products       ← products under portfolio
├── ops/
│   ├── GET    /epics              ← all epics with items
│   ├── POST   /epics              ← create epic
│   ├── PATCH  /epics/:id          ← update epic
│   ├── GET    /backlog            ← backlog items (filterable)
│   ├── POST   /backlog            ← create item
│   ├── PATCH  /backlog/:id        ← update item status/fields
│   └── DELETE /backlog/:id
├── agent/
│   ├── POST   /message            ← send message to specialist
│   ├── GET    /thread             ← conversation history
│   ├── GET    /stream             ← SSE: real-time agent responses
│   └── GET    /proposals          ← pending HITL proposals
├── governance/
│   ├── GET    /approvals          ← AgentActionProposal where status="proposed" and user owns thread
│   ├── POST   /approvals/:id      ← update AgentActionProposal status + decidedById/decidedAt
│   └── GET    /decisions          ← AuthorizationDecisionLog (audit trail)
├── customer/
│   ├── GET    /accounts           ← customer list
│   ├── GET    /accounts/:id       ← customer detail
│   └── PATCH  /accounts/:id       ← update customer
├── compliance/
│   ├── GET    /alerts             ← active regulatory alerts
│   ├── GET    /incidents          ← compliance incidents
│   ├── GET    /controls           ← control status overview
│   ├── GET    /regulations        ← regulation list for field reference
│   ├── GET    /audits/:id/findings ← audit findings for field auditors
│   └── GET    /corrective-actions ← corrective action deadlines + status
├── notifications/
│   ├── GET    /                   ← notification feed
│   ├── PATCH  /:id/read           ← mark as read
│   └── POST   /register-device    ← FCM/APNs token registration
└── dynamic/
    ├── GET    /forms              ← available custom form definitions
    ├── GET    /forms/:id          ← form schema + field definitions
    ├── POST   /forms/:id/submit   ← submit form data
    ├── GET    /views              ← available custom view definitions
    └── GET    /views/:id/data     ← view data with query parameters
```

### REST API Conventions

**Pagination:** All list endpoints use cursor-based pagination with `?cursor=<id>&limit=<n>` (default limit: 50, max: 200). Response shape: `{ data: T[], nextCursor: string | null }`.

**Error responses:** Standard error envelope on all non-2xx responses:
```typescript
{ code: string, message: string, details?: unknown }
```
HTTP status codes: 400 (validation), 401 (unauthenticated), 403 (insufficient capability), 404 (not found), 429 (rate limited), 500 (server error).

**Rate limiting:** Per-user, 120 requests/minute for standard endpoints, 30 requests/minute for write endpoints. Returns `429` with `Retry-After` header.

**File uploads:** `POST /api/v1/upload` accepts multipart/form-data. Max 10MB per file, accepted types: image/jpeg, image/png, image/heic, application/pdf. Returns `{ fileId: string, url: string }`. Camera and signature fields in dynamic forms upload via this endpoint before form submission, referencing the returned fileId.

### Authentication Design

**Mobile auth flow:**

1. `POST /api/v1/auth/login` with email + password → returns `{ accessToken, refreshToken, expiresIn }`
2. Access token: JWT, 15-minute TTL, signed with the same `AUTH_SECRET` NextAuth uses
3. Refresh token: stored as an `ApiToken` record in the database (reuses existing model), 30-day TTL, rotated on each refresh
4. `POST /api/v1/auth/refresh` with refresh token → issues new access + refresh pair, invalidates old refresh token
5. `POST /api/v1/auth/logout` invalidates the refresh token (deletes `ApiToken` record)

**JWT payload structure** (matches existing `DpfSession`):
```typescript
{
  sub: string,           // User.id
  email: string,         // User.email
  platformRole: string,  // PlatformRole.roleId (e.g., "HR-300")
  isSuperuser: boolean,
  iat: number,
  exp: number
}
```

**Dual auth middleware:** The `/api/v1/*` middleware checks in order:
1. `Authorization: Bearer <token>` header → validate JWT signature + expiry
2. NextAuth session cookie → call `auth()` as today
3. Neither present → 401

**Biometric unlock:** Access token + refresh token stored in `expo-secure-store` with biometric access control (`requireAuthentication: true`). On app open, biometric prompt unlocks Secure Store, retrieves tokens. If access token expired, auto-refresh using stored refresh token. No re-login unless refresh token is also expired.

**Mobile user types:** v1 supports workforce/admin users only (those with `PlatformRole` assignments). `CustomerContact` users cannot authenticate via mobile in v1 — this is a future enhancement. The login endpoint validates that the authenticated user has at least one `UserGroup` entry.

- All endpoints enforce the same capability gates as existing server actions

### New Database Models Required

**Notification** (for push notification feed):
```prisma
model Notification {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  type        String    // approval_request | compliance_alert | agent_response | backlog_assigned | epic_status
  title       String
  body        String?
  deepLink    String?   // e.g., "/ops/epics/EP-001" — used for navigation on tap
  read        Boolean   @default(false)
  createdAt   DateTime  @default(now())

  @@index([userId, read])
  @@index([createdAt])
}

model PushDeviceRegistration {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  token       String   @unique  // FCM or APNs device token
  platform    String   // ios | android
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, platform])
}
```

**Dynamic content models** (implemented by the portal form builder epic, listed here for type safety in REST endpoints):
```prisma
model DynamicForm {
  id              String   @id @default(cuid())
  formId          String   @unique  // FM-{UUID}
  title           String
  version         Int      @default(1)
  fields          Json     // Array of field definitions
  submitAction    String?  // Custom submit endpoint path
  offlineCapable  Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model DynamicView {
  id          String   @id @default(cuid())
  viewId      String   @unique  // VW-{UUID}
  title       String
  type        String   // dashboard | list | detail
  layout      Json     // Array of widget definitions
  dataSource  String   // API endpoint for view data
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Note: The `DynamicForm` and `DynamicView` models are defined here for API type safety. The actual migration is created by whichever epic lands first — either the portal form builder or Epic 1 (BI-REST-012). Until then, the REST endpoints return empty arrays.

### Implementation Approach

- Each `/api/v1/*` route handler is a thin wrapper calling shared business logic
- No duplicated logic — extract shared functions from server actions into `packages/api/`
- Versioned (`v1`) from day one so older mobile clients don't break
- `/api/v1/dynamic/` endpoints return empty arrays until the portal form builder exists

## Mobile App Features & Screens

### Navigation Structure

```
Bottom Tabs
├── Home (Workspace)
│   ├── Dashboard tiles (health metrics per area)
│   ├── Calendar widget (upcoming items)
│   ├── Activity feed (recent changes)
│   └── Quick actions (create item, approve, message agent)
├── Ops
│   ├── Epic list (grouped, filterable)
│   ├── Epic detail → backlog items
│   ├── Backlog item detail (edit status, priority, assignee)
│   ├── Quick-create backlog item
│   └── Custom forms (dynamic, when available)
├── Portfolio
│   ├── Portfolio tree (collapsible hierarchy)
│   ├── Portfolio node detail (health, budget, products)
│   └── Product detail (read-only lifecycle view)
├── Customers
│   ├── Customer list (search, filter)
│   ├── Customer detail (contact, accounts, history)
│   ├── Edit customer fields
│   └── Custom views (dynamic, when available)
└── More
    ├── Compliance alerts + incidents
    ├── Approvals queue (HITL governance)
    ├── Notification history
    ├── Profile + settings
    └── Custom views (dynamic, when available)
```

### Agent Co-Worker

Floating action button (FAB), same pattern as web:
- Persistent across all tabs
- Routes to correct specialist based on current screen (Ops → ops-coordinator, Portfolio → portfolio-advisor, etc.)
- Real-time SSE streaming in foreground
- Push notification when agent completes response while app is backgrounded
- Conversation history synced with web (same AgentThread per user)

### Offline Behavior

- **Cached reads:** Dashboard data, portfolio tree, epic/backlog lists, customer data cached in SQLite on each successful fetch. Stale data displayed with "Last synced: X" indicator.
- **Online writes:** Mutations are submitted online. If connectivity is lost during or after user action, mutations are queued locally with "Pending" badge and retried automatically on reconnect. Forms marked `offlineCapable` additionally pre-cache their schema and lookup data for field use without connectivity.
- **Agent conversations:** Online only (requires LLM inference). Conversation history viewable offline from cache.

### Push Notifications

Registered through `/api/v1/notifications/register-device`. Notification types:
- HITL approval request
- Compliance alert
- Agent response ready
- Backlog item assigned to user
- Epic status change

Tapping a notification deep-links to the relevant screen via Expo Router.

## Dynamic Content Rendering

### Form Definition Schema

Served by `/api/v1/dynamic/forms/:id`:

```typescript
{
  formId: "FM-FIELD-MAINT-001",
  title: "Field Maintenance Report",
  version: 2,
  fields: [
    { key: "asset_id", type: "lookup", source: "inventory", required: true, label: "Asset" },
    { key: "condition", type: "select", options: ["good","fair","poor","critical"], required: true },
    { key: "photo", type: "camera", maxCount: 5, label: "Photos" },
    { key: "notes", type: "textarea", maxLength: 2000 },
    { key: "next_review", type: "date", min: "today" },
    { key: "signature", type: "signature", required: true }
  ],
  submitAction: "/api/v1/dynamic/forms/FM-FIELD-MAINT-001/submit",
  offlineCapable: true
}
```

### View Definition Schema

Served by `/api/v1/dynamic/views/:id`:

```typescript
{
  viewId: "VW-ASSET-HEALTH-001",
  title: "Asset Health Dashboard",
  type: "dashboard",
  layout: [
    { widget: "stat-card", dataKey: "total_assets", label: "Total Assets" },
    { widget: "stat-card", dataKey: "critical_count", label: "Critical", color: "red" },
    { widget: "bar-chart", dataKey: "condition_breakdown", label: "By Condition" },
    { widget: "list", dataKey: "recent_inspections", columns: ["asset","date","condition"] }
  ],
  dataSource: "/api/v1/dynamic/views/VW-ASSET-HEALTH-001/data"
}
```

### Field Type → Native Component Mapping

| Field Type | Native Component | Notes |
|---|---|---|
| text, textarea | TextInput | With validation |
| select | BottomSheet picker | Platform-native feel |
| date | Native date picker | iOS/Android specific |
| camera | expo-camera | Capture + gallery select |
| signature | Canvas drawing view | Touch-based signature capture |
| lookup | Searchable list | Fetches from specified API source |
| number | Numeric TextInput | With min/max validation |
| checkbox, toggle | Switch | Standard boolean |
| multi-select | Multi-select BottomSheet | Multiple selections from options list |
| radio | Radio button group | Mutually exclusive visible choices |
| location | expo-location | Auto-capture GPS coordinates |

### Widget Type → Native Component Mapping

| Widget | Renders As | Data Shape |
|---|---|---|
| stat-card | Large number + label | `{ value: number, label: string }` |
| bar-chart, pie-chart | Chart via react-native-chart-kit | `{ labels: [], values: [] }` |
| list | Scrollable table | `{ rows: [], columns: [] }` |
| map | react-native-maps | `{ markers: [{ lat, lng, label }] }` |

### Design Decisions

- Form definitions are versioned — mobile caches the version it last fetched, re-fetches when version changes
- Forms marked `offlineCapable: true` cache their schema + lookup data locally, queue submissions in SQLite
- The renderer uses a fixed set of component types — customers compose from available widgets, they do not inject arbitrary code (security boundary)
- Validation rules travel with the schema — mobile validates client-side before submission, server validates again

### SQLite Cache Migration Strategy

When the app updates and the SQLite cache schema changes (new columns, new tables), the app detects a schema version mismatch on startup, drops the cache database, and re-fetches all data from the server. Cache is ephemeral — no user data is lost, only re-download time. The schema version is stored in MMKV as `cacheSchemaVersion`.

## Testing Architecture

### Test Framework Note

The web app and `packages/db` use Vitest. The mobile app uses Jest via `jest-expo` (standard for Expo — Vitest is not supported in the React Native/Expo ecosystem). The root-level test command coordinates both: `pnpm --filter web test && pnpm --filter mobile test && pnpm --filter @dpf/db test`. REST API tests in `packages/api/` use Vitest to match the web convention.

### Layer 1 — Unit + Component (Jest + RNTL, no simulator)

Runs on Linux CI, pure Node.js. Coverage target: 80% branches/functions/lines.

What's tested:
- Zustand stores — async flows, state transitions, cache logic
- API client — request/response mapping, error handling, auth refresh
- Form renderer — correct component for each field type, validation
- View renderer — widget selection, data binding
- Repository layer — SQLite read/write logic (via mocked interface)
- Utility functions — date formatting, permission checks, offline queue
- Individual components — rendering, user interaction, accessibility

MSW `msw/native` mocks the REST API. MMKV and SQLite mocked via `__mocks__/` directory. Repository pattern makes storage logic testable without native modules. AI agents write tests alongside feature code, run `jest --ci`, fix failures in a loop.

### Layer 2 — Integration (Jest + MSW, no simulator)

Runs on Linux CI, pure Node.js.

What's tested:
- Auth flow — login → token storage → refresh → retry on 401
- Offline queue — enqueue mutation → detect connection → replay → confirm
- Form submission — validate → submit → handle success/error
- Dynamic form fetch → cache → render cycle
- Agent conversation — send message → receive SSE events → update store
- Push notification registration → token refresh flow

Full feature flows tested end-to-end in Node.js. MSW handlers simulate success and error scenarios.

### Layer 3 — End-to-End (Maestro, needs simulator)

Runs on EAS Workflows — Android on Linux, iOS on macOS. Maestro is open source (Apache 2.0).

Maestro YAML flows:
- login.yaml — sign in, verify dashboard loads
- backlog-crud.yaml — create item, edit status, verify list updates
- agent-chat.yaml — open FAB, send message, verify response appears
- approval-flow.yaml — navigate to approvals, approve item, verify status
- offline-cache.yaml — load data, toggle airplane mode, verify cached data shows
- custom-form.yaml — navigate to dynamic form, fill fields, submit
- deep-link.yaml — simulate notification tap, verify correct screen opens
- customer-view.yaml — browse customers, open detail, verify fields

Maestro MCP Server enables Claude Code to write flows, run them, read results, and fix failures. Agent-Device available for exploratory testing via accessibility tree inspection.

### CI Pipeline

```
Push to main
  ↓
GitHub Actions (Linux, 2-5 min)
  ├── TypeScript type check (tsc --noEmit)
  ├── Lint (eslint)
  └── Jest unit + integration tests
  ↓ (all green)
EAS Build (cloud, 10-15 min)
  ├── Android APK
  └── iOS IPA (EAS handles code signing)
  ↓ (build succeeds)
EAS Workflows — Maestro E2E
  ├── Android flows (Linux runner)
  └── iOS flows (macOS runner)
  ↓ (all green)
EAS Submit (on version tag on main)
  ├── Google Play
  └── App Store
```

### AI Agent Test Loop

1. Agent writes feature code + tests together
2. Runs `jest --ci` — reads structured output
3. Fixes failures, re-runs until green
4. Writes Maestro YAML flow for the feature
5. Triggers EAS build + E2E via CLI
6. Reads Maestro results, adjusts flows if needed

## Epic Decomposition

### Epic 1: REST API Layer (prerequisite)

**EP-REST-API-001 — Platform REST API v1**

Extract business logic from server actions into shared functions. Expose as versioned REST endpoints. JWT auth alongside existing session auth. OpenAPI spec generation.

| Item ID | Title |
|---|---|
| BI-REST-001 | Extract shared business logic from server actions into packages/api/ |
| BI-REST-002 | JWT auth middleware (issue, refresh, validate alongside NextAuth sessions, using ApiToken model for refresh tokens) |
| BI-REST-003 | Auth endpoints (login, refresh, logout, me) |
| BI-REST-004 | Workspace endpoints (dashboard, activity) |
| BI-REST-005 | Portfolio endpoints (tree, detail, products) |
| BI-REST-006 | Ops endpoints (epics CRUD, backlog CRUD) |
| BI-REST-007 | Agent endpoints (message, thread, stream SSE, proposals) |
| BI-REST-008 | Governance endpoints (approvals, decisions) |
| BI-REST-009 | Customer endpoints (accounts CRUD) |
| BI-REST-010 | Compliance endpoints (alerts, incidents, controls, regulations, audit findings, corrective actions) |
| BI-REST-011 | Notification + push device DB models (Notification, PushDeviceRegistration tables) + endpoints (feed, read, device registration) |
| BI-REST-012 | Dynamic content endpoints (forms, views — returns empty until builder exists) |
| BI-REST-013 | OpenAPI spec generation + typed client in packages/api-client/ |
| BI-REST-014 | Shared Zod validators in packages/validators/ |
| BI-REST-015 | REST API test suite (Vitest + supertest, matching web test framework) |
| BI-REST-016 | File upload endpoint (POST /api/v1/upload, multipart, 10MB limit, image/pdf) |
| BI-REST-017 | SSE stream migration (replace /api/agent/stream with /api/v1/agent/stream accepting both JWT and session auth; deprecate old route) |

### Epic 2: Mobile App Foundation (depends on Epic 1)

**EP-MOBILE-FOUND-001 — Mobile Companion App Foundation**

Expo project scaffold, auth flow, navigation shell, offline infrastructure, push notifications.

| Item ID | Title |
|---|---|
| BI-MOB-001 | Expo project scaffold in apps/mobile/ with pnpm workspace integration |
| BI-MOB-002 | Expo Router tab navigation (Home, Ops, Portfolio, Customers, More) |
| BI-MOB-003 | Auth flow (login screen, JWT storage in Secure Storage, biometric unlock) |
| BI-MOB-004 | API client integration (packages/api-client/ consuming /api/v1/*) |
| BI-MOB-005 | Offline cache layer (SQLite for entities, MMKV for tokens/prefs) |
| BI-MOB-006 | Push notification setup (expo-notifications, FCM/APNs, device registration) |
| BI-MOB-007 | Deep linking (notification tap → correct screen) |
| BI-MOB-008 | Testing harness (jest-expo, RNTL, MSW, renderWithProviders, Maestro config) |
| BI-MOB-009 | EAS Build + Submit configuration (eas.json, credentials, CI workflow) |
| BI-MOB-010 | App theming (match platform brand tokens, dark mode, typography) |

### Epic 3: Mobile Feature Screens (depends on Epic 2)

**EP-MOBILE-FEAT-001 — Mobile Companion App Features**

Core feature screens with full offline caching and test coverage.

| Item ID | Title |
|---|---|
| BI-MOB-011 | Workspace dashboard (tiles, calendar, activity feed, quick actions) |
| BI-MOB-012 | Epic list + detail screen |
| BI-MOB-013 | Backlog item list + detail + create/edit |
| BI-MOB-014 | Portfolio tree + node detail (read-only) |
| BI-MOB-015 | Customer list + detail + edit |
| BI-MOB-016 | Agent co-worker FAB (route-aware specialist, SSE streaming, thread history) |
| BI-MOB-017 | Approvals queue + approve/reject flow |
| BI-MOB-018 | Compliance alerts + incident list |
| BI-MOB-019 | Notification history screen |
| BI-MOB-020 | Profile + settings screen |
| BI-MOB-021 | Maestro E2E flows for all feature screens |

### Epic 4: Dynamic Content Renderer (depends on Epic 3 + portal form builder)

**EP-MOBILE-DYN-001 — Mobile Dynamic Content Renderer**

Schema-driven form and view rendering engine. Consumes definitions from /api/v1/dynamic/*.

| Item ID | Title |
|---|---|
| BI-MOB-022 | Form renderer engine (field type → native component mapping) |
| BI-MOB-023 | Form field types (text, select, date, camera, signature, location, lookup) |
| BI-MOB-024 | Form validation engine (schema-driven, client-side) |
| BI-MOB-025 | Form offline submission queue (for offlineCapable forms) |
| BI-MOB-026 | View renderer engine (widget type → native component mapping) |
| BI-MOB-027 | View widget types (stat-card, charts, list, map) |
| BI-MOB-028 | Dynamic content caching (schema versioning, stale detection) |
| BI-MOB-029 | Dynamic content test suite (renderer tests for all field/widget types) |

### Dependency Chain

```
Epic 1 (REST API) → Epic 2 (Foundation) → Epic 3 (Features) → Epic 4 (Dynamic)
                                                              ↑
                                          Portal Form Builder Epic (separate)
```

Epic 4 can start in parallel with Epic 3 for the renderer engine, but real dynamic content flows only once the portal form builder exists.

## Accessibility

All screens must support VoiceOver (iOS) and TalkBack (Android) with meaningful labels. Minimum requirements:
- All interactive elements have `accessibilityLabel` and `accessibilityRole`
- Minimum touch target: 44x44pt (iOS), 48x48dp (Android)
- Color contrast ratio: 4.5:1 minimum (WCAG 2.1 AA)
- Screen reader navigation order follows visual layout
- RNTL tests query by `getByRole` first (enforces accessibility labels exist)

This is particularly important for the regulated industry audience where accessibility compliance may be legally required.

## Assumptions

- Apple Developer Program ($99/year) and Google Play Developer ($25 one-time) accounts exist or will be created before Epic 2
- EAS free tier is sufficient for initial builds; paid tier adopted if build volume exceeds limits
- The existing auth model (email + password) is sufficient for mobile — SSO/SAML is a future enhancement
- Push notification infrastructure (FCM project, APNs certificate) configured during Epic 2
- AI agents are the primary developers — human review validates AI output at each backlog item
- The web portal form/view builder is a separate epic that proceeds independently

# Mobile Companion App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native iOS/Android companion app for the Open Digital Product Factory platform with REST API, offline caching, AI agent conversations, and dynamic content rendering.

**Architecture:** Monorepo extension — add `apps/mobile/` (Expo React Native) and shared packages (`packages/types/`, `packages/api-client/`, `packages/validators/`) to the existing pnpm workspace. A new REST API layer (`/api/v1/*`) serves both mobile and web, with JWT + session dual auth. Mobile caches reads in SQLite, writes online with retry queue.

**Tech Stack:** React Native + Expo SDK 53+, Expo Router, Zustand, NativeWind v4, expo-sqlite, react-native-mmkv, MSW, Jest + RNTL, Maestro, EAS Build/Submit

**Spec:** `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md`

---

## File Structure

### New Shared Packages

```
packages/
├── types/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              ← re-exports all entity types
│       ├── entities.ts           ← Prisma-derived entity types (Epic, BacklogItem, etc.)
│       ├── api.ts                ← request/response shapes for /api/v1/*
│       └── dynamic.ts            ← DynamicForm, DynamicView, field/widget types
├── validators/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── auth.ts               ← login input, refresh input
│       ├── backlog.ts            ← epic/item create/update schemas
│       ├── customer.ts           ← customer update schema
│       └── dynamic.ts            ← form submission validation
├── api-client/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── client.ts             ← typed fetch wrapper with auth header injection
│       ├── endpoints/            ← one file per API domain
│       │   ├── auth.ts
│       │   ├── workspace.ts
│       │   ├── portfolio.ts
│       │   ├── ops.ts
│       │   ├── agent.ts
│       │   ├── governance.ts
│       │   ├── customer.ts
│       │   ├── compliance.ts
│       │   ├── notifications.ts
│       │   ├── dynamic.ts
│       │   └── upload.ts
│       └── types.ts              ← PaginatedResponse, ApiError, etc.
```

### New REST API Routes (in apps/web/)

```
apps/web/app/api/v1/
├── auth/
│   ├── login/route.ts
│   ├── refresh/route.ts
│   ├── logout/route.ts
│   └── me/route.ts
├── workspace/
│   ├── dashboard/route.ts
│   └── activity/route.ts
├── portfolio/
│   ├── tree/route.ts
│   └── [id]/
│       ├── route.ts
│       └── products/route.ts
├── ops/
│   ├── epics/
│   │   ├── route.ts              ← GET list + POST create
│   │   └── [id]/route.ts         ← PATCH update
│   └── backlog/
│       ├── route.ts              ← GET list + POST create
│       └── [id]/route.ts         ← PATCH update + DELETE
├── agent/
│   ├── message/route.ts
│   ├── thread/route.ts
│   ├── stream/route.ts
│   └── proposals/route.ts
├── governance/
│   ├── approvals/
│   │   ├── route.ts
│   │   └── [id]/route.ts
│   └── decisions/route.ts
├── customer/
│   └── accounts/
│       ├── route.ts
│       └── [id]/route.ts
├── compliance/
│   ├── alerts/route.ts
│   ├── incidents/route.ts
│   ├── controls/route.ts
│   ├── regulations/route.ts
│   ├── audits/[id]/findings/route.ts
│   └── corrective-actions/route.ts
├── notifications/
│   ├── route.ts
│   ├── [id]/read/route.ts
│   └── register-device/route.ts
├── dynamic/
│   ├── forms/
│   │   ├── route.ts
│   │   ├── [id]/
│   │   │   ├── route.ts
│   │   │   └── submit/route.ts
│   └── views/
│       ├── route.ts
│       └── [id]/data/route.ts
└── upload/route.ts
# Note: no _middleware.ts — each route calls authenticateRequest() from lib/api/auth-middleware.ts directly
```

### New REST API Shared Logic (in apps/web/)

```
apps/web/lib/api/
├── auth-middleware.ts             ← JWT verify + session fallback
├── jwt.ts                        ← sign, verify, refresh token logic
├── pagination.ts                 ← cursor-based pagination helper
├── error.ts                      ← standard error envelope
├── rate-limit.ts                 ← per-user rate limiting
└── response.ts                   ← typed response helpers
```

### New Database Models

```
packages/db/prisma/
├── schema.prisma                 ← ADD: Notification, PushDeviceRegistration, DynamicForm, DynamicView
└── migrations/YYYYMMDD_mobile_models/migration.sql
```

### Mobile App

```
apps/mobile/
├── app.json                      ← Expo config
├── eas.json                      ← EAS Build/Submit profiles
├── package.json
├── tsconfig.json
├── babel.config.js
├── jest.config.ts
├── jest.setup.ts
├── metro.config.js
├── nativewind-env.d.ts
├── tailwind.config.ts
├── __mocks__/
│   ├── react-native-mmkv.ts
│   └── expo-sqlite.ts
├── __tests__/
│   └── utils/
│       ├── renderWithProviders.tsx
│       └── mockStore.ts
├── app/                          ← Expo Router (file-based)
│   ├── _layout.tsx               ← Root layout (providers, auth gate)
│   ├── login.tsx                 ← Login screen
│   ├── (tabs)/
│   │   ├── _layout.tsx           ← Tab navigator
│   │   ├── index.tsx             ← Home/Workspace
│   │   ├── ops/
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx         ← Epic list
│   │   │   └── [epicId].tsx      ← Epic detail
│   │   ├── portfolio/
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx         ← Portfolio tree
│   │   │   └── [id].tsx          ← Node detail
│   │   ├── customers/
│   │   │   ├── _layout.tsx
│   │   │   ├── index.tsx         ← Customer list
│   │   │   └── [id].tsx          ← Customer detail
│   │   └── more/
│   │       ├── _layout.tsx
│   │       ├── index.tsx         ← More menu
│   │       ├── approvals.tsx
│   │       ├── compliance.tsx
│   │       ├── notifications.tsx
│   │       └── profile.tsx
├── src/
│   ├── components/
│   │   ├── AgentFAB.tsx
│   │   ├── AgentPanel.tsx
│   │   ├── DashboardTile.tsx
│   │   ├── EpicCard.tsx
│   │   ├── BacklogItemCard.tsx
│   │   ├── PortfolioNode.tsx
│   │   ├── CustomerCard.tsx
│   │   ├── ApprovalCard.tsx
│   │   ├── NotificationItem.tsx
│   │   ├── OfflineBanner.tsx
│   │   ├── PendingBadge.tsx
│   │   └── ui/                   ← shared primitives
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Input.tsx
│   │       ├── BottomSheet.tsx
│   │       └── StatusBadge.tsx
│   ├── features/
│   │   ├── auth/
│   │   │   ├── auth.store.ts
│   │   │   ├── auth.store.test.ts
│   │   │   └── useAuth.ts
│   │   ├── workspace/
│   │   │   ├── workspace.store.ts
│   │   │   └── workspace.store.test.ts
│   │   ├── ops/
│   │   │   ├── ops.store.ts
│   │   │   └── ops.store.test.ts
│   │   ├── portfolio/
│   │   │   ├── portfolio.store.ts
│   │   │   └── portfolio.store.test.ts
│   │   ├── customer/
│   │   │   ├── customer.store.ts
│   │   │   └── customer.store.test.ts
│   │   ├── agent/
│   │   │   ├── agent.store.ts
│   │   │   └── agent.store.test.ts
│   │   ├── governance/
│   │   │   ├── governance.store.ts
│   │   │   └── governance.store.test.ts
│   │   ├── compliance/
│   │   │   ├── compliance.store.ts
│   │   │   └── compliance.store.test.ts
│   │   └── notifications/
│   │       ├── notifications.store.ts
│   │       └── notifications.store.test.ts
│   ├── stores/
│   │   ├── offlineQueue.ts       ← mutation retry queue
│   │   └── offlineQueue.test.ts
│   ├── repositories/
│   │   ├── CacheRepository.ts    ← SQLite cache interface
│   │   ├── CacheRepository.test.ts
│   │   └── SecureStorage.ts      ← expo-secure-store wrapper
│   ├── mocks/
│   │   ├── server.ts             ← MSW server setup
│   │   └── handlers/
│   │       ├── auth.handlers.ts
│   │       ├── ops.handlers.ts
│   │       ├── portfolio.handlers.ts
│   │       ├── customer.handlers.ts
│   │       ├── agent.handlers.ts
│   │       └── index.ts
│   ├── hooks/
│   │   ├── useOfflineStatus.ts
│   │   └── useAgentRouting.ts
│   └── lib/
│       ├── theme.ts              ← brand token mapping
│       └── constants.ts
├── e2e/
│   └── flows/
│       ├── login.yaml
│       ├── backlog-crud.yaml
│       ├── agent-chat.yaml
│       ├── approval-flow.yaml
│       ├── offline-cache.yaml
│       ├── customer-view.yaml
│       ├── deep-link.yaml
│       └── custom-form.yaml
└── dynamic/                      ← Epic 4: dynamic content renderer
    ├── FormRenderer.tsx
    ├── FormRenderer.test.tsx
    ├── ViewRenderer.tsx
    ├── ViewRenderer.test.tsx
    ├── fields/
    │   ├── TextField.tsx
    │   ├── SelectField.tsx
    │   ├── DateField.tsx
    │   ├── CameraField.tsx
    │   ├── SignatureField.tsx
    │   ├── LocationField.tsx
    │   ├── LookupField.tsx
    │   ├── MultiSelectField.tsx
    │   ├── RadioField.tsx
    │   └── index.ts              ← field type registry
    └── widgets/
        ├── StatCard.tsx
        ├── BarChart.tsx
        ├── ListView.tsx
        ├── MapWidget.tsx
        └── index.ts              ← widget type registry
```

---

## Phase 1: REST API Layer (Epic EP-REST-API-001)

### Task 1: Database Models for Mobile

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate`
- Modify: `packages/db/src/seed.ts` (if needed)

- [ ] **Step 1: Add Notification model to schema.prisma**

Add after the `ApiToken` model block:

```prisma
// ─── Mobile Notifications ──────────────────────────────────────────────────

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  type      String   // approval_request | compliance_alert | agent_response | backlog_assigned | epic_status
  title     String
  body      String?
  deepLink  String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId, read])
  @@index([createdAt])
}

model PushDeviceRegistration {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  token     String   @unique
  platform  String   // ios | android
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, platform])
}
```

Add the reverse relations to the `User` model:
```prisma
notifications             Notification[]
pushDevices               PushDeviceRegistration[]
```

- [ ] **Step 2: Add DynamicForm and DynamicView models**

```prisma
// ─── Dynamic Content ────────────────────────────────────────────────────────

model DynamicForm {
  id             String   @id @default(cuid())
  formId         String   @unique
  title          String
  version        Int      @default(1)
  fields         Json
  submitAction   String?
  offlineCapable Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model DynamicView {
  id         String   @id @default(cuid())
  viewId     String   @unique
  title      String
  type       String
  layout     Json
  dataSource String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

- [ ] **Step 3: Generate and run migration**

```bash
cd h:/OpenDigitalProductFactory
pnpm db:generate
pnpm db:migrate --name mobile_models
```

- [ ] **Step 4: Verify migration**

```bash
pnpm db:generate
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add Notification, PushDeviceRegistration, DynamicForm, DynamicView models"
```

---

### Task 2: Shared Types Package

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/index.ts`
- Create: `packages/types/src/entities.ts`
- Create: `packages/types/src/api.ts`
- Create: `packages/types/src/dynamic.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@dpf/types",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@dpf/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create src/entities.ts**

Re-export Prisma-generated types relevant to mobile:

```typescript
import type { Prisma } from "@dpf/db";

// Entity types derived from Prisma models
export type Epic = Prisma.EpicGetPayload<{
  include: {
    portfolios: { include: { portfolio: true } };
    items: true;
  };
}>;

export type BacklogItem = Prisma.BacklogItemGetPayload<{
  include: { epic: true; digitalProduct: true; taxonomyNode: true };
}>;

export type Portfolio = Prisma.PortfolioGetPayload<{
  include: { children: true; products: true };
}>;

export type CustomerAccount = Prisma.CustomerAccountGetPayload<{
  include: { contacts: true };
}>;

export type AgentThread = Prisma.AgentThreadGetPayload<{
  include: { messages: true };
}>;

export type AgentMessage = Prisma.AgentMessageGetPayload<{}>;

export type AgentActionProposal = Prisma.AgentActionProposalGetPayload<{}>;

export type Notification = Prisma.NotificationGetPayload<{}>;

export type AuthorizationDecisionLog = Prisma.AuthorizationDecisionLogGetPayload<{}>;
```

- [ ] **Step 4: Create src/api.ts**

```typescript
// Standard API response shapes
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface MeResponse {
  id: string;
  email: string;
  platformRole: string;
  isSuperuser: boolean;
  capabilities: string[];
}

// Workspace
export interface DashboardTile {
  area: string;
  label: string;
  value: number;
  trend?: "up" | "down" | "stable";
  color?: string;
}

export interface DashboardResponse {
  tiles: DashboardTile[];
  calendarItems: CalendarItem[];
}

export interface CalendarItem {
  id: string;
  title: string;
  date: string;
  type: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  target: string;
  actor: string;
  timestamp: string;
}

// Ops
export interface CreateEpicRequest {
  title: string;
  description?: string;
  portfolioIds: string[];
}

export interface UpdateEpicRequest {
  title?: string;
  description?: string;
  status?: "open" | "in-progress" | "done";
}

export interface CreateBacklogItemRequest {
  title: string;
  body?: string;
  type: "product" | "portfolio";
  epicId?: string;
  priority?: number;
}

export interface UpdateBacklogItemRequest {
  title?: string;
  body?: string;
  status?: "open" | "in-progress" | "done" | "deferred";
  priority?: number;
  epicId?: string | null;
}

// Governance
export interface ApprovalDecisionRequest {
  decision: "approve" | "reject";
  rationale?: string;
}

// Customer
export interface UpdateCustomerRequest {
  name?: string;
  industry?: string;
  notes?: string;
}

// Notifications
export interface RegisterDeviceRequest {
  token: string;
  platform: "ios" | "android";
}

// Upload
export interface UploadResponse {
  fileId: string;
  url: string;
}
```

- [ ] **Step 5: Create src/dynamic.ts**

```typescript
// Dynamic form field types
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multi-select"
  | "radio"
  | "date"
  | "camera"
  | "signature"
  | "lookup"
  | "checkbox"
  | "toggle"
  | "location";

export interface FormFieldDefinition {
  key: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  source?: string;
  maxCount?: number;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
}

export interface DynamicFormSchema {
  formId: string;
  title: string;
  version: number;
  fields: FormFieldDefinition[];
  submitAction: string;
  offlineCapable: boolean;
}

// Dynamic view widget types
export type WidgetType = "stat-card" | "bar-chart" | "pie-chart" | "list" | "map";

export interface ViewWidgetDefinition {
  widget: WidgetType;
  dataKey: string;
  label: string;
  color?: string;
  columns?: string[];
}

export interface DynamicViewSchema {
  viewId: string;
  title: string;
  type: "dashboard" | "list" | "detail";
  layout: ViewWidgetDefinition[];
  dataSource: string;
}
```

- [ ] **Step 6: Create src/index.ts**

```typescript
export * from "./entities";
export * from "./api";
export * from "./dynamic";
```

- [ ] **Step 7: Install dependencies and verify**

```bash
cd h:/OpenDigitalProductFactory
pnpm install
cd packages/types && pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/types/
git commit -m "feat: add @dpf/types shared package with entity, API, and dynamic types"
```

---

### Task 3: Shared Validators Package

**Files:**
- Create: `packages/validators/package.json`
- Create: `packages/validators/tsconfig.json`
- Create: `packages/validators/src/index.ts`
- Create: `packages/validators/src/auth.ts`
- Create: `packages/validators/src/backlog.ts`
- Create: `packages/validators/src/customer.ts`
- Create: `packages/validators/src/dynamic.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@dpf/validators",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create src/auth.ts**

```typescript
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
```

- [ ] **Step 4: Create src/backlog.ts**

```typescript
import { z } from "zod";

export const createEpicSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  portfolioIds: z.array(z.string()).min(1),
});

export const updateEpicSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(["open", "in-progress", "done"]).optional(),
});

export const createBacklogItemSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10000).optional(),
  type: z.enum(["product", "portfolio"]),
  epicId: z.string().optional(),
  priority: z.number().int().min(0).max(999).optional(),
});

export const updateBacklogItemSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
  status: z.enum(["open", "in-progress", "done", "deferred"]).optional(),
  priority: z.number().int().min(0).max(999).optional(),
  epicId: z.string().nullable().optional(),
});

export type CreateEpicInput = z.infer<typeof createEpicSchema>;
export type UpdateEpicInput = z.infer<typeof updateEpicSchema>;
export type CreateBacklogItemInput = z.infer<typeof createBacklogItemSchema>;
export type UpdateBacklogItemInput = z.infer<typeof updateBacklogItemSchema>;
```

- [ ] **Step 5: Create src/customer.ts**

```typescript
import { z } from "zod";

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  industry: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
```

- [ ] **Step 6: Create src/dynamic.ts**

```typescript
import { z } from "zod";

export const formSubmissionSchema = z.object({
  formId: z.string(),
  values: z.record(z.unknown()),
  fileIds: z.array(z.string()).optional(),
});

export type FormSubmissionInput = z.infer<typeof formSubmissionSchema>;
```

- [ ] **Step 7: Create src/index.ts**

```typescript
export * from "./auth";
export * from "./backlog";
export * from "./customer";
export * from "./dynamic";
```

- [ ] **Step 8: Install and verify**

```bash
cd h:/OpenDigitalProductFactory
pnpm install
cd packages/validators && pnpm typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/validators/
git commit -m "feat: add @dpf/validators shared package with Zod schemas"
```

---

### Task 4: REST API Infrastructure

**Files:**
- Create: `apps/web/lib/api/jwt.ts`
- Create: `apps/web/lib/api/auth-middleware.ts`
- Create: `apps/web/lib/api/pagination.ts`
- Create: `apps/web/lib/api/error.ts`
- Create: `apps/web/lib/api/response.ts`
- Create: `apps/web/lib/api/rate-limit.ts`
- Test: `apps/web/lib/api/__tests__/jwt.test.ts`
- Test: `apps/web/lib/api/__tests__/auth-middleware.test.ts`
- Test: `apps/web/lib/api/__tests__/pagination.test.ts`

- [ ] **Step 1: Write jwt.ts tests**

Test: JWT sign/verify, refresh token creation via ApiToken model, token expiry.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd h:/OpenDigitalProductFactory && pnpm --filter web test -- lib/api/__tests__/jwt.test.ts
```

- [ ] **Step 3: Implement jwt.ts**

Use `jose` library for JWT operations. Sign with `AUTH_SECRET` env var (same as NextAuth). Access token: 15min TTL. Refresh token: random 64-char hex stored as `ApiToken` with 30-day expiry, name: `"mobile-refresh"`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Write auth-middleware.ts tests**

Test: extracts Bearer token, falls back to NextAuth session cookie, returns 401 when neither present, returns 403 when capability missing.

- [ ] **Step 6: Run tests to verify they fail**

- [ ] **Step 7: Implement auth-middleware.ts**

Middleware function: check `Authorization: Bearer <token>` → verify JWT → attach user to request. Fallback: call `auth()` for session cookie. Return `{ user, capabilities }` or throw.

- [ ] **Step 8: Run tests to verify they pass**

- [ ] **Step 9: Implement pagination.ts, error.ts, response.ts, rate-limit.ts**

- `pagination.ts`: `parsePagination(searchParams)` returns `{ cursor, limit }`. `buildPaginatedResponse(items, limit)` returns `{ data, nextCursor }`.
- `error.ts`: `apiError(code, message, status, details?)` returns NextResponse with standard envelope.
- `response.ts`: `apiSuccess(data, status?)` returns typed NextResponse.
- `rate-limit.ts`: In-memory Map with sliding window per userId. Returns 429 with `Retry-After` if exceeded. Note: in-memory rate limiting resets on server restart/cold start. Acceptable for v1 self-hosted deployment (single process). If deploying to serverless/edge, replace with Upstash Redis or similar persistent store.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/api/
git commit -m "feat: REST API infrastructure — JWT auth, pagination, error handling, rate limiting"
```

Note: The file structure lists `apps/web/app/api/v1/_middleware.ts`. Next.js 16 does not support per-directory middleware files — middleware runs from `middleware.ts` at the project root. Instead, each route handler calls `authenticateRequest(request)` from `auth-middleware.ts` directly. Remove `_middleware.ts` from the file structure — it is not created.

---

### Task 5: Auth API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/auth/login/route.ts`
- Create: `apps/web/app/api/v1/auth/refresh/route.ts`
- Create: `apps/web/app/api/v1/auth/logout/route.ts`
- Create: `apps/web/app/api/v1/auth/me/route.ts`
- Test: `apps/web/lib/api/__tests__/auth-endpoints.test.ts`

- [ ] **Step 1: Write tests for login, refresh, logout, me endpoints**

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement login endpoint**

Validate with `loginSchema`. Find user by email, verify password with bcryptjs. Check user has at least one `UserGroup` (workforce only). Issue JWT access token + create ApiToken refresh token. Return `LoginResponse`.

- [ ] **Step 4: Implement refresh endpoint**

Validate refresh token against `ApiToken` table. Verify not expired. Issue new JWT + rotate refresh token (delete old, create new). Return `LoginResponse`.

- [ ] **Step 5: Implement logout endpoint**

Delete refresh token `ApiToken` record. Return 204.

- [ ] **Step 6: Implement me endpoint**

Use auth middleware. Return user profile with capabilities from `permissions.ts`.

- [ ] **Step 7: Run all tests, verify they pass**

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/api/v1/auth/ apps/web/lib/api/__tests__/auth-endpoints.test.ts
git commit -m "feat: REST API auth endpoints — login, refresh, logout, me"
```

---

### Architecture Note: Shared Logic Approach (BI-REST-001)

The spec calls for extracting shared business logic from server actions into `packages/api/`. In practice, the codebase already separates concerns: **data fetching** lives in `apps/web/lib/*-data.ts` files (pure Prisma queries, no `"use server"` directive), and **mutations** live in `apps/web/lib/actions/*.ts` (marked `"use server"`).

The REST API route handlers call the `*-data.ts` functions directly for reads, and extract the core mutation logic from server actions (stripping the `"use server"` + `revalidatePath` parts) for writes. This avoids a premature extraction into `packages/api/` while keeping logic non-duplicated.

If the API layer grows beyond 20+ routes or a third consumer appears, extract shared logic into `packages/api/` at that point. For v1, the `apps/web/lib/` functions serve as the shared layer.

The spec's `packages/api/` in the monorepo structure is **deferred** — not created in this plan. The `packages/api-client/` (Task 14) is the mobile-facing package.

---

### Task 6: Workspace API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/workspace/dashboard/route.ts`
- Create: `apps/web/app/api/v1/workspace/activity/route.ts`
- Test: `apps/web/lib/api/__tests__/workspace-endpoints.test.ts`
- Ref: `apps/web/lib/activity-feed-data.ts`, `apps/web/lib/calendar-data.ts`
- Note: No `workspace-data.ts` exists — dashboard data must be assembled from calendar, activity feed, and portfolio health queries

- [ ] **Step 1: Write tests for dashboard and activity endpoints**

Test: authenticated GET returns dashboard tiles + calendar items; activity returns paginated feed; unauthenticated returns 401.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web test -- lib/api/__tests__/workspace-endpoints.test.ts
```

- [ ] **Step 3: Implement dashboard endpoint**

Use auth middleware. Assemble dashboard response from: portfolio health counts, backlog status counts, calendar items (from `calendar-data.ts`), activity feed preview. Return `DashboardResponse`.

- [ ] **Step 4: Implement activity endpoint**

Use auth middleware + pagination helper. Query recent activity from `activity-feed-data.ts`. Return `PaginatedResponse<ActivityItem>`.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/v1/workspace/ apps/web/lib/api/__tests__/workspace-endpoints.test.ts
git commit -m "feat: REST API workspace endpoints — dashboard + activity"
```

---

### Task 7: Portfolio API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/portfolio/tree/route.ts`
- Create: `apps/web/app/api/v1/portfolio/[id]/route.ts`
- Create: `apps/web/app/api/v1/portfolio/[id]/products/route.ts`
- Test: `apps/web/lib/api/__tests__/portfolio-endpoints.test.ts`
- Ref: `apps/web/lib/portfolio-data.ts`, `apps/web/lib/actions/discovery.ts`

- [ ] **Step 1: Write tests for tree, detail, and products endpoints**

Test: tree returns full hierarchy; detail returns portfolio with health; products returns paginated list; capability gate `view_portfolio` enforced.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement tree endpoint**

Use auth middleware. Call existing portfolio data functions from `portfolio-data.ts`. Return portfolio hierarchy.

- [ ] **Step 4: Implement detail + products endpoints**

Detail: portfolio by ID with health metrics. Products: paginated list of digital products under portfolio.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/v1/portfolio/ apps/web/lib/api/__tests__/portfolio-endpoints.test.ts
git commit -m "feat: REST API portfolio endpoints — tree, detail, products"
```

---

### Task 8: Ops API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/ops/epics/route.ts` (GET list + POST create)
- Create: `apps/web/app/api/v1/ops/epics/[id]/route.ts` (PATCH update)
- Create: `apps/web/app/api/v1/ops/backlog/route.ts` (GET list + POST create)
- Create: `apps/web/app/api/v1/ops/backlog/[id]/route.ts` (PATCH update + DELETE)
- Test: `apps/web/lib/api/__tests__/ops-endpoints.test.ts`
- Ref: `apps/web/lib/backlog-data.ts`, `apps/web/lib/actions/backlog.ts`

- [ ] **Step 1: Write tests for epic CRUD and backlog CRUD**

Test: GET returns paginated epics with items; POST creates epic (validate with `createEpicSchema`); PATCH updates; GET backlog returns paginated items; POST creates item; PATCH updates status; DELETE removes item; capability gate `manage_backlog` enforced on writes.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement epic endpoints**

GET: use `getEpics()` from `backlog-data.ts` + pagination. POST: validate input with `@dpf/validators`, call create logic from `backlog.ts`. PATCH: validate with `updateEpicSchema`, call update logic.

- [ ] **Step 4: Implement backlog endpoints**

Same pattern: GET with pagination + filters, POST/PATCH with Zod validation, DELETE with auth check.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/v1/ops/ apps/web/lib/api/__tests__/ops-endpoints.test.ts
git commit -m "feat: REST API ops endpoints — epic + backlog CRUD"
```

---

### Task 9: Agent API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/agent/message/route.ts`
- Create: `apps/web/app/api/v1/agent/thread/route.ts`
- Create: `apps/web/app/api/v1/agent/stream/route.ts` (SSE, replaces old `/api/agent/stream`)
- Create: `apps/web/app/api/v1/agent/proposals/route.ts`
- Test: `apps/web/lib/api/__tests__/agent-endpoints.test.ts`
- Ref: `apps/web/lib/actions/agent-coworker.ts`, `apps/web/lib/agent-coworker-data.ts`, `apps/web/app/api/agent/stream/route.ts` (existing SSE pattern)

- [ ] **Step 1: Write tests for message, thread, proposals endpoints**

Test: POST message sends to specialist; GET thread returns conversation history; GET proposals returns pending `AgentActionProposal` records; auth enforced.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement message + thread + proposals endpoints**

Message: call `sendMessage` logic from `agent-coworker.ts`. Thread: query `AgentThread` + messages for user. Proposals: query `AgentActionProposal` where `status = "proposed"`.

- [ ] **Step 4: Implement SSE stream endpoint with dual auth**

Port logic from existing `apps/web/app/api/agent/stream/route.ts`. Add JWT bearer auth support alongside session cookies. This endpoint replaces the old one — add deprecation header to old route.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Deprecate old SSE route**

Add a redirect or deprecation notice to `apps/web/app/api/agent/stream/route.ts` pointing to `/api/v1/agent/stream`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/v1/agent/ apps/web/app/api/agent/stream/route.ts apps/web/lib/api/__tests__/agent-endpoints.test.ts
git commit -m "feat: REST API agent endpoints — message, thread, SSE stream (dual auth), proposals"
```

---

### Task 10: Governance API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/governance/approvals/route.ts` (GET pending)
- Create: `apps/web/app/api/v1/governance/approvals/[id]/route.ts` (POST approve/reject)
- Create: `apps/web/app/api/v1/governance/decisions/route.ts` (GET audit log)
- Test: `apps/web/lib/api/__tests__/governance-endpoints.test.ts`
- Ref: `apps/web/lib/actions/governance.ts`, `apps/web/lib/actions/proposals.ts`, `apps/web/lib/governance-data.ts`

- [ ] **Step 1: Write tests for approvals and decisions endpoints**

Test: GET approvals returns `AgentActionProposal` records where `status = "proposed"` and user owns the thread; POST approve/reject updates `status`, `decidedById`, `decidedAt`; GET decisions returns paginated `AuthorizationDecisionLog`.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement approvals endpoints**

GET: query `AgentActionProposal` joined with `AgentThread` where `thread.userId = currentUser.id` and `status = "proposed"`. POST: validate `ApprovalDecisionRequest`, update proposal status + decision fields.

- [ ] **Step 4: Implement decisions endpoint**

GET: paginated query on `AuthorizationDecisionLog` filtered by `actorRef = currentUser.id`. Return audit trail.

- [ ] **Step 5: Run tests, verify they pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/v1/governance/ apps/web/lib/api/__tests__/governance-endpoints.test.ts
git commit -m "feat: REST API governance endpoints — approvals + decision audit log"
```

---

### Task 11: Customer API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/customer/accounts/route.ts` (GET list)
- Create: `apps/web/app/api/v1/customer/accounts/[id]/route.ts` (GET detail + PATCH update)
- Test: `apps/web/lib/api/__tests__/customer-endpoints.test.ts`
- Ref: `apps/web/lib/actions/customer-auth.ts`, `apps/web/lib/actions/invite-actions.ts`
- Note: No `customer-data.ts` exists — customer queries must be written directly against Prisma `CustomerAccount` model

- [ ] **Step 1: Write tests for customer list, detail, and update**

Test: GET returns paginated `CustomerAccount` list with contacts; GET by ID returns detail; PATCH validates with `updateCustomerSchema` and updates; auth enforced.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement customer endpoints**

GET list: paginated Prisma query on `CustomerAccount` with `include: { contacts: true }`. GET detail: by ID. PATCH: validate input, update fields.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/v1/customer/ apps/web/lib/api/__tests__/customer-endpoints.test.ts
git commit -m "feat: REST API customer endpoints — accounts list, detail, update"
```

---

### Task 12: Compliance API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/compliance/alerts/route.ts`
- Create: `apps/web/app/api/v1/compliance/incidents/route.ts`
- Create: `apps/web/app/api/v1/compliance/controls/route.ts`
- Create: `apps/web/app/api/v1/compliance/regulations/route.ts`
- Create: `apps/web/app/api/v1/compliance/audits/[id]/findings/route.ts`
- Create: `apps/web/app/api/v1/compliance/corrective-actions/route.ts`
- Test: `apps/web/lib/api/__tests__/compliance-endpoints.test.ts`
- Ref: `apps/web/lib/actions/compliance.ts`

- [ ] **Step 1: Write tests for all 6 compliance endpoints**

Test: each GET returns paginated data; auth enforced; compliance capability gate applied.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement endpoints**

All read-only. Alerts: `RegulatoryAlert` where active. Incidents: `ComplianceIncident` paginated. Controls: `Control` with status summary. Regulations: `Regulation` list. Audit findings: by audit ID. Corrective actions: pending/overdue items.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/v1/compliance/ apps/web/lib/api/__tests__/compliance-endpoints.test.ts
git commit -m "feat: REST API compliance endpoints — alerts, incidents, controls, regulations, findings, corrective actions"
```

---

### Task 13: Notification + Dynamic + Upload API Endpoints

**Files:**
- Create: `apps/web/app/api/v1/notifications/route.ts` (GET feed)
- Create: `apps/web/app/api/v1/notifications/[id]/read/route.ts` (PATCH mark read)
- Create: `apps/web/app/api/v1/notifications/register-device/route.ts` (POST)
- Create: `apps/web/app/api/v1/dynamic/forms/route.ts` (GET list)
- Create: `apps/web/app/api/v1/dynamic/forms/[id]/route.ts` (GET schema)
- Create: `apps/web/app/api/v1/dynamic/forms/[id]/submit/route.ts` (POST)
- Create: `apps/web/app/api/v1/dynamic/views/route.ts` (GET list)
- Create: `apps/web/app/api/v1/dynamic/views/[id]/data/route.ts` (GET data)
- Create: `apps/web/app/api/v1/upload/route.ts`
- Test: `apps/web/lib/api/__tests__/notification-endpoints.test.ts`
- Test: `apps/web/lib/api/__tests__/dynamic-endpoints.test.ts`

- [ ] **Step 1: Write notification endpoint tests**

Test: GET returns paginated `Notification` for current user; PATCH marks as read; POST register-device creates `PushDeviceRegistration` (upsert on userId+platform).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement notification endpoints**

GET: `Notification` where `userId = currentUser.id`, ordered by `createdAt desc`. PATCH read: update `read = true`. Register device: upsert `PushDeviceRegistration` with token and platform.

- [ ] **Step 4: Implement dynamic content stubs**

GET forms: return `{ data: [], nextCursor: null }`. GET form by ID: return 404. POST submit: return 404. GET views: return `{ data: [], nextCursor: null }`. GET view data: return 404. These are stubs until the portal form builder epic lands.

- [ ] **Step 5: Implement upload endpoint**

Accept multipart/form-data. Max 10MB. Accepted types: image/jpeg, image/png, image/heic, application/pdf. Reuse logic from existing `apps/web/app/api/upload/route.ts`. Return `{ fileId, url }`.

- [ ] **Step 6: Run all tests, verify they pass**

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/v1/notifications/ apps/web/app/api/v1/dynamic/ apps/web/app/api/v1/upload/ apps/web/lib/api/__tests__/notification-endpoints.test.ts apps/web/lib/api/__tests__/dynamic-endpoints.test.ts
git commit -m "feat: REST API notifications, dynamic content stubs, and upload endpoints"
```

---

### Task 14: Shared API Client Package

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/client.ts`
- Create: `packages/api-client/src/types.ts`
- Create: `packages/api-client/src/endpoints/*.ts` (one per domain)
- Create: `packages/api-client/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@dpf/api-client",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@dpf/types": "workspace:*",
    "@dpf/validators": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 2: Implement client.ts**

Typed fetch wrapper that:
- Accepts base URL and auth token getter function
- Adds `Authorization: Bearer <token>` header
- Parses responses into typed shapes or `ApiError`
- Handles 401 by calling a refresh callback

- [ ] **Step 3: Implement endpoint files**

One file per domain (auth.ts, workspace.ts, ops.ts, etc.) exporting typed functions that call the REST API through the client. Each function returns the typed response from `@dpf/types`.

- [ ] **Step 4: Create index.ts**

Factory function: `createApiClient({ baseUrl, getToken, onRefresh })` returns object with all endpoint methods.

- [ ] **Step 5: Verify types**

```bash
cd h:/OpenDigitalProductFactory && cd packages/api-client && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/
git commit -m "feat: add @dpf/api-client shared package with typed REST client"
```

---

### Task 15: Update Root Scripts + Workspace Config

**Files:**
- Modify: `package.json` (root)
- Modify: `pnpm-workspace.yaml` (if needed)

- [ ] **Step 1: Update root package.json scripts**

Add mobile and shared package test/typecheck commands:

```json
"test": "pnpm --filter web test && pnpm --filter @dpf/db test && pnpm --filter mobile test",
"typecheck": "pnpm --filter web typecheck && pnpm --filter @dpf/db typecheck && pnpm --filter @dpf/types typecheck && pnpm --filter @dpf/validators typecheck && pnpm --filter @dpf/api-client typecheck"
```

- [ ] **Step 2: Verify workspace resolves all packages**

```bash
cd h:/OpenDigitalProductFactory && pnpm install && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update root scripts for mobile + shared packages"
```

---

## Phase 2: Mobile App Foundation (Epic EP-MOBILE-FOUND-001)

### Task 16: Expo Project Scaffold

**Files:**
- Create: `apps/mobile/` (entire Expo project)

- [ ] **Step 1: Initialize Expo project**

```bash
cd h:/OpenDigitalProductFactory/apps
npx create-expo-app mobile --template tabs
cd mobile
npx expo install expo-router expo-secure-store expo-sqlite expo-notifications expo-camera expo-location expo-local-authentication
npm install nativewind tailwindcss react-native-mmkv zustand @dpf/api-client @dpf/types @dpf/validators
npm install --save-dev jest-expo @testing-library/react-native msw jest @types/jest
```

- [ ] **Step 2: Configure app.json**

Set bundle identifiers, permissions, Expo SDK version.

- [ ] **Step 3: Configure eas.json**

Development, preview, and production build profiles.

- [ ] **Step 4: Configure jest.config.ts, jest.setup.ts**

Jest preset: `jest-expo`. Setup: MSW server lifecycle, RNTL matchers. Add `__mocks__/` for MMKV and SQLite.

- [ ] **Step 5: Configure tailwind.config.ts + NativeWind**

- [ ] **Step 6: Verify project builds**

```bash
cd h:/OpenDigitalProductFactory/apps/mobile && npx expo doctor
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/
git commit -m "feat: scaffold Expo mobile app with core dependencies"
```

---

### Task 17: Auth Flow

**Files:**
- Create: `apps/mobile/src/features/auth/auth.store.ts`
- Create: `apps/mobile/src/features/auth/auth.store.test.ts`
- Create: `apps/mobile/src/features/auth/useAuth.ts`
- Create: `apps/mobile/src/repositories/SecureStorage.ts`
- Create: `apps/mobile/app/login.tsx`
- Create: `apps/mobile/app/_layout.tsx` (root layout with auth gate)

- [ ] **Step 1: Write auth store tests**

Test: login stores tokens, refresh rotates tokens, logout clears tokens, isAuthenticated reflects state.

- [ ] **Step 2: Implement auth store**

Zustand store with: `login(email, password)`, `refresh()`, `logout()`, `isAuthenticated`, `user`. Uses `@dpf/api-client` auth endpoints. Stores tokens via `SecureStorage` wrapper (expo-secure-store with biometric).

- [ ] **Step 3: Implement login screen**

Email + password form. On success, navigate to tabs. On error, show message.

- [ ] **Step 4: Implement root layout with auth gate**

Check stored token on app launch. If valid, show tabs. If expired, try refresh. If no token, show login.

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/auth/ apps/mobile/src/repositories/ apps/mobile/app/login.tsx apps/mobile/app/_layout.tsx
git commit -m "feat: mobile auth flow — login, token storage, biometric, auth gate"
```

---

### Task 18: Tab Navigation Shell

**Files:**
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx` (Home stub)
- Create: `apps/mobile/app/(tabs)/ops/_layout.tsx` + `index.tsx` (stub)
- Create: `apps/mobile/app/(tabs)/portfolio/_layout.tsx` + `index.tsx` (stub)
- Create: `apps/mobile/app/(tabs)/customers/_layout.tsx` + `index.tsx` (stub)
- Create: `apps/mobile/app/(tabs)/more/_layout.tsx` + `index.tsx` (stub)

- [ ] **Step 1: Implement tab layout**

5 tabs: Home, Ops, Portfolio, Customers, More. Icons from `@expo/vector-icons`.

- [ ] **Step 2: Create stub screens**

Each tab shows title + "Coming soon" placeholder. Verifies navigation works.

- [ ] **Step 3: Verify all tabs navigate correctly**

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/
git commit -m "feat: mobile tab navigation shell — Home, Ops, Portfolio, Customers, More"
```

---

### Task 19: Offline Cache Layer

**Files:**
- Create: `apps/mobile/src/repositories/CacheRepository.ts`
- Create: `apps/mobile/src/repositories/CacheRepository.test.ts`
- Create: `apps/mobile/src/stores/offlineQueue.ts`
- Create: `apps/mobile/src/stores/offlineQueue.test.ts`
- Create: `apps/mobile/src/hooks/useOfflineStatus.ts`
- Create: `apps/mobile/src/components/OfflineBanner.tsx`

- [ ] **Step 1: Write CacheRepository tests**

Test interface: `get(key)`, `set(key, data, ttl)`, `clear()`, `getSchemaVersion()`.

- [ ] **Step 2: Implement CacheRepository**

SQLite-backed cache with schema version check. On version mismatch, drop and recreate.

- [ ] **Step 3: Write offline queue tests**

Test: enqueue mutation, dequeue on reconnect, retry failed mutations, mark as pending.

- [ ] **Step 4: Implement offline queue**

Zustand store with SQLite persistence. Queue shape: `{ id, endpoint, method, body, status, retries }`.

- [ ] **Step 5: Implement useOfflineStatus hook + OfflineBanner component**

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/repositories/ apps/mobile/src/stores/ apps/mobile/src/hooks/ apps/mobile/src/components/OfflineBanner.tsx
git commit -m "feat: mobile offline cache layer — SQLite cache, mutation queue, offline banner"
```

---

### Task 20: Push Notifications + Deep Linking

**Files:**
- Create: push notification registration logic in auth store
- Create: deep link configuration in app/_layout.tsx
- Create: `apps/mobile/src/hooks/useDeepLink.ts`

- [ ] **Step 1: Implement push notification registration**

On login success, request notification permissions, get Expo push token, call `/api/v1/notifications/register-device`.

- [ ] **Step 2: Implement deep linking**

Configure Expo Router linking config. Notification tap extracts `deepLink` field, navigates to route.

- [ ] **Step 3: Test notification handling**

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/
git commit -m "feat: mobile push notifications + deep linking"
```

---

### Task 21: Testing Harness + CI

**Files:**
- Create: `apps/mobile/src/mocks/server.ts`
- Create: `apps/mobile/src/mocks/handlers/*.ts`
- Create: `apps/mobile/__tests__/utils/renderWithProviders.tsx`
- Create: `apps/mobile/e2e/flows/login.yaml`
- Modify: `.github/workflows/ci.yml` (if exists) or create

- [ ] **Step 1: Setup MSW mock server**

Create server.ts with beforeAll/afterEach/afterAll lifecycle. Create handlers for all API domains.

- [ ] **Step 2: Create renderWithProviders utility**

Wraps components with auth context, Zustand providers, navigation container.

- [ ] **Step 3: Write first Maestro flow (login)**

```yaml
appId: com.dpf.mobile
---
- launchApp
- tapOn: "Email"
- inputText: "admin@example.com"
- tapOn: "Password"
- inputText: "password"
- tapOn: "Sign In"
- assertVisible: "Dashboard"
```

- [ ] **Step 4: Create EAS Build config for CI**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/
git commit -m "feat: mobile testing harness — MSW, renderWithProviders, Maestro login flow, CI config"
```

---

### Task 22: App Theming

**Files:**
- Create: `apps/mobile/src/lib/theme.ts`
- Create: `apps/mobile/src/components/ui/*.tsx` (Button, Card, Input, BottomSheet, StatusBadge)

- [ ] **Step 1: Map platform brand tokens to NativeWind theme**

Read existing CSS custom properties from web app, translate to Tailwind config.

- [ ] **Step 2: Build UI primitives**

Button, Card, Input, BottomSheet, StatusBadge. Match platform visual language.

- [ ] **Step 3: Write component tests for each primitive**

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/theme.ts apps/mobile/src/components/ui/ apps/mobile/tailwind.config.ts
git commit -m "feat: mobile app theming + UI primitives"
```

---

## Phase 3: Mobile Feature Screens (Epic EP-MOBILE-FEAT-001)

Each feature screen follows TDD: write store tests → implement store → write screen + component tests → implement screen → write Maestro E2E flow → commit.

### Task 23: Workspace Dashboard

**Files:**
- Create: `apps/mobile/src/features/workspace/workspace.store.ts`
- Create: `apps/mobile/src/features/workspace/workspace.store.test.ts`
- Create: `apps/mobile/src/components/DashboardTile.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/e2e/flows/dashboard.yaml`

- [ ] **Step 1: Write workspace store tests**

Test: `fetchDashboard()` populates tiles + calendar items; handles loading/error states; caches data in SQLite via CacheRepository.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement workspace store**

Zustand store: `tiles`, `calendarItems`, `activityFeed`, `isLoading`, `error`, `lastSynced`. `fetchDashboard()` calls `apiClient.workspace.getDashboard()`, caches in SQLite, updates `lastSynced`.

- [ ] **Step 4: Write DashboardTile component test**

Test: renders label, value, trend indicator. Accessibility: has correct `accessibilityRole`.

- [ ] **Step 5: Implement DashboardTile component**

- [ ] **Step 6: Implement Home screen**

Grid of DashboardTiles, calendar widget (FlatList of upcoming items), activity feed (FlatList), quick action buttons (create item, approve, message agent).

- [ ] **Step 7: Write Maestro E2E flow**

```yaml
appId: com.dpf.mobile
---
- launchApp
- assertVisible: "Dashboard"
- assertVisible: "Portfolio Health"
```

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/features/workspace/ apps/mobile/src/components/DashboardTile.tsx apps/mobile/app/\(tabs\)/index.tsx apps/mobile/e2e/flows/dashboard.yaml
git commit -m "feat: mobile workspace dashboard — tiles, calendar, activity feed"
```

---

### Task 24: Epic List + Detail

**Files:**
- Create: `apps/mobile/src/features/ops/ops.store.ts`
- Create: `apps/mobile/src/features/ops/ops.store.test.ts`
- Create: `apps/mobile/src/components/EpicCard.tsx`
- Create: `apps/mobile/src/components/BacklogItemCard.tsx`
- Modify: `apps/mobile/app/(tabs)/ops/index.tsx`
- Create: `apps/mobile/app/(tabs)/ops/[epicId].tsx`

- [ ] **Step 1: Write ops store tests**

Test: `fetchEpics()` returns epic list; `fetchEpicDetail(id)` returns epic with items; caches in SQLite.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement ops store**

Zustand store: `epics`, `selectedEpic`, `backlogItems`. Fetch via `apiClient.ops.getEpics()`.

- [ ] **Step 4: Write EpicCard + BacklogItemCard tests**

Test: renders title, status badge, item count. BacklogItemCard: renders title, status, priority.

- [ ] **Step 5: Implement EpicCard + BacklogItemCard components**

- [ ] **Step 6: Implement epic list screen (FlatList) and detail screen**

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/ops/ apps/mobile/src/components/EpicCard.tsx apps/mobile/src/components/BacklogItemCard.tsx apps/mobile/app/\(tabs\)/ops/
git commit -m "feat: mobile epic list + detail screens"
```

---

### Task 25: Backlog Item CRUD

**Files:**
- Modify: `apps/mobile/src/features/ops/ops.store.ts` (add create/update/delete)
- Modify: `apps/mobile/src/features/ops/ops.store.test.ts`
- Modify: `apps/mobile/app/(tabs)/ops/[epicId].tsx` (add create/edit bottom sheet)
- Create: `apps/mobile/e2e/flows/backlog-crud.yaml`

- [ ] **Step 1: Write store tests for CRUD actions**

Test: `createItem(input)` calls API + adds to local state; `updateItem(id, input)` updates; `deleteItem(id)` removes; offline queue enqueues on failure.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement CRUD actions in ops store**

Use `@dpf/validators` for input validation. On network failure, enqueue to offline queue.

- [ ] **Step 4: Add create/edit form UI (BottomSheet)**

- [ ] **Step 5: Write Maestro E2E flow**

```yaml
appId: com.dpf.mobile
---
- launchApp
- tapOn: "Ops"
- tapOn: ".*"  # first epic
- tapOn: "Create Item"
- inputText: "New backlog item"
- tapOn: "Save"
- assertVisible: "New backlog item"
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/ops/ apps/mobile/app/\(tabs\)/ops/ apps/mobile/e2e/flows/backlog-crud.yaml
git commit -m "feat: mobile backlog item CRUD with offline queue"
```

---

### Task 26: Portfolio Tree + Detail

**Files:**
- Create: `apps/mobile/src/features/portfolio/portfolio.store.ts`
- Create: `apps/mobile/src/features/portfolio/portfolio.store.test.ts`
- Create: `apps/mobile/src/components/PortfolioNode.tsx`
- Modify: `apps/mobile/app/(tabs)/portfolio/index.tsx`
- Create: `apps/mobile/app/(tabs)/portfolio/[id].tsx`

- [ ] **Step 1: Write portfolio store tests**

Test: `fetchTree()` returns hierarchy; `fetchDetail(id)` returns node with health + products; caches in SQLite.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement portfolio store**

- [ ] **Step 4: Write PortfolioNode component test**

Test: renders name, expands/collapses children on tap, shows health indicator.

- [ ] **Step 5: Implement PortfolioNode (recursive collapsible tree)**

- [ ] **Step 6: Implement list screen (tree view) and detail screen (read-only: health, budget, products)**

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/portfolio/ apps/mobile/src/components/PortfolioNode.tsx apps/mobile/app/\(tabs\)/portfolio/
git commit -m "feat: mobile portfolio tree + detail (read-only)"
```

---

### Task 27: Customer List + Detail + Edit

**Files:**
- Create: `apps/mobile/src/features/customer/customer.store.ts`
- Create: `apps/mobile/src/features/customer/customer.store.test.ts`
- Create: `apps/mobile/src/components/CustomerCard.tsx`
- Modify: `apps/mobile/app/(tabs)/customers/index.tsx`
- Create: `apps/mobile/app/(tabs)/customers/[id].tsx`
- Create: `apps/mobile/e2e/flows/customer-view.yaml`

- [ ] **Step 1: Write customer store tests**

Test: `fetchCustomers()` returns paginated list; `fetchDetail(id)` returns customer with contacts; `updateCustomer(id, input)` validates and updates.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement customer store**

- [ ] **Step 4: Write CustomerCard test + implement**

- [ ] **Step 5: Implement list screen (searchable FlatList) and detail screen (editable fields)**

- [ ] **Step 6: Write Maestro E2E flow**

```yaml
appId: com.dpf.mobile
---
- launchApp
- tapOn: "Customers"
- tapOn: ".*"  # first customer
- assertVisible: "Customer Detail"
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/customer/ apps/mobile/src/components/CustomerCard.tsx apps/mobile/app/\(tabs\)/customers/ apps/mobile/e2e/flows/customer-view.yaml
git commit -m "feat: mobile customer list + detail + edit"
```

---

### Task 28: Agent Co-Worker — Store + Components

**Files:**
- Create: `apps/mobile/src/features/agent/agent.store.ts`
- Create: `apps/mobile/src/features/agent/agent.store.test.ts`
- Create: `apps/mobile/src/components/AgentFAB.tsx`
- Create: `apps/mobile/src/components/AgentPanel.tsx`
- Create: `apps/mobile/src/hooks/useAgentRouting.ts`

- [ ] **Step 1: Write agent store tests**

Test: `sendMessage(text)` calls API; `fetchThread()` returns history; `connectSSE()` receives streaming responses; messages append to local state.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement agent store**

Zustand store: `messages`, `isStreaming`, `currentAgent`. `sendMessage` calls `apiClient.agent.sendMessage()`. `connectSSE` opens EventSource to `/api/v1/agent/stream`.

- [ ] **Step 4: Implement useAgentRouting hook**

Maps current Expo Router route to specialist agent: `/ops` → ops-coordinator, `/portfolio` → portfolio-advisor, etc. Same mapping as web `agent-routing.ts`.

- [ ] **Step 5: Write AgentFAB + AgentPanel component tests**

Test: FAB shows on all tabs; tapping opens panel; panel shows messages; send button calls store.

- [ ] **Step 6: Implement AgentFAB (floating button) + AgentPanel (bottom sheet)**

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/agent/ apps/mobile/src/components/AgentFAB.tsx apps/mobile/src/components/AgentPanel.tsx apps/mobile/src/hooks/useAgentRouting.ts
git commit -m "feat: mobile agent co-worker — store, FAB, panel, route-aware specialist"
```

---

### Task 29: Agent Co-Worker — SSE + E2E

**Files:**
- Modify: `apps/mobile/src/features/agent/agent.store.ts` (SSE integration)
- Create: `apps/mobile/e2e/flows/agent-chat.yaml`
- Modify: `apps/mobile/app/_layout.tsx` (mount AgentFAB globally)

- [ ] **Step 1: Integrate SSE streaming into agent store**

Use `react-native-sse` or `EventSource` polyfill. Connect on `sendMessage`, parse SSE events, append to messages, close on `done` event.

- [ ] **Step 2: Mount AgentFAB in root layout (persistent across all tabs)**

- [ ] **Step 3: Test SSE integration with MSW handler**

- [ ] **Step 4: Write Maestro E2E flow**

```yaml
appId: com.dpf.mobile
---
- launchApp
- tapOn: "agent-fab"
- tapOn: "Message input"
- inputText: "What's the portfolio health?"
- tapOn: "Send"
- assertVisible: "portfolio-advisor"
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/agent/ apps/mobile/app/_layout.tsx apps/mobile/e2e/flows/agent-chat.yaml
git commit -m "feat: mobile agent co-worker — SSE streaming + E2E flow"
```

---

### Task 30: Approvals Queue

**Files:**
- Create: `apps/mobile/src/features/governance/governance.store.ts`
- Create: `apps/mobile/src/features/governance/governance.store.test.ts`
- Create: `apps/mobile/src/components/ApprovalCard.tsx`
- Modify: `apps/mobile/app/(tabs)/more/approvals.tsx`
- Create: `apps/mobile/e2e/flows/approval-flow.yaml`

- [ ] **Step 1: Write governance store tests**

Test: `fetchApprovals()` returns pending proposals; `decide(id, decision)` calls API; optimistic update removes from list.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement governance store + ApprovalCard**

- [ ] **Step 4: Implement approvals screen (FlatList of ApprovalCards with swipe-to-approve/reject)**

- [ ] **Step 5: Write Maestro E2E flow**

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/governance/ apps/mobile/src/components/ApprovalCard.tsx apps/mobile/app/\(tabs\)/more/approvals.tsx apps/mobile/e2e/flows/approval-flow.yaml
git commit -m "feat: mobile approvals queue — view + approve/reject"
```

---

### Task 31: Compliance Alerts + Notifications + Profile

**Files:**
- Create: `apps/mobile/src/features/compliance/compliance.store.ts`
- Create: `apps/mobile/src/features/compliance/compliance.store.test.ts`
- Create: `apps/mobile/src/features/notifications/notifications.store.ts`
- Create: `apps/mobile/src/features/notifications/notifications.store.test.ts`
- Create: `apps/mobile/src/components/NotificationItem.tsx`
- Modify: `apps/mobile/app/(tabs)/more/compliance.tsx`
- Modify: `apps/mobile/app/(tabs)/more/notifications.tsx`
- Modify: `apps/mobile/app/(tabs)/more/profile.tsx`
- Create: `apps/mobile/e2e/flows/deep-link.yaml`

- [ ] **Step 1: Write compliance + notification store tests**

Test: compliance store fetches alerts + incidents; notification store fetches feed, marks as read.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both stores**

- [ ] **Step 4: Implement compliance screen (alert list + incident list)**

- [ ] **Step 5: Implement notification screen (FlatList with read/unread styling)**

- [ ] **Step 6: Implement profile screen (user info, logout button, notification preferences)**

- [ ] **Step 7: Write deep-link E2E flow**

Test: simulate notification deep link → verify correct screen opens.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/features/compliance/ apps/mobile/src/features/notifications/ apps/mobile/src/components/NotificationItem.tsx apps/mobile/app/\(tabs\)/more/ apps/mobile/e2e/flows/deep-link.yaml
git commit -m "feat: mobile compliance alerts, notifications, profile, deep linking"
```

---

### Task 32: Full E2E Flow Suite

- [ ] **Step 1: Run all Maestro flows and fix failures**

- [ ] **Step 2: Add any missing flows for untested screens**

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/e2e/
git commit -m "feat: complete Maestro E2E flow suite"
```

---

## Phase 4: Dynamic Content Renderer (Epic EP-MOBILE-DYN-001)

### Task 33: Form Renderer Engine
- Create: `apps/mobile/dynamic/FormRenderer.tsx`
- Create: `apps/mobile/dynamic/FormRenderer.test.tsx`
- Create: `apps/mobile/dynamic/fields/*.tsx` (all 11 field types)
- Create: `apps/mobile/dynamic/fields/index.ts` (field type registry)

- [ ] **Step 1: Write FormRenderer tests**

Test: renders correct component for each field type, validates required fields, calls onSubmit with values.

- [ ] **Step 2: Implement field type registry**

Map from `FieldType` string to React component. Each field receives `FormFieldDefinition` + `value` + `onChange`.

- [ ] **Step 3: Implement each field component**

TextField, SelectField, DateField, CameraField, SignatureField, LocationField, LookupField, MultiSelectField, RadioField, NumberField, ToggleField.

- [ ] **Step 4: Implement FormRenderer**

Takes `DynamicFormSchema`, renders fields, handles validation, manages form state, calls submit.

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/dynamic/
git commit -m "feat: dynamic form renderer with 11 field types"
```

---

### Task 34: View Renderer Engine
- Create: `apps/mobile/dynamic/ViewRenderer.tsx`
- Create: `apps/mobile/dynamic/ViewRenderer.test.tsx`
- Create: `apps/mobile/dynamic/widgets/*.tsx` (4 widget types)
- Create: `apps/mobile/dynamic/widgets/index.ts` (widget type registry)

- [ ] **Step 1: Write ViewRenderer tests**

Test: renders correct widget for each type, passes data correctly, handles loading/error states.

- [ ] **Step 2: Implement widget type registry + widgets**

StatCard, BarChart, ListView, MapWidget.

- [ ] **Step 3: Implement ViewRenderer**

Takes `DynamicViewSchema`, fetches data from `dataSource`, renders widgets in layout.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/dynamic/
git commit -m "feat: dynamic view renderer with 4 widget types"
```

---

### Task 35: Dynamic Content Integration
- Modify: Ops, Customers, More screens to show dynamic forms/views when available
- Create: form offline submission queue integration
- Create: schema version caching in MMKV

- [ ] **Step 1: Add dynamic content discovery to relevant screens**

Fetch `/api/v1/dynamic/forms` and `/api/v1/dynamic/views`, show in navigation when non-empty.

- [ ] **Step 2: Implement offline form submission**

For `offlineCapable: true` forms, cache schema + lookup data in SQLite, queue submissions.

- [ ] **Step 3: Write E2E flow**

`e2e/flows/custom-form.yaml` — navigate to dynamic form, fill fields, submit.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/
git commit -m "feat: dynamic content integration — forms + views in app navigation"
```

---

## Phase 5: Final Integration + Release Prep

### Task 36: Final E2E Validation
- Verify all Maestro flows pass
- Add any missing flows
- Configure EAS Workflows CI

### Task 37: App Store Prep
- App icons, splash screen
- Privacy policy URL, app description
- EAS Submit configuration
- TestFlight / internal testing track

### Task 38: Documentation
- Update README with mobile development instructions
- Document API endpoints (auto-generated from OpenAPI spec)
- Update CLAUDE.md with mobile-relevant conventions

---

## Checkpoint Summary

| Phase | Epic | Tasks | Deliverable |
|---|---|---|---|
| 1 | EP-REST-API-001 | 1-15 | Working REST API with JWT auth, all endpoints, shared packages |
| 2 | EP-MOBILE-FOUND-001 | 16-22 | Expo app with auth, navigation, offline cache, push, theming |
| 3 | EP-MOBILE-FEAT-001 | 23-32 | All feature screens with stores, tests, E2E flows |
| 4 | EP-MOBILE-DYN-001 | 33-35 | Dynamic form + view renderer integrated into app |
| 5 | Release | 36-38 | E2E validation, app store prep, documentation |

Each phase produces working, testable software. Review checkpoint after each phase before proceeding.

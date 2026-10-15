export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

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

/** GET /api/v1/auth/me. `platformRole` is null for a user with no role group. */
export interface MeResponse {
  id: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
  capabilities: string[];
}

export type DashboardTrend = "up" | "down" | "stable";

/** One tile of GET /api/v1/workspace/dashboard. The route sends `trend: null` until it computes one. */
export interface DashboardTile {
  area: string;
  label: string;
  value: number;
  trend?: DashboardTrend | null;
  color?: string;
}

/** GET /api/v1/workspace/dashboard. */
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

/**
 * One row of GET /api/v1/workspace/activity. The feed is a projection of
 * recently updated backlog items; `updatedAt` is an ISO date-time string.
 */
export interface ActivityItem {
  id: string;
  title: string;
  status: string;
  type: string;
  updatedAt: string;
}

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
  status?: "open" | "in-progress" | "awaiting-acceptance" | "done" | "deferred" | "retired";
  priority?: number;
  epicId?: string | null;
}

export interface ApprovalDecisionRequest {
  decision: "approve" | "reject";
  rationale?: string;
}

export interface UpdateCustomerRequest {
  name?: string;
  industry?: string;
  notes?: string;
  website?: string;
  employeeCount?: number;
  annualRevenue?: number;
  currency?: string;
  status?: string;
  parentAccountId?: string | null;
  sourceSystem?: string;
  sourceId?: string;
}

export interface CreateContactRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  source?: "web" | "referral" | "import" | "manual";
  accountId: string;
}

export interface UpdateContactRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  doNotContact?: boolean;
  avatarUrl?: string;
  isActive?: boolean;
}

export interface ContactWithRoles {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  jobTitle: string | null;
  isActive: boolean;
  doNotContact: boolean;
  accountRoles: {
    id: string;
    accountId: string;
    roleTitle: string | null;
    isPrimary: boolean;
    startedAt: string;
    endedAt: string | null;
    account: { id: string; accountId: string; name: string };
  }[];
}

export interface SimilarContact {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  confidence: number; // 0-100
  matchedOn: string; // "email" | "name" | "phone"
}

export interface RegisterDeviceRequest {
  token: string;
  platform: "ios" | "android";
}

/** POST /api/v1/upload. */
export interface UploadResponse {
  fileId: string;
  url: string;
}

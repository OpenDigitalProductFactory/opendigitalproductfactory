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

export interface MeResponse {
  id: string;
  email: string;
  platformRole: string;
  isSuperuser: boolean;
  capabilities: string[];
}

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

export interface UploadResponse {
  fileId: string;
  url: string;
}

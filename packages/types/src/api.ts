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
}

export interface RegisterDeviceRequest {
  token: string;
  platform: "ios" | "android";
}

export interface UploadResponse {
  fileId: string;
  url: string;
}

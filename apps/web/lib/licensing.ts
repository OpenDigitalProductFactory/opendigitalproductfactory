export const LICENSE_PROFILE_SETUP_STATUSES = [
  "draft",
  "investigating",
  "ready",
  "blocked",
] as const;

export const LICENSE_INVESTIGATION_MODES = [
  "unknown",
  "existing",
  "new_business",
  "expanding",
] as const;

export const LICENSE_REQUIREMENT_TYPES = [
  "license",
  "permit",
  "registration",
  "certification",
  "endorsement",
  "inspection",
  "display_rule",
  "legality_gate",
  "license_directory",
  "licence_directory",
] as const;

export const LICENSE_SCOPE_LEVELS = [
  "organization",
  "person",
  "premises",
  "activity",
  "vehicle",
  "equipment",
] as const;

export const LICENSE_RECORD_STATUSES = [
  "draft",
  "researching",
  "applied",
  "active",
  "expired",
  "suspended",
  "not_required",
  "blocked",
] as const;

export const LICENSE_REQUIREMENT_LEVELS = [
  "required",
  "recommended",
  "marketing_optional",
] as const;

export const LICENSE_PAYMENT_STATUSES = [
  "pending",
  "scheduled",
  "paid",
  "waived",
  "blocked",
] as const;

export const LICENSE_FINANCE_HANDOFF_MODES = [
  "track_only",
  "finance_review",
  "external_accounting",
] as const;

export const LICENSE_ISSUE_STATUSES = [
  "open",
  "in_progress",
  "resolved",
] as const;

export const LICENSE_ISSUE_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

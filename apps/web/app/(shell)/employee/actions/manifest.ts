import type { PageActionManifest } from "@/lib/agent-action-types";

export const employeeActions: PageActionManifest = {
  route: "/employee",
  actions: [
    {
      name: "query_employees",
      description: "Search and list employee profiles with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search by name or email" },
          department: { type: "string", description: "Filter by department" },
        },
      },
      requiredCapability: "view_employee",
      sideEffect: false,
      specRef: "EP-AGENT-CAP-001",
    },
    {
      name: "create_employee",
      description: "Create a new employee profile with name, email, department, and role",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name" },
          email: { type: "string", description: "Email address" },
          department: { type: "string", description: "Department name" },
          role: { type: "string", description: "Job title / role" },
        },
        required: ["name", "email"],
      },
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
    {
      name: "update_employee_profile",
      description: "Update an existing employee's profile fields (name, department, position, work location, employment type)",
      inputSchema: {
        type: "object",
        properties: {
          employeeId: { type: "string", description: "Employee record ID" },
          name: { type: "string", description: "Updated display name" },
          departmentId: { type: "string", description: "Department ID to assign" },
          positionId: { type: "string", description: "Position ID to assign" },
          workLocationId: { type: "string", description: "Work location ID to assign" },
          employmentTypeId: { type: "string", description: "Employment type ID to assign" },
        },
        required: ["employeeId"],
      },
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
    {
      name: "record_lifecycle_event",
      description: "Record a lifecycle event for an employee (e.g. onboarding, promotion, offboarding)",
      inputSchema: {
        type: "object",
        properties: {
          employeeId: { type: "string", description: "Employee record ID" },
          eventType: {
            type: "string",
            description: "Type of lifecycle event (e.g. ONBOARDING, PROMOTION, OFFBOARDING)",
          },
          notes: { type: "string", description: "Optional notes about the event" },
          effectiveDate: { type: "string", description: "ISO 8601 date the event takes effect" },
        },
        required: ["employeeId", "eventType"],
      },
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
    {
      name: "assign_user_role",
      description: "Assign or change the platform role of a user account",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "User account ID" },
          roleId: { type: "string", description: "Platform role ID to assign (e.g. HR-100)" },
        },
        required: ["userId", "roleId"],
      },
      requiredCapability: "manage_users",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
    {
      name: "deactivate_user",
      description: "Deactivate a user account, preventing login and access",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "User account ID to deactivate" },
        },
        required: ["userId"],
      },
      requiredCapability: "manage_users",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
  ],
};

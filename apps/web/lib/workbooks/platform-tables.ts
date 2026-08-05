// Universal Grid & Workbooks — platform-data tables (EP-GRID-WORKBOOKS, Phase 1b)
//
// Exposes existing platform datasets as grids without requiring a user-created
// Workbook. Each entry maps a registered adapter to its domain capabilities, so
// the same record a form edits can be viewed/edited as a spreadsheet. Access is
// gated by the domain's own capability (view to see, manage to edit); the
// canonical update action enforces it again on write.

import { can } from "@/lib/permissions";
import type { CapabilityKey } from "@/lib/govern/permissions";
import { gridRegistry, type AdapterContext } from "./adapter";
import "./backlog-adapter"; // self-register the backlog adapter
import "./invoice-adapter"; // self-register the invoice adapter
import "./risk-adapter"; // self-register the risk-assessment adapter
import { registerGenericReadTable, type GenericTableConfig } from "./generic-read-adapter";
import { registerPeopleSupplierTables } from "./people-supplier-registration";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type GridCapabilities,
  type DataSourceFilter,
  type SortSpec,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_GRID_ROWS,
  emptyViewConfig,
  type ViewConfig,
} from "./types";
import { WorkbookError } from "./workbook-service";

export interface PlatformUser {
  id: string;
  platformRole: string | null;
  isSuperuser: boolean;
}

/**
 * Where a platform grid lives in the portal IA. Each platform dataset is revealed
 * in-place on its own domain surface (EP-GRID-WORKBOOKS per-surface integration),
 * not on a standalone Workbooks hub. `board` marks whether the grid has a groupable
 * column suitable for a Kanban Board view.
 */
export interface PlatformTableHomeSurface {
  path: string;
  label: string;
  board: boolean;
}

export interface PlatformTableDef {
  entityType: string;
  label: string;
  description: string;
  viewCapability: CapabilityKey;
  manageCapability: CapabilityKey;
  homeSurface: PlatformTableHomeSurface;
}

// ── Generic read-only grids (Phase 2) ──────────────────────────────────────
// Any Prisma model becomes a sortable/filterable/board grid via config — no
// bespoke adapter class. Read-only by design; editable models keep their own
// validated adapters. Field lists are explicit allow-lists (no sensitive fields).
const EPIC_TABLE: GenericTableConfig = {
  entityType: "epic",
  prismaModel: "epic",
  idField: "epicId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "epicId", name: "ID", fieldType: "text", width: 160 },
    { field: "title", name: "Title", fieldType: "text", width: 360 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "open", label: "Open" },
        { key: "in-progress", label: "In Progress" },
        { key: "done", label: "Done" },
      ],
    },
    { field: "priority", name: "Priority", fieldType: "number", width: 90 },
    { field: "description", name: "Description", fieldType: "text", width: 400 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
  rollups: [
    {
      field: "itemCount",
      name: "Backlog items",
      targetModel: "backlogItem",
      // BacklogItem.epic @relation(fields: [epicId], references: [id]) → the FK
      // targets Epic.id (cuid), NOT the semantic epicId used as the grid rowId.
      foreignKeyField: "epicId",
      anchorField: "id",
      op: "count",
      width: 120,
    },
  ],
};

const DIGITAL_PRODUCT_TABLE: GenericTableConfig = {
  entityType: "digital_product",
  prismaModel: "digitalProduct",
  idField: "productId",
  labelField: "name",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "productId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 280 },
    {
      field: "lifecycleStage",
      name: "Lifecycle",
      fieldType: "select",
      width: 140,
      groupable: true,
      options: [
        { key: "plan", label: "Plan" },
        { key: "build", label: "Build" },
        { key: "run", label: "Run" },
        { key: "retire", label: "Retire" },
      ],
    },
    { field: "version", name: "Version", fieldType: "text", width: 100 },
    { field: "description", name: "Description", fieldType: "text", width: 360 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance controls — read-only grid; no PII fields (owner is a relation id,
// omitted). Select options mirror the controls page facets so board/grouping align.
const COMPLIANCE_CONTROL_TABLE: GenericTableConfig = {
  entityType: "compliance_control",
  prismaModel: "control",
  idField: "controlId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "controlId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 320 },
    {
      field: "controlType",
      name: "Type",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "preventive", label: "Preventive" },
        { key: "detective", label: "Detective" },
        { key: "corrective", label: "Corrective" },
      ],
    },
    {
      field: "implementationStatus",
      name: "Status",
      fieldType: "select",
      width: 150,
      groupable: true,
      options: [
        { key: "planned", label: "Planned" },
        { key: "in-progress", label: "In Progress" },
        { key: "implemented", label: "Implemented" },
        { key: "not-applicable", label: "Not Applicable" },
      ],
    },
    {
      field: "effectiveness",
      name: "Effectiveness",
      fieldType: "select",
      width: 160,
      options: [
        { key: "effective", label: "Effective" },
        { key: "partially-effective", label: "Partially Effective" },
        { key: "ineffective", label: "Ineffective" },
        { key: "not-assessed", label: "Not Assessed" },
      ],
    },
    { field: "nextReviewDate", name: "Next review", fieldType: "date", width: 130 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance obligations — read-only; no PII (owner is a relation id, omitted).
// category/frequency are free-form strings → text columns (no board grouping).
const COMPLIANCE_OBLIGATION_TABLE: GenericTableConfig = {
  entityType: "compliance_obligation",
  prismaModel: "obligation",
  idField: "obligationId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "obligationId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 320 },
    { field: "category", name: "Category", fieldType: "text", width: 150 },
    { field: "frequency", name: "Frequency", fieldType: "text", width: 120 },
    { field: "applicability", name: "Applicability", fieldType: "text", width: 160 },
    { field: "reviewDate", name: "Review date", fieldType: "date", width: 120 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance incidents — read-only; no PII (reporter is a relation id, omitted).
const COMPLIANCE_INCIDENT_TABLE: GenericTableConfig = {
  entityType: "compliance_incident",
  prismaModel: "complianceIncident",
  idField: "incidentId",
  labelField: "title",
  orderBy: { field: "occurredAt", dir: "desc" },
  columns: [
    { field: "incidentId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 300 },
    { field: "severity", name: "Severity", fieldType: "text", width: 110 },
    { field: "category", name: "Category", fieldType: "text", width: 140 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "regulatoryNotifiable", name: "Notifiable", fieldType: "checkbox", width: 100 },
    { field: "occurredAt", name: "Occurred", fieldType: "datetime", width: 160 },
    { field: "notificationDeadline", name: "Notify by", fieldType: "datetime", width: 160 },
  ],
};

// CRM opportunities — read-only; stage keys per the schema enum comment, so board
// grouping aligns. Money fields exposed; assignee/account are relation ids, omitted.
const OPPORTUNITY_TABLE: GenericTableConfig = {
  entityType: "opportunity",
  prismaModel: "opportunity",
  idField: "opportunityId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "opportunityId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 300 },
    {
      field: "stage",
      name: "Stage",
      fieldType: "select",
      width: 140,
      groupable: true,
      options: [
        { key: "qualification", label: "Qualification" },
        { key: "discovery", label: "Discovery" },
        { key: "proposal", label: "Proposal" },
        { key: "negotiation", label: "Negotiation" },
        { key: "closed_won", label: "Closed Won" },
        { key: "closed_lost", label: "Closed Lost" },
      ],
    },
    { field: "probability", name: "Probability", fieldType: "number", width: 110 },
    { field: "expectedValue", name: "Expected value", fieldType: "number", width: 140 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "expectedClose", name: "Expected close", fieldType: "date", width: 140 },
    { field: "isDormant", name: "Dormant", fieldType: "checkbox", width: 90 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// CRM quotes — read-only; status keys per the schema enum comment. Money exposed;
// account/opportunity relation ids omitted.
const QUOTE_TABLE: GenericTableConfig = {
  entityType: "quote",
  prismaModel: "quote",
  idField: "quoteId",
  labelField: "quoteNumber",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "quoteNumber", name: "Number", fieldType: "text", width: 160 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "draft", label: "Draft" },
        { key: "sent", label: "Sent" },
        { key: "accepted", label: "Accepted" },
        { key: "rejected", label: "Rejected" },
        { key: "expired", label: "Expired" },
        { key: "superseded", label: "Superseded" },
      ],
    },
    { field: "totalAmount", name: "Total", fieldType: "number", width: 130 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "validUntil", name: "Valid until", fieldType: "date", width: 130 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// CRM sales orders — read-only; status keys per the schema enum comment.
const SALES_ORDER_TABLE: GenericTableConfig = {
  entityType: "sales_order",
  prismaModel: "salesOrder",
  idField: "orderRef",
  labelField: "orderRef",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "orderRef", name: "Order", fieldType: "text", width: 160 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 140,
      groupable: true,
      options: [
        { key: "confirmed", label: "Confirmed" },
        { key: "in_progress", label: "In Progress" },
        { key: "fulfilled", label: "Fulfilled" },
        { key: "cancelled", label: "Cancelled" },
      ],
    },
    { field: "totalAmount", name: "Total", fieldType: "number", width: 130 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "fulfilledAt", name: "Fulfilled", fieldType: "datetime", width: 160 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// CRM engagements — read-only; status keys per the schema enum comment. contact is
// a relation id (omitted); no PII columns.
const ENGAGEMENT_TABLE: GenericTableConfig = {
  entityType: "engagement",
  prismaModel: "engagement",
  idField: "engagementId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "engagementId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 300 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "new", label: "New" },
        { key: "contacted", label: "Contacted" },
        { key: "qualified", label: "Qualified" },
        { key: "unqualified", label: "Unqualified" },
        { key: "converted", label: "Converted" },
      ],
    },
    { field: "source", name: "Source", fieldType: "text", width: 130 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Finance bills — read-only; status free-form (text, no board). Money exposed.
const BILL_TABLE: GenericTableConfig = {
  entityType: "bill",
  prismaModel: "bill",
  idField: "billRef",
  labelField: "billRef",
  orderBy: { field: "issueDate", dir: "desc" },
  columns: [
    { field: "billRef", name: "Bill", fieldType: "text", width: 150 },
    { field: "status", name: "Status", fieldType: "text", width: 120 },
    { field: "issueDate", name: "Issued", fieldType: "date", width: 120 },
    { field: "dueDate", name: "Due", fieldType: "date", width: 120 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "totalAmount", name: "Total", fieldType: "number", width: 120 },
    { field: "amountDue", name: "Due amount", fieldType: "number", width: 120 },
  ],
};

// Finance bank accounts — read-only; PII OMITTED (accountNumber, sortCode, iban,
// swift are deliberately excluded from the allow-list). Balances are view_finance-gated.
const BANK_ACCOUNT_TABLE: GenericTableConfig = {
  entityType: "bank_account",
  prismaModel: "bankAccount",
  idField: "bankAccountId",
  labelField: "name",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "name", name: "Name", fieldType: "text", width: 220 },
    { field: "bankName", name: "Bank", fieldType: "text", width: 180 },
    { field: "accountType", name: "Type", fieldType: "text", width: 120 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "currentBalance", name: "Balance", fieldType: "number", width: 130 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "lastReconciledAt", name: "Reconciled", fieldType: "datetime", width: 160 },
  ],
};

// Finance expense claims — read-only; status free-form (text). employee relation id omitted.
const EXPENSE_CLAIM_TABLE: GenericTableConfig = {
  entityType: "expense_claim",
  prismaModel: "expenseClaim",
  idField: "claimId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "claimId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 300 },
    { field: "status", name: "Status", fieldType: "text", width: 120 },
    { field: "totalAmount", name: "Total", fieldType: "number", width: 120 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "submittedAt", name: "Submitted", fieldType: "datetime", width: 160 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Finance fixed assets — read-only; status free-form (text). assignee relation id omitted.
const FIXED_ASSET_TABLE: GenericTableConfig = {
  entityType: "fixed_asset",
  prismaModel: "fixedAsset",
  idField: "assetId",
  labelField: "name",
  orderBy: { field: "purchaseDate", dir: "desc" },
  columns: [
    { field: "assetId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 260 },
    { field: "category", name: "Category", fieldType: "text", width: 150 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "purchaseDate", name: "Purchased", fieldType: "date", width: 120 },
    { field: "purchaseCost", name: "Cost", fieldType: "number", width: 120 },
    { field: "currentBookValue", name: "Book value", fieldType: "number", width: 130 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
    { field: "location", name: "Location", fieldType: "text", width: 150 },
  ],
};

// Storefront items — read-only; clean catalogue fields.
const STOREFRONT_ITEM_TABLE: GenericTableConfig = {
  entityType: "storefront_item",
  prismaModel: "storefrontItem",
  idField: "itemId",
  labelField: "name",
  orderBy: { field: "sortOrder", dir: "asc" },
  columns: [
    { field: "itemId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 260 },
    { field: "category", name: "Category", fieldType: "text", width: 150 },
    { field: "priceAmount", name: "Price", fieldType: "number", width: 110 },
    { field: "priceCurrency", name: "Currency", fieldType: "text", width: 90 },
    { field: "ctaType", name: "CTA", fieldType: "text", width: 120 },
    { field: "isActive", name: "Active", fieldType: "checkbox", width: 80 },
    { field: "sortOrder", name: "Order", fieldType: "number", width: 80 },
  ],
};

// Inventory entities — read-only; discovery catalogue. No PII.
const INVENTORY_ENTITY_TABLE: GenericTableConfig = {
  entityType: "inventory_entity",
  prismaModel: "inventoryEntity",
  idField: "entityKey",
  labelField: "name",
  orderBy: { field: "lastSeenAt", dir: "desc" },
  columns: [
    { field: "entityKey", name: "Key", fieldType: "text", width: 160 },
    { field: "name", name: "Name", fieldType: "text", width: 240 },
    { field: "entityType", name: "Type", fieldType: "text", width: 140 },
    { field: "manufacturer", name: "Manufacturer", fieldType: "text", width: 150 },
    { field: "productModel", name: "Model", fieldType: "text", width: 150 },
    { field: "supportStatus", name: "Support", fieldType: "text", width: 120 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "lastSeenAt", name: "Last seen", fieldType: "datetime", width: 160 },
  ],
};

// Rental agreements — read-only; PII OMITTED (customerEmail, customerPhone,
// customerContactId excluded). customerName retained for operator context; gated by
// view_customer. status keys per the schema enum comment → board grouping aligns.
const RENTAL_AGREEMENT_TABLE: GenericTableConfig = {
  entityType: "rental_agreement",
  prismaModel: "rentalAgreement",
  idField: "agreementRef",
  labelField: "agreementRef",
  orderBy: { field: "periodStart", dir: "desc" },
  columns: [
    { field: "agreementRef", name: "Ref", fieldType: "text", width: 150 },
    { field: "customerName", name: "Customer", fieldType: "text", width: 200 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "reserved", label: "Reserved" },
        { key: "verified", label: "Verified" },
        { key: "active", label: "Active" },
        { key: "returned", label: "Returned" },
        { key: "closed", label: "Closed" },
        { key: "cancelled", label: "Cancelled" },
      ],
    },
    { field: "pricingModel", name: "Pricing", fieldType: "text", width: 120 },
    { field: "periodStart", name: "From", fieldType: "date", width: 120 },
    { field: "periodEnd", name: "To", fieldType: "date", width: 120 },
    { field: "rateAmount", name: "Rate", fieldType: "number", width: 110 },
    { field: "currency", name: "Currency", fieldType: "text", width: 90 },
  ],
};

// Fund budget lines — read-only; civic fund-accounting. fund keys per schema enum
// comment. Uses the cuid PK as the row id (no semantic unique id on this model).
const FUND_BUDGET_LINE_TABLE: GenericTableConfig = {
  entityType: "fund_budget_line",
  prismaModel: "fundBudgetLine",
  idField: "id",
  labelField: "accountCode",
  orderBy: { field: "fiscalYear", dir: "desc" },
  columns: [
    { field: "fiscalYear", name: "FY", fieldType: "number", width: 90 },
    {
      field: "fund",
      name: "Fund",
      fieldType: "select",
      width: 160,
      groupable: true,
      options: [
        { key: "general", label: "General" },
        { key: "special-revenue", label: "Special Revenue" },
        { key: "enterprise", label: "Enterprise" },
        { key: "capital-projects", label: "Capital Projects" },
        { key: "debt-service", label: "Debt Service" },
      ],
    },
    { field: "accountCode", name: "Account", fieldType: "text", width: 140 },
    { field: "budgetedAmount", name: "Budgeted", fieldType: "number", width: 140 },
    { field: "notes", name: "Notes", fieldType: "text", width: 280 },
  ],
};

registerGenericReadTable(EPIC_TABLE);
registerGenericReadTable(DIGITAL_PRODUCT_TABLE);
registerGenericReadTable(STOREFRONT_ITEM_TABLE);
registerGenericReadTable(INVENTORY_ENTITY_TABLE);
registerGenericReadTable(RENTAL_AGREEMENT_TABLE);
registerGenericReadTable(FUND_BUDGET_LINE_TABLE);
registerGenericReadTable(COMPLIANCE_CONTROL_TABLE);
registerGenericReadTable(COMPLIANCE_OBLIGATION_TABLE);
registerGenericReadTable(COMPLIANCE_INCIDENT_TABLE);
registerGenericReadTable(OPPORTUNITY_TABLE);
registerGenericReadTable(QUOTE_TABLE);
registerGenericReadTable(SALES_ORDER_TABLE);
registerGenericReadTable(ENGAGEMENT_TABLE);
registerGenericReadTable(BILL_TABLE);
registerGenericReadTable(BANK_ACCOUNT_TABLE);
registerGenericReadTable(EXPENSE_CLAIM_TABLE);
registerGenericReadTable(FIXED_ASSET_TABLE);
// Customers, people, suppliers — allow-lists in people-supplier-configs.ts, and the
// governed write path for employee_profile in people-supplier-registration.ts.
registerPeopleSupplierTables();

/** The registry of platform datasets available as grids. Add a row per adapter. */
export const PLATFORM_TABLES: PlatformTableDef[] = [
  {
    entityType: "backlog_item",
    label: "Backlog",
    description: "Every backlog item as an editable spreadsheet — same records as the backlog forms.",
    viewCapability: "view_operations",
    manageCapability: "manage_backlog",
    homeSurface: { path: "/ops", label: "Operations", board: true },
  },
  {
    entityType: "invoice",
    label: "Invoices",
    description: "Finance invoices as a grid — edit status inline; amounts/dates stay in the invoice form.",
    viewCapability: "view_finance",
    manageCapability: "manage_finance",
    homeSurface: { path: "/finance/invoices", label: "Invoices", board: true },
  },
  {
    entityType: "risk_assessment",
    label: "Risk assessments",
    description: "Compliance risk register as an editable spreadsheet — same records as the risk forms.",
    viewCapability: "view_compliance",
    manageCapability: "manage_compliance",
    homeSurface: { path: "/compliance/risks", label: "Risk assessments", board: true },
  },
  {
    entityType: "compliance_control",
    label: "Controls",
    description: "Compliance controls as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/controls", label: "Controls", board: true },
  },
  {
    entityType: "compliance_obligation",
    label: "Obligations",
    description: "Regulatory obligations as a read-only grid — sort and filter.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/obligations", label: "Obligations", board: false },
  },
  {
    entityType: "compliance_incident",
    label: "Incidents",
    description: "Compliance incidents as a read-only grid — sort and filter.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/incidents", label: "Incidents", board: false },
  },
  {
    entityType: "opportunity",
    label: "Opportunities",
    description: "Sales opportunities as a read-only grid — sort, filter, and board by stage.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer/opportunities", label: "Opportunities", board: true },
  },
  {
    entityType: "quote",
    label: "Quotes",
    description: "Sales quotes as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer/quotes", label: "Quotes", board: true },
  },
  {
    entityType: "sales_order",
    label: "Sales orders",
    description: "Sales orders as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer/sales-orders", label: "Sales orders", board: true },
  },
  {
    entityType: "engagement",
    label: "Engagements",
    description: "CRM engagements as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer/engagements", label: "Engagements", board: true },
  },
  {
    entityType: "bill",
    label: "Bills",
    description: "Supplier bills as a read-only grid — sort and filter.",
    viewCapability: "view_finance",
    manageCapability: "view_finance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/finance/bills", label: "Bills", board: false },
  },
  {
    entityType: "bank_account",
    label: "Bank accounts",
    description: "Bank accounts as a read-only grid (no account numbers) — sort and filter.",
    viewCapability: "view_finance",
    manageCapability: "view_finance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/finance/banking", label: "Banking", board: false },
  },
  {
    entityType: "expense_claim",
    label: "Expense claims",
    description: "Expense claims as a read-only grid — sort and filter.",
    viewCapability: "view_finance",
    manageCapability: "view_finance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/finance/expense-claims", label: "Expense claims", board: false },
  },
  {
    entityType: "fixed_asset",
    label: "Assets",
    description: "Fixed assets as a read-only grid — sort and filter.",
    viewCapability: "view_finance",
    manageCapability: "view_finance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/finance/assets", label: "Assets", board: false },
  },
  {
    entityType: "storefront_item",
    label: "Storefront items",
    description: "Storefront catalogue items as a read-only grid — sort and filter.",
    viewCapability: "view_storefront",
    manageCapability: "view_storefront", // read-only grid; adapter performs no writes
    homeSurface: { path: "/storefront", label: "Storefront", board: false },
  },
  {
    entityType: "inventory_entity",
    label: "Inventory",
    description: "Discovered inventory entities as a read-only grid — sort and filter.",
    viewCapability: "view_inventory",
    manageCapability: "view_inventory", // read-only grid; adapter performs no writes
    homeSurface: { path: "/inventory", label: "Inventory", board: false },
  },
  {
    entityType: "rental_agreement",
    label: "Rental agreements",
    description: "Rental agreements as a read-only grid (no contact PII) — sort, filter, board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/rental", label: "Rental", board: true },
  },
  {
    entityType: "fund_budget_line",
    label: "Fund budgets",
    description: "Fund budget lines as a read-only grid — sort, filter, and board by fund.",
    viewCapability: "view_finance",
    manageCapability: "view_finance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/finance/funds", label: "Funds", board: true },
  },
  {
    entityType: "epic",
    label: "Epics",
    description: "Every epic as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_operations",
    manageCapability: "view_operations", // read-only grid; adapter performs no writes
    homeSurface: { path: "/ops", label: "Operations", board: true },
  },
  {
    entityType: "digital_product",
    label: "Digital products",
    description: "The product portfolio as a read-only grid — sort, filter, and board by lifecycle.",
    viewCapability: "view_portfolio",
    manageCapability: "view_portfolio", // read-only grid; adapter performs no writes
    homeSurface: { path: "/portfolio", label: "Portfolio", board: true },
  },
  {
    entityType: "customer_account",
    label: "Customers",
    description: "Customer accounts as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer", label: "Customers", board: true },
  },
  {
    entityType: "employee_profile",
    label: "People",
    description: "The team directory as an editable grid (safe fields only) — board by status.",
    viewCapability: "view_employee",
    manageCapability: "manage_user_lifecycle", // seeing the directory ≠ editing it; governed write-through
    homeSurface: { path: "/employee", label: "People", board: true },
  },
  {
    entityType: "supplier",
    label: "Suppliers",
    description: "Suppliers as an editable spreadsheet — edit safe fields inline; tax/bank details stay out.",
    viewCapability: "view_finance",
    manageCapability: "manage_finance", // validated raw-write tier (editableFields allow-list)
    // The Suppliers list lives at /finance/suppliers, so the List/Grid tabs target it.
    homeSurface: { path: "/finance/suppliers", label: "Suppliers", board: true },
  },
];

function userCtx(user: PlatformUser) {
  return { platformRole: user.platformRole, isSuperuser: user.isSuperuser };
}

export function getPlatformTable(entityType: string): PlatformTableDef | undefined {
  return PLATFORM_TABLES.find((t) => t.entityType === entityType);
}

export function getHomeSurfaceForEntity(
  entityType: string,
): PlatformTableHomeSurface | undefined {
  return getPlatformTable(entityType)?.homeSurface;
}

export function listPlatformTablesForUser(user: PlatformUser): PlatformTableDef[] {
  return PLATFORM_TABLES.filter((t) => can(userCtx(user), t.viewCapability));
}

function requireTable(user: PlatformUser, entityType: string): PlatformTableDef {
  const def = getPlatformTable(entityType);
  if (!def) throw new WorkbookError("Unknown platform table", 404);
  if (!can(userCtx(user), def.viewCapability)) {
    throw new WorkbookError("You do not have access to this data", 403);
  }
  return def;
}

export interface PlatformGridData {
  schema: {
    tableId: string;
    name: string;
    dataSource: string;
    columns: ColumnDefinition[];
    capabilities: GridCapabilities;
  };
  rows: GridRow[];
  nextCursor: string | null;
  view: ViewConfig;
}

export async function getPlatformTableGridData(
  user: PlatformUser,
  entityType: string,
  opts: { filters?: DataSourceFilter; sort?: SortSpec[]; cursor?: string | null; limit?: number } = {},
): Promise<PlatformGridData> {
  const def = requireTable(user, entityType);
  const adapter = gridRegistry.require(entityType);
  const ctx: AdapterContext = {
    userId: user.id,
    canManage: can(userCtx(user), def.manageCapability),
  };
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const columns = await adapter.getColumns(entityType);
  const { data, nextCursor } = await adapter.queryRows(entityType, {
    filters: opts.filters ?? { conditions: [], logic: "and" },
    sort: opts.sort ?? [],
    pagination: { cursor: opts.cursor ?? null, limit },
  });
  return {
    schema: {
      tableId: entityType,
      name: def.label,
      dataSource: entityType,
      columns,
      capabilities: adapter.getCapabilities(ctx),
    },
    rows: data,
    nextCursor,
    view: emptyViewConfig(columns),
  };
}

/**
 * Like getPlatformTableGridData but loads EVERY row (paginating through the
 * adapter's cursors, capped at MAX_GRID_ROWS) so the client grid — which filters,
 * sorts, groups and exports over the rows it holds — reflects the whole table, not
 * just the first page. `nextCursor` is non-null only if the cap was hit.
 */
export async function getAllPlatformTableRows(
  user: PlatformUser,
  entityType: string,
  opts: { filters?: DataSourceFilter; sort?: SortSpec[] } = {},
): Promise<PlatformGridData> {
  const def = requireTable(user, entityType);
  const adapter = gridRegistry.require(entityType);
  const ctx: AdapterContext = {
    userId: user.id,
    canManage: can(userCtx(user), def.manageCapability),
  };
  const columns = await adapter.getColumns(entityType);
  const rows: GridRow[] = [];
  let cursor: string | null = null;
  do {
    const { data, nextCursor } = await adapter.queryRows(entityType, {
      filters: opts.filters ?? { conditions: [], logic: "and" },
      sort: opts.sort ?? [],
      pagination: { cursor, limit: MAX_PAGE_SIZE },
    });
    rows.push(...data);
    cursor = nextCursor;
    // Guard against a stuck cursor that never returns rows or never clears.
    if (data.length === 0) break;
  } while (cursor && rows.length < MAX_GRID_ROWS);
  return {
    schema: {
      tableId: entityType,
      name: def.label,
      dataSource: entityType,
      columns,
      capabilities: adapter.getCapabilities(ctx),
    },
    rows,
    nextCursor: cursor,
    view: emptyViewConfig(columns),
  };
}

export async function updatePlatformCells(
  user: PlatformUser,
  entityType: string,
  rowId: string,
  changes: Record<string, CellValue>,
): Promise<GridRow> {
  const def = requireTable(user, entityType);
  if (!can(userCtx(user), def.manageCapability)) {
    throw new WorkbookError(`You do not have permission to edit ${def.label}`, 403);
  }
  const adapter = gridRegistry.require(entityType);
  if (!adapter.updateCells) throw new WorkbookError("This data source is read-only", 400);
  return adapter.updateCells(entityType, rowId, changes, {
    userId: user.id,
    canManage: true,
  });
}

// ── Reference columns (Phase 2) ─────────────────────────────────────────────
// A reference column on any workbook table points at a platform entity. The set
// of valid targets is exactly the platform tables whose adapter implements
// searchReferences, filtered to those the user may view (no leak of targets the
// viewer cannot see). Search/resolve re-check the target's view capability.

export interface ReferenceTarget {
  entityType: string;
  label: string;
}

/** Platform entities the user may reference from a workbook column. */
export function listReferenceTargets(user: PlatformUser): ReferenceTarget[] {
  const seen = new Set<string>();
  const targets: ReferenceTarget[] = [];
  for (const t of PLATFORM_TABLES) {
    if (seen.has(t.entityType)) continue;
    const adapter = gridRegistry.get(t.entityType);
    if (!adapter || typeof adapter.searchReferences !== "function") continue;
    if (!can(userCtx(user), t.viewCapability)) continue;
    seen.add(t.entityType);
    targets.push({ entityType: t.entityType, label: t.label });
  }
  return targets;
}

export async function searchPlatformReferences(
  user: PlatformUser,
  entityType: string,
  query: string,
): Promise<{ id: string; label: string }[]> {
  requireTable(user, entityType); // 404 unknown / 403 no view capability — no leak
  const adapter = gridRegistry.require(entityType);
  if (!adapter.searchReferences) {
    throw new WorkbookError("This data source cannot be referenced", 400);
  }
  return adapter.searchReferences(entityType, query);
}

export async function resolvePlatformReference(
  user: PlatformUser,
  entityType: string,
  referenceId: string,
): Promise<{ id: string; label: string } | null> {
  requireTable(user, entityType);
  const adapter = gridRegistry.require(entityType);
  if (!adapter.resolveReference) return null;
  const res = await adapter.resolveReference(entityType, referenceId);
  return res ? { id: referenceId, label: res.label } : null;
}

export interface ReferenceFieldOption {
  field: string;
  name: string;
}

/** The allow-listed fields of a reference target, available for a lookup column. */
export async function getReferenceTargetFields(
  user: PlatformUser,
  entityType: string,
): Promise<ReferenceFieldOption[]> {
  requireTable(user, entityType); // 403/404 — gated by the target's view capability
  const adapter = gridRegistry.require(entityType);
  const columns = await adapter.getColumns(entityType);
  return columns.map((c) => ({ field: c.columnId, name: c.name }));
}

#!/usr/bin/env node
/**
 * Plan 2026-09-08 §10.5 S6 — CI ratchet: no NEW local date, money, byte or
 * duration formatter in apps/web.
 *
 * The same few display formatters were hand-copied across the portal: twelve
 * identical `formatDateTime` in the integration panels, five identical
 * `formatDate` date-input helpers in the compliance forms, six copies of a
 * `toLocaleString()` timestamp, and thirty-odd `formatMoney` in finance. The
 * identical date copies now import one home:
 *
 *   dates and times  import { formatDateTime, formatDate, formatTimestamp,
 *                             formatInstant } from "@/lib/datetime";
 *   money            import { formatMoney } from "@/lib/org-locale/org-locale";
 *
 * Every other copy renders something different from the shared function (a
 * hard-coded locale, other fraction digits, another empty or invalid value), so
 * moving it would change what users see. Those copies are ALLOWLIST: a closed
 * backlog keyed `file#name`, each with the reason it has not moved. Remove an
 * entry when its file adopts the shared helper; never add one. A new local
 * definition outside the allowlist fails, as does an entry whose definition is
 * gone (stale).
 *
 * Scope: apps/web/app, apps/web/components and apps/web/lib, source only
 * (tests, .d.ts excluded). A definition is `function <name>(` or
 * `const <name> =` / `const <name>:` at any indentation, where <name> is
 * `format` or `fmt` followed by one of NAME_SUFFIXES.
 *
 * Run: node scripts/check-no-local-formatters.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

// The sanctioned homes — never flagged.
export const CANONICAL = new Set([
  "apps/web/lib/datetime.ts",
  "apps/web/lib/org-locale/org-locale.ts",
]);

export const SCAN_DIRS = ["apps/web/app", "apps/web/components", "apps/web/lib"];

export const NAME_SUFFIXES = [
  "Date",
  "DateTime",
  "Time",
  "Timestamp",
  "Money",
  "Currency",
  "Amount",
  "Price",
  "Bytes",
  "FileSize",
  "Size",
  "Duration",
  "Relative",
  "RelativeTime",
];

const NAME = `(?:format|fmt)(?:${NAME_SUFFIXES.join("|")})`;
export const DEFINITION_PATTERNS = [
  new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+(${NAME})\\s*[(<]`),
  new RegExp(`^\\s*(?:export\\s+)?const\\s+(${NAME})\\s*[:=]`),
];

const EN_GB_AMOUNT =
  'hard-coded `toLocaleString("en-GB", { minimumFractionDigits: 2 })` with no currency (2 to 3 fraction digits); org-locale `formatMoney` renders the org currency and locale, so moving it changes what users see';
const SYMBOL_EN_GB =
  "prefixes the org currency symbol to en-GB grouping with 2 to 3 fraction digits; org-locale `formatMoney` places the symbol and grouping by locale, so output differs";
const EN_US_MONEY =
  "hard-coded en-US money; org-locale would switch to the org locale and change the rendering";
const EN_GB_DATE =
  "hard-coded en-GB date; a shared date helper renders in the viewer's locale, so output differs";

// Closed backlog at the S6 baseline: `file#name` → why it has not moved.
export const ALLOWLIST = new Map([
  // Finance amounts: hard-coded en-GB, no currency.
  ...[
    "apps/web/app/(shell)/finance/RecentInvoicesTable.tsx",
    "apps/web/app/(shell)/finance/assets/AssetsTable.tsx",
    "apps/web/app/(shell)/finance/assets/[id]/page.tsx",
    "apps/web/app/(shell)/finance/banking/[id]/page.tsx",
    "apps/web/app/(shell)/finance/banking/page.tsx",
    "apps/web/app/(shell)/finance/bills/BillsTable.tsx",
    "apps/web/app/(shell)/finance/bills/[id]/page.tsx",
    "apps/web/app/(shell)/finance/close/page.tsx",
    "apps/web/app/(shell)/finance/expense-claims/ExpenseClaimsTable.tsx",
    "apps/web/app/(shell)/finance/expense-claims/[id]/page.tsx",
    "apps/web/app/(shell)/finance/invoices/InvoicesTable.tsx",
    "apps/web/app/(shell)/finance/invoices/[id]/page.tsx",
    "apps/web/app/(shell)/finance/my-expenses/MyExpensesTable.tsx",
    "apps/web/app/(shell)/finance/page.tsx",
    "apps/web/app/(shell)/finance/payment-runs/PaymentRunsTable.tsx",
    "apps/web/app/(shell)/finance/payments/PaymentsTable.tsx",
    "apps/web/app/(shell)/finance/purchase-orders/PurchaseOrdersTable.tsx",
    "apps/web/app/(shell)/finance/purchase-orders/[id]/page.tsx",
    "apps/web/app/(shell)/finance/recurring/RecurringTable.tsx",
    "apps/web/app/(shell)/finance/recurring/[id]/page.tsx",
    "apps/web/app/(shell)/finance/revenue/page.tsx",
    "apps/web/app/(shell)/finance/spend/page.tsx",
    "apps/web/app/(shell)/finance/suppliers/[id]/page.tsx",
    "apps/web/app/(storefront)/s/expense-approve/[token]/page.tsx",
    "apps/web/components/finance/CreateBillForm.tsx",
    "apps/web/components/finance/CreateExpenseForm.tsx",
    "apps/web/components/finance/CreateInvoiceForm.tsx",
    "apps/web/components/finance/CreatePOForm.tsx",
    "apps/web/components/finance/CreateRecurringForm.tsx",
    "apps/web/components/finance/PaymentRunBuilder.tsx",
  ].map((file) => [`${file}#formatMoney`, EN_GB_AMOUNT]),
  ["apps/web/components/finance/ReconciliationFeed.tsx#formatMoney", `${EN_GB_AMOUNT}; also takes Math.abs`],
  // Finance reports: org currency symbol + en-GB grouping.
  ...[
    "aged-creditors",
    "aged-debtors",
    "cash-flow",
    "outstanding",
    "profit-loss",
    "revenue-by-customer",
    "vat-summary",
  ].map((report) => [`apps/web/app/(shell)/finance/reports/${report}/page.tsx#formatMoney`, SYMBOL_EN_GB]),
  // Other money.
  ["apps/web/app/(shell)/customer/(crm)/quotes/[id]/page.tsx#formatMoney", 'renders "<code> <amount>" with runtime-default grouping and a null-to-0 coercion'],
  ["apps/web/components/finance/AiProviderFinancePanel.tsx#formatMoney", EN_US_MONEY],
  ["apps/web/components/finance/AiSpendSummaryCard.tsx#formatMoney", `${EN_US_MONEY}; a bare number with exactly 2 fraction digits`],
  ["apps/web/components/finance/AiSpendWorkspace.tsx#formatMoney", `${EN_US_MONEY}; a bare number with exactly 2 fraction digits`],
  ["apps/web/components/finance/TaxLiabilityLedgerCard.tsx#formatMoney", `${EN_US_MONEY}; coerces a Decimal`],
  ["apps/web/components/finance/TaxObligationPeriodsTable.tsx#formatMoney", `${EN_US_MONEY}; always USD, coerces a Decimal`],
  ["apps/web/components/product/BusinessProductPortfolioSection.tsx#formatMoney", 'runtime-default locale, whole units, "Mixed currencies" when no currency; org-locale defaults to the currency\'s own locale'],
  ["apps/web/components/product/direction/ProductDirectionBrief.tsx#formatMoney", 'runtime-default locale, whole units, "Mixed currencies" when no currency; org-locale defaults to the currency\'s own locale'],
  ["apps/web/components/storefront-admin/ProductSoldTracePanel.tsx#formatMoney", 'locale "en" and a "<code> <n.toFixed(2)>" fallback for an unknown currency'],
  ["apps/web/components/storefront/OrderForm.tsx#formatMoney", 'runtime-default locale and a "<code> <n.toFixed(2)>" fallback for an unknown currency'],
  ["apps/web/components/storefront/PublicExpenseItemsTable.tsx#formatMoney", 'public page: "<code> <en-GB amount>"; org-locale renders a currency symbol instead'],
  ["apps/web/components/storefront/PublicLineItemsTable.tsx#formatMoney", 'public page: "<code> <en-GB amount>"; org-locale renders a currency symbol instead'],
  ["apps/web/lib/owner-first/domain-summary.ts#formatMoney", "caller-supplied symbol with en-GB whole units"],
  ["apps/web/components/storefront-admin/ItemsManager.tsx#formatPrice", "price-type wording (from, per hour, per session) around a symbol amount"],
  ["apps/web/components/storefront/ItemCard.tsx#formatPrice", "public price-type wording (POA, From..., Per session) around the raw stored amount"],
  ["apps/web/components/workbooks/grid-field-format.ts#formatCurrency", "workbook cell format: caller-supplied symbol and precision, empty for a non-number; the workbook formatter module's own export"],
  ["apps/web/lib/ai-operations-map/project-routing-topology.ts#formatCurrency", "fixed \"$\" with toFixed(2) for AI cost text in agent-facing output"],
  ["apps/web/lib/integrations/quickbooks/import-staging.ts#formatAmount", "not display text: a toFixed(2) string for a staged QuickBooks import record"],
  // Dates and times.
  ["apps/web/components/finance/ReconciliationFeed.tsx#formatDate", EN_GB_DATE],
  ["apps/web/components/finance/TaxLiabilityLedgerCard.tsx#formatDate", EN_GB_DATE],
  ["apps/web/components/finance/TaxObligationPeriodsTable.tsx#formatDate", EN_GB_DATE],
  ["apps/web/lib/invoice-pdf.tsx#fmtDate", "en-GB 2-digit-day date printed on the invoice PDF"],
  ["apps/web/components/admin/RegionPanel.tsx#formatDate", "hard-coded en-US date"],
  ["apps/web/lib/coworker-self-assessment/review-service.ts#formatDate", "hard-coded en-US date in server-written review text"],
  ["apps/web/components/finance/TaxExecutionPanel.tsx#formatDateTime", 'hard-coded en-US medium/short styles and "Not scheduled" when empty'],
  ["apps/web/components/decision-perspective/DecisionCanvas.tsx#formatDate", 'locale "en" date and time, "Not recorded" when empty'],
  ["apps/web/components/compliance/licensing/LicensingWorkspacePanel.tsx#formatDate", 'default toLocaleDateString() with "Not set" for empty or invalid'],
  ["apps/web/components/product/direction/ProductOutcomes.tsx#formatDate", 'dateStyle "medium" with "Not scheduled" when empty'],
  ["apps/web/components/rental/RentalDeskPanel.tsx#fmtDate", "default toLocaleDateString() with no options"],
  ["apps/web/components/workspace/CalendarDetailPopover.tsx#formatDate", "weekday calendar format with an all-day branch"],
  ["apps/web/components/ui/DatePicker.tsx#formatDate", "local-calendar YYYY-MM-DD for the picker, where the compliance-form copies take the UTC day"],
  // Identical five-way copy (UTC YYYY-MM-DD for <input type="date">). Moving it
  // edits each form's <input> line, which the UX-fit gate reads as a new control
  // and so needs a measured manifest; left for a follow-up that can measure.
  ...["Control", "CorrectiveAction", "Obligation", "Policy", "Regulation"].map((form) => [
    `apps/web/components/compliance/Edit${form}Form.tsx#formatDate`,
    "identical UTC YYYY-MM-DD copy; the move needs a UX-fit manifest (edits <input> lines), deferred to a measured follow-up",
  ]),
  ["apps/web/app/(shell)/admin/scheduled-jobs/ScheduledJobsClient.tsx#formatTimestamp", "month/day with 2-digit hour and minute, no year; an em dash when empty"],
  ["apps/web/components/build/UnifiedEvidenceTimeline.tsx#formatTimestamp", "returns the raw value for an invalid date, where lib/datetime formatTimestamp returns \"Invalid Date\""],
  ["apps/web/components/platform/RouteDecisionLogClient.tsx#fmtTime", "month/day with 2-digit hour, minute and second, no year"],
  ["apps/web/components/monitoring/MetricTimeSeries.tsx#formatTime", "HH:MM from epoch seconds for a chart axis"],
  ["apps/web/components/storefront/SlotBookingFlow.tsx#formatTime", 'converts a stored "HH:MM" slot to 12-hour text; not an instant'],
  ["apps/web/components/agent/AgentMessageBubble.tsx#formatRelativeTime", 'renders "NaNd ago" for an invalid instant, where components/ui/RelativeTime renders ""'],
  ["apps/web/components/ui/RelativeTime.tsx#formatRelativeTime", "the RelativeTime component's own exported formatter"],
  ["apps/web/components/platform/AsyncOperationsTable.tsx#formatRelative", 'relative text with future ("in 5m") support and floor rounding'],
  ["apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx#formatRelative", "relative text with future support and round-to-nearest"],
  // Bytes.
  ["apps/web/app/(shell)/admin/backups/BackupsClient.tsx#formatBytes", "1024-based B/KB/MB/GB with 1 or 2 decimals and an em dash for null"],
  ["apps/web/app/(shell)/admin/backups/RestoreConfirmModal.tsx#formatBytes", "like the BackupsClient copy but with no bytes tier (512 B renders 0.5 KB)"],
  ["apps/web/components/finance/InvoiceDocumentTable.tsx#formatBytes", "1024-based, whole KB, no GB tier"],
  ["apps/web/components/monitoring/ContainerResourceTable.tsx#formatBytes", "1000-based with no space before the unit"],
  ["apps/web/components/workbooks/cell-editors.tsx#formatBytes", "1024-based, one decimal only under 10"],
  // Durations.
  ["apps/web/components/build/BuildPhaseCostCard.tsx#formatDuration", 'floored "Xm Ys" with an em dash for null'],
  ["apps/web/components/build/TaskInspector.tsx#formatDuration", 'milliseconds tier under 1s, then "Xs" / "Xm Ys"'],
  ["apps/web/components/build/VoiceRationalePlayer.tsx#formatDuration", 'media clock "m:ss"'],
  ["apps/web/components/ops/GitPromotionCandidatesPanel.tsx#formatDuration", 'rounded seconds, null for missing, "Xm" when seconds are 0'],
  ["apps/web/components/ops/SelfUpgradeClient.tsx#formatDuration", "takes a start and an end instant"],
  ["apps/web/components/workbooks/grid-field-format.ts#formatDuration", "workbook cell format from minutes or seconds with an hours tier; the workbook formatter module's own export"],
]);

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Every local formatter definition in `body`: { line, name, text }. */
export function findDefinitionLines(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pattern of DEFINITION_PATTERNS) {
      const m = pattern.exec(line);
      if (m) {
        hits.push({ line: i + 1, name: m[1], text: line.trim() });
        break;
      }
    }
  }
  return hits;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip excluded names before stat: a dangling node_modules link throws.
    if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else if (s.isFile()) {
      if (/\.test\.tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

/** Definitions outside the canonical homes and the allowlist. */
export function scanRepo(root = process.cwd()) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (CANONICAL.has(rel)) continue;
      let body;
      try {
        body = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const hit of findDefinitionLines(body)) {
        if (ALLOWLIST.has(`${rel}#${hit.name}`)) continue;
        violations.push({ file: rel, ...hit });
      }
    }
  }
  return violations;
}

/** Allowlist keys whose file no longer defines that formatter. */
export function findStaleAllowlist(root = process.cwd()) {
  const stale = [];
  for (const key of ALLOWLIST.keys()) {
    const [rel, name] = key.split("#");
    let body;
    try {
      body = readFileSync(join(root, rel), "utf8");
    } catch {
      stale.push(key);
      continue;
    }
    if (!findDefinitionLines(body).some((h) => h.name === name)) stale.push(key);
  }
  return stale;
}

function main() {
  const violations = scanRepo();
  const stale = findStaleAllowlist();

  if (violations.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 S6 — a NEW local date, money, byte or duration formatter was added.");
    console.error("");
    console.error("Import the shared one instead:");
    console.error('  import { formatDateTime, formatDate, formatTimestamp, formatInstant } from "@/lib/datetime";');
    console.error('  import { formatMoney } from "@/lib/org-locale/org-locale";');
    console.error("If none fits, extend the shared home; do not add an allowlist entry.");
    console.error("");
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
    console.error("");
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error("");
    console.error("ERROR: plan 2026-09-08 S6 — the local-formatter allowlist is stale.");
    console.error("These entries no longer have a local definition; delete them from ALLOWLIST in");
    console.error("scripts/check-no-local-formatters.mjs:");
    for (const key of stale) console.error(`  ${key}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    `✓ No new local formatters (${ALLOWLIST.size} pre-existing copies listed; shared homes: lib/datetime, lib/org-locale).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

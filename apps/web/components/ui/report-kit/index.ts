// apps/web/components/ui/report-kit/index.ts
//
// Reporting & data-display palette. Import shared, token-backed primitives:
//
//   import { StatusBadge, DataTable, FilterBar } from "@/components/ui/report-kit";
//
// See ./README.md for the full palette and usage recipes.
// Spec: docs/specs/reporting-ux-primitives-spec.md

export {
  StatusBadge,
  type StatusBadgeProps,
} from "./StatusBadge";

export {
  DataTable,
  sortRows,
  paginateRows,
  pageCount,
  type Column,
  type DataTableProps,
  type Align,
  type SortDir,
} from "./DataTable";

export {
  FilterBar,
  type FilterBarProps,
  type FacetDef,
  type FacetOption,
} from "./FilterBar";

export {
  StatCard,
  type StatCardProps,
  type StatDelta,
} from "./StatCard";

export {
  ExportButton,
  toCsv,
  type ExportButtonProps,
  type ExportColumn,
} from "./ExportButton";

export {
  intentStyle,
  resolveIntent,
  STATUS_INTENT,
  type Intent,
  type IntentStyle,
} from "./statusColors";

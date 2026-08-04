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
  CollapsibleList,
  type CollapsibleListProps,
} from "./CollapsibleList";

export {
  ExpandableCard,
  type ExpandableCardProps,
} from "./ExpandableCard";

export {
  SearchableSelect,
  type SearchableSelectProps,
  type SearchableSelectOption,
} from "./SearchableSelect";

export {
  EmptyState,
  type EmptyStateProps,
} from "./EmptyState";

export {
  Skeleton,
  type SkeletonProps,
} from "./Skeleton";

export {
  Notice,
  type NoticeProps,
  type NoticeVariant,
} from "./Notice";

export {
  KpiCard,
  type KpiCardProps,
} from "./KpiCard";

// NOTE: Chart is intentionally NOT re-exported here. It pulls in recharts
// (client-only, heavy), so it is imported via subpath to keep this barrel
// — and every server component that uses it — recharts-free:
//   import { Chart } from "@/components/ui/report-kit/Chart";

export {
  intentStyle,
  resolveIntent,
  STATUS_INTENT,
  type Intent,
  type IntentStyle,
} from "./statusColors";

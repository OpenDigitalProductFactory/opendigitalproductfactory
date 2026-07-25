// Universal Grid & Workbooks — field-type icons (EP-GRID-WORKBOOKS refinement).
//
// One lucide glyph per field type, shown in column pickers and headers so a
// column's kind reads at a glance (# for number, a calendar for date, a list for
// select, …) — the Airtable/Smartsheet convention. Purely decorative: always
// aria-hidden, so the column name stays the accessible label.

import type { ComponentType, ReactNode } from "react";
import {
  Type,
  Hash,
  Calendar,
  CalendarClock,
  SquareCheck,
  List,
  ListChecks,
  Link,
  Link2,
  Mail,
  Image as ImageIcon,
  Paperclip,
  Sigma,
  Search,
  Calculator,
  Star,
  Percent,
  DollarSign,
  Gauge,
  Clock,
  Phone,
} from "lucide-react";
import type { FieldType } from "@/lib/workbooks/types";

const ICONS: Record<FieldType, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  text: Type,
  number: Hash,
  date: Calendar,
  datetime: CalendarClock,
  checkbox: SquareCheck,
  select: List,
  multi_select: ListChecks,
  reference: Link,
  url: Link,
  email: Mail,
  image: ImageIcon,
  attachment: Paperclip,
  formula: Sigma,
  lookup: Search,
  rollup: Calculator,
  link: Link2,
  rating: Star,
  percent: Percent,
  currency: DollarSign,
  progress: Gauge,
  duration: Clock,
  phone: Phone,
};

/** A decorative icon for a column's field type (aria-hidden). */
export function FieldTypeIcon({
  fieldType,
  size = 14,
}: {
  fieldType: FieldType;
  size?: number;
}): ReactNode {
  const Icon = ICONS[fieldType] ?? Type;
  return <Icon size={size} aria-hidden />;
}

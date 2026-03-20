import type { WidgetType, ViewWidgetDefinition } from "@dpf/types";
import { StatCard } from "./StatCard";
import { BarChart } from "./BarChart";
import { ListView } from "./ListView";
import { MapWidget } from "./MapWidget";

export interface WidgetProps {
  definition: ViewWidgetDefinition;
  data: Record<string, unknown>;
}

export const widgetRegistry: Record<
  WidgetType,
  React.ComponentType<WidgetProps>
> = {
  "stat-card": StatCard,
  "bar-chart": BarChart,
  "pie-chart": BarChart,
  list: ListView,
  map: MapWidget,
};

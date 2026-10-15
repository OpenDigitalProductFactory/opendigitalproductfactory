// View authoring (red stub).
import type { ColumnDefinition } from "./types";
export interface StoredView { viewId: string; name: string; viewType: string; config: unknown; isDefault: boolean }
export function buildViewConfig(
  _input: { viewType: "grid" | "kanban"; groupByColumnId?: string; cardFields?: string[] },
  _columns: readonly ColumnDefinition[],
): { viewType: "grid" | "kanban"; config: Record<string, unknown> } {
  throw new Error("not implemented");
}
export function resolveBoardView(
  _views: readonly StoredView[],
  _viewParam: string | undefined,
  _columns: readonly ColumnDefinition[],
): { view: StoredView; groupByColumnId: string } | null {
  throw new Error("not implemented");
}

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multi-select"
  | "radio"
  | "date"
  | "camera"
  | "signature"
  | "lookup"
  | "checkbox"
  | "toggle"
  | "location";

export interface FormFieldDefinition {
  key: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  source?: string;
  maxCount?: number;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
}

export interface DynamicFormSchema {
  formId: string;
  title: string;
  version: number;
  fields: FormFieldDefinition[];
  submitAction: string;
  offlineCapable: boolean;
}

export type WidgetType = "stat-card" | "bar-chart" | "pie-chart" | "list" | "map";

export interface ViewWidgetDefinition {
  widget: WidgetType;
  dataKey: string;
  label: string;
  color?: string;
  columns?: string[];
}

export interface DynamicViewSchema {
  viewId: string;
  title: string;
  type: "dashboard" | "list" | "detail";
  layout: ViewWidgetDefinition[];
  dataSource: string;
}

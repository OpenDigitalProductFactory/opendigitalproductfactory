import type { FieldType, FormFieldDefinition } from "@dpf/types";
import { TextField } from "./TextField";
import { SelectField } from "./SelectField";
import { DateField } from "./DateField";
import { CameraField } from "./CameraField";
import { SignatureField } from "./SignatureField";
import { LocationField } from "./LocationField";
import { LookupField } from "./LookupField";
import { MultiSelectField } from "./MultiSelectField";
import { RadioField } from "./RadioField";

export interface FieldProps {
  definition: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}

export const fieldRegistry: Record<
  FieldType,
  React.ComponentType<FieldProps>
> = {
  text: TextField,
  textarea: TextField,
  number: TextField,
  select: SelectField,
  "multi-select": MultiSelectField,
  radio: RadioField,
  date: DateField,
  camera: CameraField,
  signature: SignatureField,
  lookup: LookupField,
  checkbox: SelectField,
  toggle: SelectField,
  location: LocationField,
};

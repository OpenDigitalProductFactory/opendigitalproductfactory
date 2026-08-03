// Portal form contract (BI-8E74C749). The shared, accessible primitives every
// user-facing form composes so field wiring, required/optional state, inline
// validation, submit feedback, and consequence copy are consistent for
// non-technical owners and assistive technology.
//
// See docs/platform-usability-standards.md → "User-facing form contract".

export { FormField, type FormFieldProps, type FieldControlProps } from "./FormField";
export { TextField, type TextFieldProps } from "./TextField";
export { EmailField, type EmailFieldProps } from "./EmailField";
export { SelectField, type SelectFieldProps, type SelectOption } from "./SelectField";
export {
  SearchableSelect,
  type SearchableSelectOption,
  type SearchableSelectProps,
} from "./SearchableSelect";
export { TextareaField, type TextareaFieldProps } from "./TextareaField";
export { CheckboxField, type CheckboxFieldProps } from "./CheckboxField";
export { FormStatus, type FormStatusProps } from "./FormStatus";
export { SubmitButton, type SubmitButtonProps } from "./SubmitButton";
export { ConsequenceNotice, type ConsequenceNoticeProps } from "./ConsequenceNotice";
export {
  fieldControlClass,
  fieldOptionClass,
  fieldLabelClass,
  fieldHintClass,
  fieldErrorClass,
  primaryButtonClass,
  cx,
} from "./styles";

// Field-schema helpers for the public slot-booking flow (BI-0E4A1228 /
// BI-36807E68). Kept in a standalone, dependency-free module so they are
// unit-testable without importing the heavy `SlotBookingFlow` client component.

export type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
};

// Fields the slot-booking flow already captures itself — the calendar step owns
// the date and the slot step owns the time — plus the contact fields FormStep
// renders explicitly. These are dropped from the archetype's inquiry schema so
// the confirmation step never shows a blank duplicate "Preferred date/time"
// after a slot has already been chosen.
export const SLOT_FLOW_HANDLED_FIELD_NAMES = new Set<string>([
  // contact fields rendered explicitly above the schema fields
  "name",
  "email",
  "phone",
  "notes",
  "message",
  // scheduling fields the calendar + slot steps already captured
  "date",
  "time",
  "datetime",
  "slot",
  "scheduledat",
  "preferreddate",
  "preferredtime",
]);

function canonicalFieldName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, "");
}

/** The archetype schema fields the confirmation form should still render — i.e.
 *  everything the slot-booking flow does not already own (contact fields and the
 *  scheduled date/time). Names are matched case-, separator-, and
 *  whitespace-insensitively, so `preferred-date`, `Preferred Date`, and
 *  `preferredDate` all resolve to the same handled field. */
export function slotFlowExtraFields(formSchema?: FormField[]): FormField[] {
  return (formSchema ?? []).filter(
    (f) => !SLOT_FLOW_HANDLED_FIELD_NAMES.has(canonicalFieldName(f.name)),
  );
}

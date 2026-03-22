// Operating hours types and constants — shared by server actions and tests.
// Separated from the "use server" module to avoid server action export restrictions.

export type DaySchedule = {
  enabled: boolean;
  open: string;  // "HH:mm"
  close: string; // "HH:mm"
};

export type WeeklySchedule = {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
};

export const GENERIC_DEFAULTS: WeeklySchedule = {
  monday:    { enabled: true, open: "09:00", close: "17:00" },
  tuesday:   { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday:  { enabled: true, open: "09:00", close: "17:00" },
  friday:    { enabled: true, open: "09:00", close: "17:00" },
  saturday:  { enabled: false, open: "09:00", close: "17:00" },
  sunday:    { enabled: false, open: "09:00", close: "17:00" },
};

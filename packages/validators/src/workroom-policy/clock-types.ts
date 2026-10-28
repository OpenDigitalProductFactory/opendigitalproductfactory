/** Structural clock inputs from the existing operating-hours owner; no second calendar. */
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

export type LowTrafficWindow = {
  dayOfWeek: number;
  start: string;
  end: string;
};

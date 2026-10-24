/** Client-safe veterinary vocabulary and projection types (BI-97290291). No database import. */

export const VET_VISIT_KINDS = ["checkup", "vaccination", "sterilization", "dental", "emergency", "other"] as const;
export type VetVisitKind = (typeof VET_VISIT_KINDS)[number];

/** Defaults a rescue can override per visit; recovery is what blocks placement afterwards. */
export const VET_VISIT_DEFAULTS: Record<VetVisitKind, { label: string; durationMinutes: number; recoveryMinutes: number; code: string }> = {
  checkup: { label: "Check-up", durationMinutes: 30, recoveryMinutes: 0, code: "vet-checkup" },
  vaccination: { label: "Vaccination", durationMinutes: 20, recoveryMinutes: 0, code: "vet-vaccination" },
  sterilization: { label: "Spay / neuter surgery", durationMinutes: 90, recoveryMinutes: 7 * 24 * 60, code: "vet-sterilization" },
  dental: { label: "Dental", durationMinutes: 60, recoveryMinutes: 24 * 60, code: "vet-dental" },
  emergency: { label: "Emergency", durationMinutes: 60, recoveryMinutes: 24 * 60, code: "vet-emergency" },
  other: { label: "Other procedure", durationMinutes: 45, recoveryMinutes: 0, code: "vet-other" },
};

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Requested",
  booked: "Booked",
  arrived: "At the practice",
  fulfilled: "Done",
  "no-show": "Missed",
  cancelled: "Cancelled",
  "entered-in-error": "Entered in error",
};

export interface PartnerPracticeCard {
  locationId: string;
  supplierId: string | null;
  name: string;
  contactName: string | null;
  phone: string | null;
  arrangement: string | null;
}

export interface VetAppointmentCard {
  appointmentId: string;
  version: number;
  status: string;
  kind: VetVisitKind | null;
  kindLabel: string;
  animalProfileId: string;
  animalName: string;
  animalRef: string;
  practiceName: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  recoveryUntil: string | null;
  inRecovery: boolean;
  note: string | null;
}

export interface VeterinaryWorkspace {
  appointments: VetAppointmentCard[];
  practices: PartnerPracticeCard[];
  animals: Array<{ animalProfileId: string; name: string; animalRef: string }>;
  limit: number;
}

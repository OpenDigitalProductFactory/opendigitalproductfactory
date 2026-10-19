/** Existing TAK consequence vocabulary; classification and enforcement stay host-owned. */
export const CONSEQUENCE_CLASSES = ["routine-read", "ordinary-mutation", "consequential-mutation"] as const;
export type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];
export type ToolConsequence = "outward" | "irreversible" | "authority";
export const TOOL_CONSEQUENCES: readonly ToolConsequence[] = ["outward", "irreversible", "authority"] as const;
/** Only the classification facts read by the offline compiler. */
export type GppToolClassification = { class: ConsequenceClass; consequential: boolean; alignmentRequired: boolean };

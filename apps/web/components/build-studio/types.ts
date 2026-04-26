export type StepState = "done" | "active" | "waiting" | "queued" | "failed";

export interface Step {
  id: "ideate" | "plan" | "build" | "review" | "ship";
  label: string;
  verb: string;
  state: StepState;
  when: string;
  progress?: number;
  total?: number;
}

// Card kinds that render INSIDE a Message bubble via `msg.cards[]`.
// NOTE: Choice cards do NOT appear here — they flow through `Message.choices`,
// not `Message.cards`. See the `Choice` type below.
export type CardKind =
  | "step-ref"
  | "plan-summary"
  | "files-touched"
  | "verification-strip"
  | "callout-decision";

export interface MessageCard {
  kind: CardKind;
  refStep?: Step["id"]; // populated when kind === "step-ref"
}

export interface Choice {
  id: string;
  label: string;
  picked: string;
  options: string[];
}

export interface Message {
  role: "user" | "assistant";
  time: string;
  text: string;
  needsAction?: boolean;
  choices?: Choice[];
  cards?: MessageCard[];
}

export type FileTouchedKind = "new" | "modified" | "deleted";

export interface FileTouched {
  name: string;
  detail: string;
  kind: FileTouchedKind;
}

export type StoryStepResult = "passed" | "running" | "failed" | "queued";

export interface StoryStep {
  idx: number;
  title: string;
  result: StoryStepResult;
  caption: string;
}

export interface SchemaChange {
  verb: string;
  what: string;
  detail: string;
}

export interface SchemaRisk {
  level: "low" | "medium" | "high";
  text: string;
}

export interface SchemaPlain {
  area: string;
  changes: SchemaChange[];
  risks: SchemaRisk[];
}

export interface Acceptance {
  id: string;
  text: string;
  met: boolean;
  note?: string;
}

export type RiskBand = "low" | "medium" | "high";

export interface PendingApproval {
  id: string;
  title: string;
  step: string;
  risk: RiskBand;
  age: string;
  current?: boolean;
}

export interface BuildSummary {
  title: string;
  subtitle: string;
  requestedBy: string;
  requestedAt: string;
  branch: string;
  buildId: string;
}

export type ArtifactView = "preview" | "verification" | "schema" | "diff";

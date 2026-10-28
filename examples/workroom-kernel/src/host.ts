import { iterationOf, markedStageKeys, readStoredDriveMarking, startDriveMarking, stepDriveMarking, type DriveMarking, type DriveGateVerdict } from "../kernel/workroom/index.js";
import { practices, type RoomId } from "./practices.js";

export type Context = { actorId: string };
export const owner: Context = { actorId: "human:owner" };
export const worker = (actorId: string): Context => ({ actorId });
type Runtime = { profileVersion: number; bindingVersion: number };
type Subject = { roomId: string; definitionKey: string; definitionVersion: string; runKey: string; cycle: number; stageKey: string; iteration: number; actorId: string; profileId: string; profileVersion: number; bindingId: string; bindingVersion: number; authorityEpoch: number };
type EvidenceRef = { id: string; revision: number; content: string };
export type Completion = Subject & { attemptId: string; kind: string; revision: number; content: string; inputs: EvidenceRef[]; verdict?: "admit" | "refuse" | "hold" | "escalate" };
type Artifact = Completion & { id: string; protectedContent: string; protectedInputs: string };
type Attempt = { id: string; subject: Subject; status: "pending" | "uncertain" | "no-effect" | "applied"; payload?: string; artifactId?: string; noEffectEvidence?: string };
type Room = { definitionKey: string; definitionVersion: string; runKey: string; marking: DriveMarking; epoch: number; revoked: boolean; cycles: number; outcome: "active" | "accepted" | "held" };
export type SampleState = { rooms: Record<string, Room>; artifacts: Artifact[]; attempts: Attempt[]; admissions: Array<{ subject: string; payload: string; decidedBy: string }> };
type Result = { ok: boolean; code: string };
const NOW = new Date("2026-10-18T12:00:00.000Z");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
class Held extends Error { constructor(readonly code: string) { super(code); } }
const requireFact = (condition: unknown, code: string): void => { if (!condition) throw new Held(code); };
function initialState(): SampleState {
  const rooms: SampleState["rooms"] = {};
  for (const id of Object.keys(practices) as RoomId[]) {
    const practice = practices[id];
    rooms[id] = { definitionKey: practice.key, definitionVersion: practice.version, runKey: "run:1", marking: startDriveMarking(practice.shape, "run:1", NOW), epoch: 1, revoked: false, cycles: 1, outcome: "active" };
  }
  return { rooms, artifacts: [], attempts: [], admissions: [] };
}

/** A bounded sample adapter. The extracted kernel owns progression/rework;
 * this fixture owns one in-memory commit and test-harness observations. No
 * authentication, provider, shell or transport is implemented. */
export class FixtureHost {
  private state: SampleState;
  private readonly runtime: Runtime;
  constructor(state?: SampleState, runtime: Partial<Runtime> = {}) { this.state = clone(state ?? initialState()); this.runtime = { profileVersion: 1, bindingVersion: 1, ...runtime }; }
  snapshot(): SampleState { return clone(this.state); }
  private transact(work: (state: SampleState) => string): Result {
    const next = clone(this.state);
    try { const code = work(next); this.state = next; return { ok: true, code }; }
    catch (error) { if (error instanceof Held) return { ok: false, code: error.code }; throw error; }
  }
  private room(state: SampleState, id: string): Room {
    requireFact(Object.hasOwn(practices, id) && Object.hasOwn(state.rooms, id), "unknown-room");
    const room = state.rooms[id]!;
    const practice = practices[id as RoomId];
    requireFact(room.definitionKey === practice.key && room.definitionVersion === practice.version, "stale-definition");
    requireFact(room.marking.cycleKey === room.runKey, "stale-run");
    const read = readStoredDriveMarking({ workroomDrive: { marking: room.marking } }, practice.shape, null, NOW);
    requireFact(read.ok, "marking-unreadable");
    return room;
  }
  private subject(state: SampleState, id: string): Subject {
    const room = this.room(state, id);
    const practice = practices[id as RoomId];
    requireFact(room.outcome === "active", "cycle-held");
    const stageKey = markedStageKeys(practice.shape, room.marking)[0];
    requireFact(stageKey, "completed");
    const actorId = practice.assignments[stageKey!]!;
    return { roomId: id, definitionKey: room.definitionKey, definitionVersion: room.definitionVersion, runKey: room.runKey, cycle: room.cycles, stageKey: stageKey!, iteration: iterationOf(room.marking, stageKey!), actorId, profileId: `fixture.profile:${actorId}`, bindingId: `fixture.binding:${room.definitionKey}:${stageKey}`, ...this.runtime, authorityEpoch: room.epoch };
  }
  describe(id: string) {
    const room = this.room(this.state, id);
    if (room.marking.tokens.length === 0) return { completed: room.outcome === "accepted", held: room.outcome === "held", stageKey: "", actorId: "", humanRequired: false, iteration: 0, runKey: room.runKey };
    const subject = this.subject(this.state, id);
    return { ...subject, completed: false, humanRequired: practices[id as RoomId].humanStages.includes(subject.stageKey) };
  }
  private authorized(state: SampleState, subject: Subject, context: Context): void {
    const room = this.room(state, subject.roomId);
    requireFact(!room.revoked && room.epoch === subject.authorityEpoch, "authority-revoked");
    requireFact(subject.profileVersion === this.runtime.profileVersion && subject.bindingVersion === this.runtime.bindingVersion, "stale-runtime");
    requireFact(subject.profileId === `fixture.profile:${subject.actorId}` && subject.bindingId === `fixture.binding:${room.definitionKey}:${subject.stageKey}`, "stale-runtime");
    requireFact(context.actorId === subject.actorId && practices[subject.roomId as RoomId].assignments[subject.stageKey] === subject.actorId, "wrong-actor");
  }
  private validArtifact(state: SampleState, artifact: Artifact, visited = new Set<string>()): boolean {
    if (visited.has(artifact.id)) return false;
    const room = state.rooms[artifact.roomId];
    const practice = practices[artifact.roomId as RoomId];
    if (!room || !practice || room.revoked || artifact.authorityEpoch !== room.epoch || room.definitionKey !== practice.key || room.definitionVersion !== practice.version
      || artifact.definitionKey !== room.definitionKey || artifact.definitionVersion !== room.definitionVersion
      || artifact.runKey !== room.runKey || artifact.cycle !== room.cycles || artifact.iteration !== iterationOf(room.marking, artifact.stageKey)
      || artifact.actorId !== practice.assignments[artifact.stageKey] || artifact.profileVersion !== this.runtime.profileVersion || artifact.bindingVersion !== this.runtime.bindingVersion
      || artifact.profileId !== `fixture.profile:${artifact.actorId}` || artifact.bindingId !== `fixture.binding:${room.definitionKey}:${artifact.stageKey}`
      || artifact.kind !== "fixture.observed" || artifact.revision !== 1 || artifact.content !== artifact.protectedContent || canonical(artifact.inputs) !== artifact.protectedInputs) return false;
    const attempt = state.attempts.find(value => value.id === artifact.attemptId);
    const { id: _id, protectedContent: _content, protectedInputs: _inputs, ...completion } = artifact;
    if (!attempt || attempt.status !== "applied" || attempt.artifactId !== artifact.id || attempt.payload !== canonical(completion)) return false;
    if (practice.humanStages.includes(artifact.stageKey) && !state.admissions.some(admission => admission.subject === canonical(attempt.subject) && admission.payload === canonical(completion) && admission.decidedBy === owner.actorId)) return false;
    const seen = new Set(visited); seen.add(artifact.id);
    return artifact.inputs.every(ref => {
      const input = state.artifacts.find(value => value.id === ref.id);
      return !!input && input.revision === ref.revision && input.content === ref.content && this.validArtifact(state, input, seen);
    });
  }
  private evidence(state: SampleState, id: string, stageKey: string): Artifact {
    const room = this.room(state, id);
    const artifact = [...state.artifacts].reverse().find(value => value.roomId === id && value.stageKey === stageKey && value.runKey === room.runKey && value.iteration === iterationOf(room.marking, stageKey));
    requireFact(artifact, "missing-evidence");
    requireFact(this.validArtifact(state, artifact!), "stale-evidence");
    return artifact!;
  }
  private inputs(state: SampleState, subject: Subject): EvidenceRef[] {
    const practice = practices[subject.roomId as RoomId];
    const index = practice.shape.stages.findIndex(stage => stage.key === subject.stageKey);
    const artifacts: Artifact[] = [];
    if (index > 0) artifacts.push(this.evidence(state, subject.roomId, practice.shape.stages[index - 1]!.key));
    if (subject.roomId === "customer-report" && subject.stageKey === "draft") {
      requireFact(this.room(state, "self-improvement").outcome === "accepted", "dependency-held");
      artifacts.push(this.evidence(state, "self-improvement", "release"));
    }
    return artifacts.map(artifact => ({ id: artifact.id, revision: artifact.revision, content: artifact.content }));
  }
  begin(id: string, attemptId: string, context: Context): Result {
    return this.transact(state => {
      const subject = this.subject(state, id);
      this.authorized(state, subject, context);
      requireFact(/^[a-zA-Z0-9:_-]{3,100}$/.test(attemptId), "invalid-attempt");
      requireFact(!state.attempts.some(attempt => attempt.id === attemptId), "attempt-id-used");
      const active = state.attempts.find(attempt => attempt.subject.roomId === id && (attempt.status === "pending" || attempt.status === "uncertain"));
      requireFact(!active, active?.status === "uncertain" ? "uncertain-effect" : "attempt-pending");
      this.inputs(state, subject);
      state.attempts.push({ id: attemptId, subject, status: "pending" });
      return "begun";
    });
  }
  approve(completion: Completion, context: Context): Result {
    return this.transact(state => {
      requireFact(context.actorId === owner.actorId, "wrong-owner");
      const id = completion.roomId;
      const subject = this.subject(state, id);
      requireFact(!this.room(state, id).revoked, "authority-revoked");
      requireFact(practices[id as RoomId].humanStages.includes(subject.stageKey), "not-human-stage");
      const attempt = state.attempts.find(value => value.id === completion.attemptId);
      requireFact(attempt?.status === "pending" && canonical(attempt.subject) === canonical(subject), "wrong-attempt");
      for (const key of Object.keys(subject) as Array<keyof Subject>) requireFact(completion[key] === subject[key], "wrong-subject");
      requireFact(canonical(completion.inputs) === canonical(this.inputs(state, subject)), "wrong-inputs");
      state.admissions.push({ subject: canonical(subject), payload: canonical(completion), decidedBy: context.actorId });
      return "admitted";
    });
  }
  observation(id: string, attemptId: string, content: string, verdict: Completion["verdict"] = "admit"): Completion {
    const subject = this.subject(this.state, id);
    return { ...subject, attemptId, kind: "fixture.observed", revision: 1, content, inputs: this.inputs(this.state, subject), verdict };
  }
  complete(completion: Completion, context: Context): Result {
    return this.transact(state => {
      const attempt = state.attempts.find(value => value.id === completion.attemptId);
      requireFact(attempt, "unknown-attempt");
      // Current authority is checked before fresh completion AND replay.
      this.authorized(state, attempt!.subject, context);
      const payload = canonical(completion);
      if (attempt!.status === "applied") {
        requireFact(attempt!.payload === payload, "replay-conflict");
        const artifact = state.artifacts.find(value => value.id === attempt!.artifactId);
        requireFact(artifact && this.validArtifact(state, artifact), "stale-evidence");
        return "replayed";
      }
      requireFact(attempt!.status === "pending", attempt!.status === "uncertain" ? "uncertain-effect" : "settled-attempt");
      const subject = this.subject(state, attempt!.subject.roomId);
      requireFact(canonical(subject) === canonical(attempt!.subject), "stale-subject");
      for (const key of Object.keys(subject) as Array<keyof Subject>) requireFact(completion[key] === subject[key], "wrong-subject");
      requireFact(completion.kind === "fixture.observed" && completion.revision === 1 && typeof completion.content === "string" && completion.content.length > 0 && completion.content.length <= 2048, "invalid-observation");
      requireFact(canonical(completion.inputs) === canonical(this.inputs(state, subject)), "wrong-inputs");
      const practice = practices[subject.roomId as RoomId];
      if (practice.humanStages.includes(subject.stageKey)) requireFact(state.admissions.some(admission => admission.subject === canonical(subject) && admission.payload === payload && admission.decidedBy === owner.actorId), "human-decision-required");
      const stage = practice.shape.stages.find(stage => stage.key === subject.stageKey)!;
      const gated = stage.advance.kind === "governed-decision";
      requireFact(!gated || ["admit", "refuse", "hold", "escalate"].includes(completion.verdict ?? ""), "missing-verdict");
      const artifact: Artifact = { ...clone(completion), id: `artifact:${completion.attemptId}`, protectedContent: completion.content, protectedInputs: canonical(completion.inputs) };
      state.artifacts.push(artifact);
      attempt!.status = "applied"; attempt!.payload = payload; attempt!.artifactId = artifact.id;
      const room = this.room(state, subject.roomId);
      const receipts = state.artifacts.filter(value => value.roomId === subject.roomId && this.validArtifact(state, value)).map(value => ({ stageKey: value.stageKey, iteration: value.iteration, runKey: value.runKey, kind: value.kind }));
      const verdicts: Record<string, DriveGateVerdict> = gated ? { [subject.stageKey]: { verdict: completion.verdict!, mode: "enforced", iteration: subject.iteration } } : {};
      const step = stepDriveMarking(practice.shape, room.marking, { receipts, verdicts }, NOW);
      room.marking = step.marking;
      room.outcome = step.stopped ? step.stopped.kind === "success" ? "accepted" : "held" : "active";
      return "committed";
    });
  }
  revoke(id: string, context: Context): Result { return this.transact(state => { requireFact(context.actorId === owner.actorId, "wrong-owner"); const room = this.room(state, id); room.revoked = true; room.epoch += 1; return "revoked"; }); }
  markUncertain(attemptId: string, context: Context): Result { return this.transact(state => { requireFact(context.actorId === owner.actorId, "wrong-owner"); const attempt = state.attempts.find(value => value.id === attemptId); requireFact(attempt?.status === "pending", "not-pending"); attempt!.status = "uncertain"; return "held-uncertain"; }); }
  confirmNoEffect(attemptId: string, evidence: string, context: Context): Result { return this.transact(state => { requireFact(context.actorId === owner.actorId, "wrong-owner"); const attempt = state.attempts.find(value => value.id === attemptId); requireFact(attempt?.status === "uncertain", "not-uncertain"); requireFact(evidence.trim().length > 0, "missing-no-effect-evidence"); attempt!.status = "no-effect"; attempt!.noEffectEvidence = evidence; return "observed-no-effect"; }); }
  startNextCycle(id: string, runKey: string, context: Context): Result {
    return this.transact(state => {
      requireFact(context.actorId === owner.actorId, "wrong-owner");
      const room = this.room(state, id);
      requireFact(!room.revoked, "authority-revoked");
      requireFact(room.outcome === "accepted" && room.marking.tokens.length === 0 && room.cycles < 2 && runKey.length > 0 && runKey !== room.runKey, "cycle-held");
      const read = readStoredDriveMarking({ workroomDrive: { marking: room.marking } }, practices[id as RoomId].shape, runKey, NOW);
      requireFact(read.ok && read.data.source === "new-run", "cycle-held");
      if (!read.ok) throw new Held("cycle-held");
      room.marking = read.data.marking; room.runKey = runKey; room.cycles += 1; room.outcome = "active";
      return "new-cycle";
    });
  }
}

// Coworker Simulation & Eval Harness — dispatch process simulation (H1).
//
// A deterministic, event-driven in-memory dispatch world. The reference
// dispatcher confirms, assigns, fires on-my-way / running-late from real
// geo-temporal routing (planDrive over the VirtualClock), and invoices on
// completion. Oracles (oracles.ts) then assert the process invariants.
//
// This is the harness's REFERENCE domain — self-contained so the harness core is
// worktree-verifiable without cross-package linking. The job-status subset and
// the notification events mirror @dpf/validators FIELD_DISPATCH_JOB_STATUSES /
// the F2a notification events, which remain the source of truth; the real-domain
// adapter (binding F1/F2a + the F2b server actions) is the integration step.
//
// See 2026-06-14-coworker-simulation-eval-harness-design.html (§6, §7).

import { type GeoPoint } from "./geo-temporal";
import { type MobileFieldSignal, isRunningLate, planDrive } from "./mobile-signals";
import { DAY, HOUR, type Instant, MINUTE, VirtualClock } from "./virtual-clock";

/** Subset of @dpf/validators FIELD_DISPATCH_JOB_STATUSES the reference domain uses. */
export type SimJobStatus = "scheduled" | "confirmed" | "en-route" | "on-site" | "complete" | "invoiced" | "cancelled";

export type DispatchNotificationEvent = "confirm" | "on-my-way" | "running-late" | "complete";

export interface SimCustomer {
  id: string;
  site: GeoPoint;
  /** Whether the customer has any verified reachable channel (else notifications fail). */
  reachable: boolean;
}
export interface SimTechnician {
  id: string;
  home: GeoPoint;
}
export interface SimJob {
  id: string;
  customerId: string;
  technicianId?: string;
  status: SimJobStatus;
  scheduledFor: Instant;
  /** Promised-arrival-by instant; ETA past it is "running late". */
  windowEnd: Instant;
  serviceMs: number;
  confirmedAt?: Instant;
  enRouteAt?: Instant;
  arrivedAt?: Instant;
  completedAt?: Instant;
  etaAt?: Instant;
}
export interface NotificationRecord {
  jobId: string;
  event: DispatchNotificationEvent;
  at: Instant;
  delivered: boolean;
}
export interface InvoiceRecord {
  jobId: string;
  at: Instant;
}
export interface ExceptionRecord {
  jobId: string;
  reason: string;
  at: Instant;
}
export interface TraceEntry {
  at: Instant;
  kind: string;
  jobId: string;
}

export interface WorldSnapshot {
  now: Instant;
  jobs: SimJob[];
  customers: SimCustomer[];
  technicians: SimTechnician[];
  notifications: NotificationRecord[];
  invoices: InvoiceRecord[];
  exceptions: ExceptionRecord[];
  signals: MobileFieldSignal[];
  trace: TraceEntry[];
}

/** Mutable in-memory dispatch world + the governed-equivalent domain actions. */
export class DispatchSimWorld {
  readonly clock: VirtualClock;
  readonly jobs: SimJob[] = [];
  readonly customers = new Map<string, SimCustomer>();
  readonly technicians = new Map<string, SimTechnician>();
  readonly notifications: NotificationRecord[] = [];
  readonly invoices: InvoiceRecord[] = [];
  readonly exceptions: ExceptionRecord[] = [];
  readonly signals: MobileFieldSignal[] = [];
  readonly trace: TraceEntry[] = [];

  constructor(clock: VirtualClock) {
    this.clock = clock;
  }

  addTechnician(t: SimTechnician): void {
    this.technicians.set(t.id, t);
  }
  addCustomer(c: SimCustomer): void {
    this.customers.set(c.id, c);
  }
  addJob(j: SimJob): void {
    this.jobs.push(j);
  }
  private job(id: string): SimJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }
  private record(kind: string, jobId: string): void {
    this.trace.push({ at: this.clock.now(), kind, jobId });
  }

  // --- domain actions (intentionally permissive so a buggy dispatcher can violate
  //     an invariant and the oracles can catch it) ---

  assign(jobId: string, technicianId: string): void {
    const job = this.job(jobId);
    if (!job) return;
    job.technicianId = technicianId;
    this.record("assign", jobId);
  }

  /** Records a customer notification + its delivery outcome; failures surface as exceptions. */
  notify(jobId: string, event: DispatchNotificationEvent): boolean {
    const job = this.job(jobId);
    const customer = job ? this.customers.get(job.customerId) : undefined;
    const delivered = customer?.reachable ?? false;
    this.notifications.push({ jobId, event, at: this.clock.now(), delivered });
    if (!delivered) {
      this.exceptions.push({ jobId, reason: `notify-${event}-undeliverable`, at: this.clock.now() });
    }
    this.record(`notify:${event}:${delivered ? "ok" : "failed"}`, jobId);
    return delivered;
  }

  confirm(jobId: string): void {
    const job = this.job(jobId);
    if (!job) return;
    job.confirmedAt = this.clock.now();
    if (job.status === "scheduled") job.status = "confirmed";
    this.record("confirm", jobId);
  }

  markEnRoute(jobId: string, etaAt: Instant): void {
    const job = this.job(jobId);
    if (!job) return;
    job.status = "en-route";
    job.enRouteAt = this.clock.now();
    job.etaAt = etaAt;
    this.record("en-route", jobId);
  }

  markArrived(jobId: string): void {
    const job = this.job(jobId);
    if (!job) return;
    job.status = "on-site";
    job.arrivedAt = this.clock.now();
    this.record("on-site", jobId);
  }

  markComplete(jobId: string): void {
    const job = this.job(jobId);
    if (!job) return;
    job.status = "complete";
    job.completedAt = this.clock.now();
    this.record("complete", jobId);
  }

  invoice(jobId: string): void {
    const job = this.job(jobId);
    if (!job) return;
    job.status = "invoiced";
    this.invoices.push({ jobId, at: this.clock.now() });
    this.record("invoice", jobId);
  }

  emit(signal: MobileFieldSignal): void {
    this.signals.push(signal);
  }

  snapshot(): WorldSnapshot {
    return {
      now: this.clock.now(),
      jobs: this.jobs.map((j) => ({ ...j })),
      customers: [...this.customers.values()],
      technicians: [...this.technicians.values()],
      notifications: [...this.notifications],
      invoices: [...this.invoices],
      exceptions: [...this.exceptions],
      signals: [...this.signals],
      trace: [...this.trace],
    };
  }
}

/** The dispatcher policy under test — the reference baseline, or (later) the AI coworker. */
export interface Dispatcher {
  /** Day-start: confirmation watch (T-24h) + assignment. */
  plan(world: DispatchSimWorld): void;
  /** Technician departed for a job: on-my-way (+ running-late if the ETA slips the window). */
  onDeparted(world: DispatchSimWorld, jobId: string, arrivalEta: Instant, windowEnd: Instant): void;
  /** Job completed: produce the invoice. */
  onComplete(world: DispatchSimWorld, jobId: string): void;
}

const CONFIRM_WINDOW = 36 * HOUR;

function nearestTechnician(world: DispatchSimWorld, job: SimJob): SimTechnician | undefined {
  // deterministic: first technician (single-tech baseline); proximity scoring is F4.
  return world.technicians.get(job.technicianId ?? "") ?? [...world.technicians.values()][0];
}

/** The correct reference policy. The harness proves the process by comparing against it. */
export class ReferenceDispatcher implements Dispatcher {
  plan(world: DispatchSimWorld): void {
    const now = world.clock.now();
    for (const job of world.jobs) {
      if (job.status === "scheduled" && !job.confirmedAt && job.scheduledFor > now && job.scheduledFor - now <= CONFIRM_WINDOW) {
        world.notify(job.id, "confirm");
      }
      if (!job.technicianId) {
        const tech = nearestTechnician(world, job);
        if (tech) world.assign(job.id, tech.id);
      }
    }
  }
  onDeparted(world: DispatchSimWorld, jobId: string, arrivalEta: Instant, windowEnd: Instant): void {
    world.notify(jobId, "on-my-way");
    if (isRunningLate(arrivalEta, windowEnd)) world.notify(jobId, "running-late");
  }
  onComplete(world: DispatchSimWorld, jobId: string): void {
    world.invoice(jobId);
  }
}

export interface ScenarioSpec {
  id: string;
  startIso: string;
  technicians: SimTechnician[];
  customers: SimCustomer[];
  jobs: Array<{
    id: string;
    customerId: string;
    technicianId?: string;
    departOffsetMin: number;
    windowMin: number;
    serviceMin: number;
  }>;
  /** Global congestion multiplier on travel time (geo-temporal variant). */
  traffic?: number;
}

/**
 * Run a scenario end-to-end on the virtual clock and return the final snapshot.
 * Technician drives are simulated via `planDrive`; the dispatcher reacts to
 * departure and completion events. Deterministic for a given spec.
 */
export async function runScenario(
  spec: ScenarioSpec,
  dispatcher: Dispatcher = new ReferenceDispatcher(),
): Promise<WorldSnapshot> {
  const clock = VirtualClock.fromIso(spec.startIso);
  const start = clock.now();
  const world = new DispatchSimWorld(clock);
  for (const t of spec.technicians) world.addTechnician(t);
  for (const c of spec.customers) world.addCustomer(c);
  for (const j of spec.jobs) {
    world.addJob({
      id: j.id,
      customerId: j.customerId,
      technicianId: j.technicianId,
      status: "scheduled",
      scheduledFor: start + j.departOffsetMin * MINUTE,
      windowEnd: start + j.windowMin * MINUTE,
      serviceMs: j.serviceMin * MINUTE,
    });
  }

  // Day-start: dispatcher confirmation watch + assignment.
  dispatcher.plan(world);

  // Scripted customer actor: a reachable customer who got a delivered confirmation confirms.
  for (const job of world.jobs) {
    const confirmed = world.notifications.some((n) => n.jobId === job.id && n.event === "confirm" && n.delivered);
    if (confirmed) world.confirm(job.id);
  }

  // Scripted technician actor: schedule each assigned job's drive + service on the clock.
  for (const job of world.jobs) {
    if (!job.technicianId) continue;
    const tech = world.technicians.get(job.technicianId);
    const customer = world.customers.get(job.customerId);
    if (!tech || !customer) continue;
    const plan = planDrive({
      technicianId: tech.id,
      jobId: job.id,
      from: tech.home,
      to: customer.site,
      departAt: job.scheduledFor,
      opts: { trafficFactor: spec.traffic ?? 1 },
    });
    for (const signal of plan.signals) world.emit(signal);

    clock.scheduleAt(plan.departedAt, () => {
      world.markEnRoute(job.id, plan.arrivalEta);
      dispatcher.onDeparted(world, job.id, plan.arrivalEta, job.windowEnd);
    });
    clock.scheduleAt(plan.arrivedAt, () => world.markArrived(job.id));
    clock.scheduleAt(plan.arrivedAt + job.serviceMs, () => {
      world.markComplete(job.id);
      dispatcher.onComplete(world, job.id);
    });
  }

  await clock.advanceTo(start + DAY);
  return world.snapshot();
}

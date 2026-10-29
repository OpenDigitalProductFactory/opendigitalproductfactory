import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isBoundedTrustedJson } from "../kernel/bounded-trusted-json.js";
import { buildOperatingComposition, queryOperatingQualification, COMPOSITION_VERSION, QUALIFICATION_FACT_VERSION,
  deriveLegacyPromptClassRefs, legacyOperatingProfileMaterial, serializeLegacyMetadata,
  type OperatingComposition, type CompositionReference, type QualificationFacts } from "../kernel/operating-composition/index.js";

type Digest = (text: string) => string;
const ref = (id: string): CompositionReference => ({ id, version: "1", digest: "sha256:" + "a".repeat(64) });
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function composition(role: "author" | "reviewer"): OperatingComposition {
  return { schemaVersion: COMPOSITION_VERSION, subjectRef: ref(role), principalRef: ref(role + "-principal"),
    jobRef: ref("software-" + role), roleRef: ref(role + "-role"), supervisionRef: ref("supervision"),
    instructions: [ref("base-prompt"), ref(role + "-prompt")], skills: [ref("source-read")], models: [ref("model-binding")],
    tools: [ref(role === "author" ? "proposal-write" : "review-receipt")], doctrine: [{ scope: "wwmd", profileRef: ref("doctrine") }],
    memoryPolicyRef: ref("memory-policy"), configurationRef: ref("configuration"), harnessRef: ref("harness"), runtimeRef: ref("runtime") };
}
type Packet = { id: string; role: "independent-review"; sourceRef: CompositionReference;
  authorCompositionRef: CompositionReference; reviewerCompositionRef: CompositionReference;
  reviewerPrincipalRef: CompositionReference; authorityRef: CompositionReference; outputCodec: "review-result/v1";
  deadlineAt: string; digest: string };
type Observation = { packetDigest: string; sourceRef: CompositionReference; attemptId: string;
  outputCodec: "review-result/v1"; verdict: "pass" | "fail"; content: string };
type Reply = { state: "receipt" | "held" | "unknown" | "conflict"; verdict: "pass" | "fail"; receiptId?: string };

/**
 * Bounded synthetic adapter, not a second orchestration engine. One in-memory
 * owner serializes calls; real hosts must authenticate actors/facts and commit
 * current authority, source observations and receipts in their own transaction.
 */
class SampleReviewHost {
  author = composition("author"); reviewer = composition("reviewer");
  sourceRef = ref("proposal"); authorityRef = ref("review-authority");
  revoked = false; cancelled = false; capacity = true; storageAvailable = true; loseNextAck = false;
  now = "2026-10-20T00:00:00Z";
  readonly receipts = new Map<string, { canonicalPayload: string; reply: Reply }>();
  private readonly pinnedPacket: Packet;
  get packet(): Packet { return clone(this.pinnedPacket); }
  readonly facts: QualificationFacts[];
  private pending = false;
  constructor(readonly hash: Digest) {
    const a = buildOperatingComposition(this.author, hash), r = buildOperatingComposition(this.reviewer, hash);
    check(a.ok && r.ok, "complete author/reviewer composition");
    const body = { id: "review-1", role: "independent-review" as const, sourceRef: clone(this.sourceRef),
      authorCompositionRef: a.compositionRef, reviewerCompositionRef: r.compositionRef,
      reviewerPrincipalRef: clone(this.reviewer.principalRef), authorityRef: clone(this.authorityRef),
      outputCodec: "review-result/v1" as const, deadlineAt: "2026-10-20T00:30:00Z" };
    this.pinnedPacket = { ...body, digest: "sha256:" + hash(canonicalJson(body)) };
    this.facts = [a, r].map((built, index) => ({ schemaVersion: QUALIFICATION_FACT_VERSION,
      reference: ref("qualification-" + index), subjectRef: built.value.subjectRef, principalRef: built.value.principalRef,
      compositionRef: built.compositionRef, schemeRef: ref("software-scheme"), harnessRef: built.value.harnessRef,
      runtimeRef: built.value.runtimeRef, assessorRef: ref("assessor"), status: "qualified", evidence: [ref("assessment-" + index)],
      validFrom: "2026-10-19T00:00:00Z", validUntil: "2026-10-21T00:00:00Z" }));
  }
  observation(verdict: "pass" | "fail" = "pass"): Observation {
    return { packetDigest: this.packet.digest, sourceRef: clone(this.packet.sourceRef), attemptId: "attempt-1",
      outputCodec: "review-result/v1", verdict, content: verdict === "pass" ? "Synthetic review passed." : "Synthetic defect found." };
  }
  async submit(actor: CompositionReference, packet: Packet, observation: Observation): Promise<Reply> {
    const hold: Reply = { state: "held", verdict: observation.verdict };
    if (this.pending) return hold;
    if (!isBoundedTrustedJson({ actor, packet, observation }) || typeof observation.content !== "string" || observation.content.length > 4096
      || typeof observation.attemptId !== "string" || !observation.attemptId.trim() || observation.attemptId.length > 512) return hold;
    actor = clone(actor); packet = clone(packet); observation = clone(observation);
    this.pending = true;
    try {
      // The fixture owner supplies an authenticated actor slot. Equality alone
      // is not real authentication; this exercises binding, not actor provenance.
      if (!same(packet, this.pinnedPacket) || !same(actor, this.reviewer.principalRef) || same(actor, this.author.principalRef)
        || packet.role !== "independent-review" || observation.outputCodec !== packet.outputCodec
        || observation.packetDigest !== packet.digest || !same(observation.sourceRef, packet.sourceRef)
        || !same(this.sourceRef, packet.sourceRef) || !same(this.authorityRef, packet.authorityRef)
        || this.revoked || this.cancelled || !this.capacity || Date.parse(this.now) >= Date.parse(packet.deadlineAt)) return hold;
      const observedFacts: unknown[] = [];
      for (const [index, input] of [this.author, this.reviewer].entries()) {
        const expected = index === 0 ? packet.authorCompositionRef : packet.reviewerCompositionRef;
        const assessment = await queryOperatingQualification(input, { schemeRef: ref("software-scheme"), now: this.now }, {
          digest: this.hash,
          readCurrentComposition: async () => ({ status: this.revoked ? "revoked" : "current", subjectRef: input.subjectRef,
            principalRef: input.principalRef, compositionRef: expected }),
          readQualification: async () => { const facts = clone(this.facts[index]); observedFacts.push(facts); return facts; },
        });
        if (assessment.status !== "qualified" || !same(assessment.compositionRef, expected)) return hold;
      }
      // Final synchronous transaction check: no await may separate these current
      // fixture facts from the receipt write. Production owns its real transaction.
      if (this.revoked || this.cancelled || !this.capacity || Date.parse(this.now) >= Date.parse(packet.deadlineAt)
        || !same(this.sourceRef, packet.sourceRef) || !same(this.authorityRef, packet.authorityRef) || !same(observedFacts, this.facts)) return hold;
      for (const [index, input] of [this.author, this.reviewer].entries()) {
        const built = buildOperatingComposition(input, this.hash);
        if (!built.ok || !same(built.compositionRef, index === 0 ? packet.authorCompositionRef : packet.reviewerCompositionRef)) return hold;
      }
      const payload = canonicalJson({ actor, packet, observation });
      const previous = this.receipts.get(packet.id);
      if (previous) return previous.canonicalPayload === payload ? clone(previous.reply) : { state: "conflict", verdict: observation.verdict };
      if (!this.storageAvailable) return hold;
      const reply: Reply = { state: "receipt", verdict: observation.verdict, receiptId: "receipt-1" };
      this.receipts.set(packet.id, { canonicalPayload: payload, reply: clone(reply) });
      if (this.loseNextAck) { this.loseNextAck = false; return { state: "unknown", verdict: observation.verdict }; }
      return reply;
    } finally { this.pending = false; }
  }
}

export async function runSmoke(hash: Digest): Promise<{ passed: string[] }> {
  const passed: string[] = [];
  const legacy = legacyOperatingProfileMaterial({ modelBinding: { default_model_id: null, pinned_provider_id: null,
    pinned_model_id: null, minimum_tier: null, budget_class: null, execution_type: null, temperature: null, max_tokens: null },
    grantKeys: ["registry_read"], promptClassRefs: deriveLegacyPromptClassRefs([{ label: "alias-skill", taskType: "analysis" }]),
    hitlDefault: 2, sensitivity: "internal" });
  check(hash(serializeLegacyMetadata(legacy)!) === "bff4e251504d69ab780a31297588a6c5c1484d84b1234ce731b7e99b3af6b91c", "legacy issued digest remains identical in the second consumer");
  passed.push("literal legacy AIDoc hash matches the migrated application fixture");
  const host = () => new SampleReviewHost(hash);
  const submit = (h: SampleReviewHost, observation = h.observation(), packet = h.packet, actor = h.reviewer.principalRef) => h.submit(actor, packet, observation);
  const a = host(), observation = a.observation();
  check((await submit(a, observation)).state === "receipt", "exact-subject review receipt");
  check((await submit(a, observation)).state === "receipt" && a.receipts.size === 1, "exact replay deduplicates");
  passed.push("exact author/reviewer composition, subject and receipt replay");
  for (const change of [{ content: "changed reviewed bytes" }, { verdict: "fail" as const }, { attemptId: "different-attempt" }])
    check((await submit(a, { ...observation, ...change })).state === "conflict" && a.receipts.size === 1, "changed result conflicts");
  passed.push("changed content/verdict/attempt replay conflicts");
  a.revoked = true;
  check((await submit(a, observation)).state === "held" && a.receipts.size === 1, "revocation checked on replay");
  passed.push("revocation holds accepted receipt replay");
  const lost = host(); lost.loseNextAck = true;
  check((await submit(lost)).state === "unknown" && lost.receipts.size === 1, "lost acknowledgment stays unknown");
  check((await submit(lost)).state === "receipt" && lost.receipts.size === 1, "retry recovers exact durable receipt");
  passed.push("lost acknowledgment reconciles without a second write");
  const failed = host(); failed.storageAvailable = false;
  const failure = await submit(failed, failed.observation("fail"));
  check(failure.state === "held" && failure.verdict === "fail" && failed.receipts.size === 0, "failed judgment cannot become pass without persistence");
  failed.storageAvailable = true;
  check((await submit(failed, failed.observation("fail"))).verdict === "fail", "durable failure remains failure");
  passed.push("failed judgment and unavailable persistence never become success");
  for (const mutate of [(h: SampleReviewHost) => { h.sourceRef.version = "2"; },
    (h: SampleReviewHost) => { h.reviewer.instructions[0]!.version = "2"; },
    (h: SampleReviewHost) => { h.facts[1]!.status = "revoked"; },
    (h: SampleReviewHost) => { h.facts[1]!.evidence = []; },
    (h: SampleReviewHost) => { h.authorityRef.version = "2"; }]) {
    const stale = host(); mutate(stale);
    check((await submit(stale)).state === "held" && stale.receipts.size === 0, "changed source/composition/authority/qualification holds");
  }
  passed.push("stale source/composition, revoked qualification, absent evidence and changed authority hold");
  for (const mutate of [(h: SampleReviewHost) => { h.capacity = false; }, (h: SampleReviewHost) => { h.cancelled = true; },
    (h: SampleReviewHost) => { h.now = h.packet.deadlineAt; }]) {
    const waiting = host(); mutate(waiting);
    check((await submit(waiting)).state === "held" && waiting.receipts.size === 0, "capacity/cancellation/deadline holds");
  }
  passed.push("capacity wait, cancellation and deadline hold without writes");
  const wrong = host();
  check((await submit(wrong, wrong.observation(), wrong.packet, wrong.author.principalRef)).state === "held", "author cannot self-review");
  check((await submit(wrong, wrong.observation(), { ...wrong.packet, reviewerPrincipalRef: ref("other") })).state === "held", "changed pinned actor holds");
  check((await submit(wrong, { ...wrong.observation(), packetDigest: "sha256:" + "f".repeat(64) })).state === "held", "wrong packet holds");
  check(wrong.receipts.size === 0, "bad packet caused no writes");
  passed.push("author/self-review, changed actor and wrong packet binding hold");
  const mutable = host(), issued = mutable.packet;
  issued.deadlineAt = "2027-10-20T00:30:00Z";
  check((await submit(mutable, mutable.observation(), issued)).state === "held" && mutable.receipts.size === 0, "caller cannot mutate the host's issued packet");
  const during = host(), incoming = during.observation(), pinnedContent = incoming.content;
  const pending = submit(during, incoming); incoming.content = "changed after submission";
  check((await pending).state === "receipt", "pinned original result remains valid");
  check(JSON.parse(during.receipts.get(during.packet.id)!.canonicalPayload).observation.content === pinnedContent, "receipt pins the submitted result before async reads");
  passed.push("issued packet and submitted result resist caller mutation during fact reads");
  const shape = composition("author"), before = buildOperatingComposition(shape, hash);
  shape.supervisionRef.version = "2";
  check(!same(before, buildOperatingComposition(shape, hash)), "supervision changes exact composition");
  check(!buildOperatingComposition({ ...shape, hiddenAuthority: true }, hash).ok, "unknown authority field refused");
  passed.push("composition changes and unsupported fields remain distinct from legacy fingerprints");
  return { passed };
}

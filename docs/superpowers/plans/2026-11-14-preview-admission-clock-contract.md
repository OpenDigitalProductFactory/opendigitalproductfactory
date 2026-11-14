# Preserve database admission proof across application clocks

BI-F19DDBCA · WC-DF321588 · Medium, atomic reliability repair.

## Objective and observed failure

The native preview fence must consume the admission history its real producer
writes. At installed62368996, F0E admittedAt was16:54:17.415Z while its immutable
firstAdmittedAt was16:54:17.422Z. The application writes input.now; the database
trigger writes clock_timestamp(). Rejecting firstAdmittedAt > admittedAt holds
this normal admission. Root independently confirmed both facts. No deliberate
crash was performed. Normal controller stop removed all own runtime processes
and containers; protected services retained IDs/start times. Controller exit1
and preview_owned_fence_unverified are preserved as failures. Native release
succeeded16:58:50.820Z without another approval. No READY, sign-in or UX proof.

Keep original codex/session-identity at7cba454af18d0d25f0d96c8a06ac6d0fed1cf488.
Delivered BI2/PR7078 and all historical preview attempts remain closed; this is
an independently recorded consumer correction, not a revival or timestamp edit.

## Research and selected contract

Research receipt initiative-4120d14b-2f86-4b07-8e8c-84a14d634427 binds source64dcb061.
WWMD DI-C64CE1EFE7CC selected committed-proof-clock-domains, high confidence,
usable and autonomy eligible, over changing all writer clocks or disabling
preview indefinitely. Bounded overlap checked the live client epic and all
three nearest semantic matches (BI2 done, C097 retired, ADC retired).

Existing contracts: the original external-client verification plan; immutable
migration20261101060000; environment-lease.ts locked admission/expiry/release;
environment-lease-provenance.ts durable Task ownership; preview-runtime-fence.ts
exact source, mount, development class, full container ID and gate exclusion.

firstAdmittedAt is a database-owned finite witness of an admission, not an
application-clock deadline. A committed irreversible non-gate terminal status,
activeKey null, retained admission-history version1 and a finite first witness
provide history/terminal proof; the same row is re-read before stop. Do not
compare this database witness with admittedAt, releasedAt or the observer's
wall clock. Application admission and terminal writes can also cross a wall-clock
adjustment, so their relative order or observer time is not authority. Keep
finite required date fields. Retain expiresAt <= releasedAt for expired rows
only if actual locked expiry producer/planner establishes that invariant:
it selects expiry against its supplied now and records that same now. Tests
must establish this producer guarantee; otherwise remove the unsupported check
rather than invent tolerance. Released/cancelled may precede their expiry.
No migration, backfill, clock adjustment, arbitrary tolerance, new grant, job,
ledger, fixture identity or generic cleanup command.

## Acceptance (verbatim)

- AC-CLOCK-1: A real isolated PostgreSQL queued-to-active producer result feeds the actual native fence and reproduces the rejection before the repair, including the observed database-firststamp/application-time ordering.
- AC-CLOCK-2: Corrected consumer semantics accept valid database-owned immutable admission proof across supported application/database clock offsets without tolerance, timestamp rewriting or migration/backfill; unknown/legacy/forged history, nonterminal/gate/foreign/source/full-ID mismatches remain held.
- AC-CLOCK-3: Affected regression suites, production/test typechecks, exact-head governed integration and independent review pass; real PostgreSQL producer/fence integration is executed rather than skipped.
- AC-CLOCK-4: Normal protected PR delivery and canonical containment precede a newly admitted finite operational acceptance attempt; an independent reviewer observes actual controlled-client absence, native exact-owned stop/readback and unchanged protected services before any installed acceptance claim. Original full route/persona/permission outcomes remain separately unrun until measured.

## Internal sequence (one delivery)

1. Bind claim/scope before creation or edits. Managed dependency probe must say
   compile-ready. Resolved impact contract names the colocated fence suite;
   find_related_tests returned that exact test. Guard obligations: style drift,
   doc index/diagrams, host preflight, exact-head shared gate and PR health.
2. RED: add actual producer-to-consumer regression in the existing isolated
   PostgreSQL admission-history suite. Start with a genuinely queued claim;
   transition through the real domain admission path and immutable trigger,
   retain its real Task ownership, release through the normal domain path,
   then pass the persisted row/Task to the actual fence with a private fake
   Docker transport. Application clock offsets are controlled through the
   domain's existing now input; database timestamps are never overwritten.
   Exercise actual7ms ordering deterministically and opposing offsets. Assert
   rejected forged/legacy history and active/gate/foreign bindings still hold.
   Execute the PostgreSQL RED under a canonical shared lease. A skipped suite
   is UNRUN. Local pure regressions may run in the source worktree.
3. GREEN: correct only the unsupported consumer chronology. Keep immutable DB
   proof, terminal recheck, expiry-writer invariant where proved, all provenance
   checks, fixed full-ID stop/readback, bounded transport/window/quiescence.
   Add unit coverage for DB time beyond application terminal/observer time,
   application clock rollback and valid released-before-expiry; retain unknown
   history and expired rows with impossible writer-derived ordering negatives.
4. Reconcile delivery runbook owner-cleanup guidance with actual existing
   BI88D51B8F routineLeaseRelease: proven own/process-free, already-ended or
   lapsed reservations release normally; foreign/unproven live reservations
   retain authority approval. Do not change authorization policy. Existing
   obsolete-release reconciliation and envelope expiry own lapsed requests.
5. Verify affected unit/real-PG suites, production/test typechecks, style and
   generated docs checks. Record exact RED/GREEN counts and real PG execution.
   Commit DCO, update native source/evidence, record atomic coverage against
   the provider-readable immutable plan, run exact-head governed gate, obtain
   independent frozen review and publish only with pnpm land.
6. Root alone advances canonical install. Only after actual containment and
   CAN-TEST, request one newly wanted finite preview through ordinary native
   admission. Coordinate exact READY source/fullID/process-incarnation proof
   with independent root before controlled client-absence observation. No
   host pressure injection, foreign stop, old claim replay or grant bypass.
   Stop on first failure and preserve cleanup unknown honestly. Record actual
   native stop/readback plus protected IDs before claiming installed acceptance.

The phases cannot ship independently: the consumer change without actual
producer regression repeats the false green; regression alone leaves the
installed failure. Operational acceptance is evidence, not another code unit.
Original all332 desktop/mobile/70 dynamic fixture/persona/permission acceptance
remains separately UNRUN until legitimately admitted and measured.

---
status: draft
---

# Wave 2 bounded-coding source-read implementation plan

BI-B62B218E · WC-42F596A2 · baseline-997ec001-bd56-45b8-bf07-4bb0db07d615

This pins the first Control slice of the [approved design](../specs/2026-11-25-workroom-bound-toolset-design.md) at commit `8d2863093b575906d54130eb4febdf8574cf2621`, blob `769bc113e828c2140df590ae1e15ff3bc4f9e815`. It is not implementation admission. Do not change First Workroom, add a new effect route, publish a partial surface, or claim real TAK-JSI qualification or served completion from this slice.

## Pinned wire

**CT-T4-LAUNCH / FL-T4-ADMIT.** The launch is the existing strict [`s5-launch.v1` bounded-coding variant](../../../packages/validators/src/workroom/s5-launch.ts), not an alternate launch schema. Require every field in that variant: `schemaVersion`, `kind: "launch"`, `mode: "bounded-coding"`, issuer, audience, hostRef, workroomId, sessionRef, stageKey, stageAttemptRef, caseKey, subject, issuedAt, expiresAt, authority, worktreeRef, jsi and budget. Narrow `permittedOperations` to exactly `["read_source_at_version"]` for this coding slice. Require current owner-verified route support and a live protected admission tying the Control session admission and attempt to the DPF session and stage attempt. The exact source tuple is stored in that protected admission, never supplied by the projection. Reject a coordination payload or a missing worktree ref, wrong mode or stale assignment. An unwired or ineligible read is not listed and this coding launch holds. Keep provider-native MCP and apps empty, generic T3 MCP session prep suppressed, and client hooks outside the authority chain.

**CT-T4-READ / FL-T4-INVOKE.** On Control's existing authenticated `/room/operation`, dispatch by the exact operation literal after the attempt credential check. This is a strict, proposed v1 JSON contract for the read branch, separate from the unchanged `post_room_message` proposal branch:

```text
Request = {
  sessionAdmissionRef: Ref, attemptRef: Ref, attemptToken: Secret,
  invocationId: InvocationId, operation: "read_source_at_version",
  params: {
    schemaVersion: "t4-source-read.v1",
    target?: Target,
    window: { startLine: PositiveInt, maxLines: Lines, maxBytes: Bytes }
          | { cursor: Cursor, maxLines: Lines, maxBytes: Bytes }
  }
}
Target = { repositoryFullName: CanonicalRepo, commitSha: Sha,
           path: CanonicalRelativePath, expectedBlobId: Sha }
Correlation = { sessionAdmissionRef: Ref, attemptRef: Ref,
                invocationId: InvocationId }
BoundCorrelation = Correlation + { operationId: RoomOperationId }
Reply = { schemaVersion: "t4-source-read.v1" } + (
  { kind: "page", correlation: BoundCorrelation, target: Target,
    page: { startLine: PositiveInt, endLine: PositiveInt,
            content: String, utf8Bytes: NonnegativeInt, nextCursor: Cursor | null } }
| { kind: "disposition", correlation: BoundCorrelation,
    status: "in-flight" | "read-completed" | "read-withheld" | "unknown" }
| { kind: "refused", code: "invalid-request" | "bad-credential" | "not-current"
    | "operation-outside-ceiling" | "target-outside-permit" | "cursor-invalid"
    | "read-budget-exhausted" | "route-unavailable" | "invocation-id-reused"
    | "window-unavailable" | "source-unavailable" }
)
```

All objects reject unknown and duplicate keys. References use the bounded launch ref grammar, invocation IDs match Control's existing 1–128 character grammar, and operation IDs use its existing `room-operation:<UUIDv4>`. SHAs are exactly 40 lowercase hex characters. The repo is the canonical owner/name from admission and the path is its exact normalized repository-relative path, with no absolute path, empty/dot/parent segments, backslashes or caller normalization. The optional target must match all four admission fields, not substitute for them. Window arms are mutually exclusive. Integers are safe JSON integers. Lines are 1–100 and bytes 1–8192, with no defaults. Cursor is an opaque unpadded base64url value of at most 2048 characters. Control issues and verifies it, never DPF or the guest. Encode canonical JSON with fields schemaVersion ("t4-cursor.v1"), sessionAdmissionRef, attemptRef, target, nextLine and expiresAt (Unix milliseconds) followed by a 32-byte HMAC-SHA-256 tag, then base64url-encode the combined bytes. Use a Control-only cursor key distinct from credentials and peer signing keys. Expiry is no later than the current admission. Verify MAC, expiry, live admission and exact target/attempt before claim or reservation. Unknown keys, restart without the same active key, or any mismatch fail closed. Refuse a start past EOF or any next line that cannot fit in the requested byte allowance. Return whole source lines, preserving line endings and never splitting a UTF-8 character. Read only valid UTF-8. A page is nonempty, ends no later than its line limit, and reports exact UTF-8 bytes including returned line endings. Return null cursor at EOF. A refusal carries no token, source, target or sibling details.

**CT-T4-RESERVATION / FL-T4-RESERVE.** DPF2 Control owns the durable per-attempt reservation under its existing kernel claim lock. After credential, admission, ceiling, target and cursor checks, atomically claim the invocation and charge one read plus the requested maxBytes before dispatch. Maximum eight reads and 65,536 reserved bytes per attempt. Do not refund or auto-retry a claim that reached reservation, including when response or completion evidence is lost. Bind the claim to the normalized target and window digest. A repeated invocation with changed inputs refuses without dispatch. Identical replay reads status only and consumes no reservation. Restarts preserve counts and the uncertain-attempt fence. Recheck current admission at dispatch and at disclosure. DPF independently verifies the current mapped subject, binding, permit, qualification, route, target and limits and requires the authenticated reservation identity. Never accept a client-provided budget or room token.

**CT-T4-DISCLOSURE / FL-T4-RETURN.** Only the original authenticated invocation may receive its page. Resolve the blob ID before reading content, and hold on any mismatch. The sole source backend is the installed DPF scoped adapter against the admitted canonical Git object store, reachable from authenticated Control on the protected receiver path. Reuse the immutable read implementation behind `read_source_at_version`, not default refs, nullable repo or blob, provider fallback, arbitrary filesystem or generic MCP. Bind the protected hop to the exact Control installation/receiver and current attempt mapping. Keep room-token custody in Control. The protected read response carries the same correlation and exact target so Control can reject mismatched material before delivery. Do not persist raw source or cursor in shared audit, claim or replay. Record content-free disposition and correlation only. A revoked credential receives no replay metadata. Revocation after read starts suppresses content before disclosure. A fresh invocation may request the same admitted window only while current and unfenced, and pays again. Two siblings in one room use distinct session admissions, not two overlapping uncertain attempts in one session.

**CT-T4-PEER / FL-T4-HOP.** Install a separate protected `POST /api/internal/t4-source-read` on DPF, profile `t4-control-source-read.v1`. This is a proposed route, not present at the baseline. It is not the caller-facing Control `/room/operation`, generic MCP or S5 preview POST/GET. Reuse the registered protected receiver boundary exemplified by `s5-coordination-wire.server.ts`; require mutually authenticated HTTPS with peer identity, allowed profile and exact audience/host matched to installed registration. Reject a missing installation binding. Use strict UTF-8 JSON, no BOM or duplicate keys, with a 16 KiB request and 64 KiB response cap. Use RFC 8785 canonical JSON as sent, and detached Ed25519 in the `X-DPF-T4-Signature` header (unpadded base64url signature of the exact body bytes, keys pinned by the installed peer registration for this profile and direction). Verify before parsing semantics and reject a body that is not its canonical encoding. Do not accept redirects or repair malformed input. Request and response are strict objects:

```text
PeerRequest = { profile: "t4-control-source-read.v1", kind: "source-read",
  issuer: Ref, audience: Ref, hostRef: Ref, workroomId: Ref,
  sessionRef: Ref, stageKey: Ref, stageAttemptRef: Ref,
  correlation: BoundCorrelation, target: Target,
  window: { startLine: PositiveInt, maxLines: Lines, maxBytes: Bytes },
  reservation: { reservationId: RoomOperationId, reads: 1, bytes: Bytes,
    expiresAt: NonnegativeInt } }
PeerResponse = { profile: "t4-control-source-read.v1", kind: "source-read-result",
  issuer: Ref, audience: Ref, hostRef: Ref,
  correlation: BoundCorrelation, requestDigest: Sha256, target: Target,
  result: { kind: "page", startLine: PositiveInt, endLine: PositiveInt,
    content: String, utf8Bytes: NonnegativeInt, nextLine: PositiveInt | null }
    | { kind: "refused", code: "not-current" | "target-outside-permit"
        | "window-unavailable" | "source-unavailable" } }
```

BoundCorrelation and Target are as above. Sha256 is 64 lowercase hex characters of SHA-256 over the exact signed request body. The request issuer is the registered Control peer and audience is the DPF receiver for the host; reverse issuer and audience on the reply. Reservation ID equals correlation.operationId and bytes equals window.maxBytes. Control's signer reads the committed, unexpired reservation and its bound request fingerprint from the kernel claim ledger, never from a caller payload. DPF verifies the registered peer's statement of that reservation and consumes the operation ID once under the exact attempt before invoking the store. Reject duplicates, expired reservations and mismatches without another read. DPF independently checks live assignment and disclosure authority, not identity inferred from correlation. No caller attempt token or scoped room credential crosses this hop. Control verifies the signed reply's peer, request digest, correlation, target, window bounds, byte count and nextLine before converting it to a caller page. Only Control wraps nextLine in a caller cursor. Recheck currentness before returning even a valid signed page.

**CT-T4-GIT / FL-T4-LOCAL.** The protected adapter calls the immutable local Git primitives `gitBlobId` and `gitShow` from `apps/web/lib/git-utils`, with the Git directory fixed by installed canonical repository registration and the full commit and path taken from admission. Reuse or factor their local implementation to accept the verified store explicitly. Check the full commit/path blob identity before reading content and bind the read to that Git object. Do not call the generic MCP handler with `sourceAdmission`: at DPF `4e7b9d86`, `version-history-pack.ts:237–269` enters local Git only for `canonical && !sourceAdmission` and can otherwise invoke `readRepositoryProviderBlob`. A wrong store, unresolved commit, missing object or blob mismatch terminates locally. No provider fallback, working-tree read or second repository.

**CT-T4-PARSE.** DPF2 `8b3afa0f` `kernel-facade.ts:104,355` currently uses replacement UTF-8 decoding and a shared parser. Preserve bounded raw bytes through operation discrimination. A request selecting the read operation must have strict UTF-8 and no duplicate decoded JSON member names at any level, including alternate spellings of the selector. Reject a request with any top-level operation occurrence selecting read unless it passes the strict read parse. Never let parser collapse or invalid encoding send it into the proposal branch. Preserve existing proposal bytes, parser and replies for proposal-only requests. Common HTTP method, bearer, size and attempt-auth failures remain outside the typed read Reply. In particular the existing common 403 bad-credential has no read result. After those checks, apply currentness to the read branch before both replay and first dispatch.

## Conformance vectors

**V-T4-WIRE.** Fixture target A is `OpenDigitalProductFactory/opendigitalproductfactory` at commit `1111111111111111111111111111111111111111`, path `fixtures/t4.txt`, expected blob `2222222222222222222222222222222222222222`. Stub the admitted store to resolve that blob and return the UTF-8 bytes for `alpha\né\ngamma\n` (the IDs are fixture markers, not actual Git object hashes). Session admission `admit-code-1`, attempt `attempt-code-1`, invocation `read-01`, operation `room-operation:00000000-0000-4000-8000-000000000001` produce lines 1–2 for window `{startLine:1,maxLines:2,maxBytes:9}`. Expect `alpha\né\n`, 9 bytes, exact target and correlation, and a cursor for line 3. A second invocation continuing with maxLines 1 and maxBytes 6 returns `gamma\n`, 6 bytes, and a null cursor. Verify different bindings cannot consume that cursor. Missing concrete installed route must suppress listing and hold launch.

**V-T4-DENY.** Keep hooks disabled. The sibling `admit-coord-1` / `attempt-coord-1` is independently admitted for the quiet proposal and cannot invoke the read. The coding attempt cannot invoke `post_room_message`. A sibling credential paired with the coding attempt refuses before claim. Vary each of repo, commit, path and expected blob separately, then stub a resolved blob mismatch. Expect no content read or release. Wrong supplied target and cross-attempt cursor refuse before claim or broker. Test maxLines 101, maxBytes 8193, mixed cursor/startLine, and a ninth otherwise valid request after eight reservations. Concurrent last-credit requests admit at most one.

**V-T4-REPLAY.** Drop the response to `read-01` after a successful read. Same invocation and unchanged inputs yield metadata-only `read-completed`, one cumulative read, and no extra reservation. Changed window under `read-01` refuses. A fresh current invocation can read the same window and spends one new reservation. Advance the stage or revoke while the protected reply is in flight and verify no page/cursor is delivered. After revocation, retry old invocation, cursor and fresh invocation and verify no read or metadata disclosure. Separately lose the execution outcome before settlement and prove the uncertain-attempt fence remains effective within that session. The sibling quiet proposal still succeeds, with no new wake, delivery, credential, or impact on its ceiling.

**V-T4-PEER.** Use target A and the first window from V-T4-WIRE. Sign the canonical request as registered Control with reservationId equal to the operation ID ending in 0001, reads 1 and bytes 9. Expect one authenticated page reply from DPF with the exact signed request digest, lines 1–2, nine source bytes and nextLine 3. Verify Control issues its own cursor. Independently swap the peer key or installed audience, omit or corrupt the reservation ID/bytes/expiry, or replay the peer request. Expect zero additional Git reads. Re-sign a reply with wrong requestDigest, correlation or target and prove zero disclosure. Flip a cursor byte and separately use an expired cursor, a sibling cursor and a cursor after stage change. All refuse before a claim or budget charge.

**V-T4-GIT.** Create a disposable local Git commit with `fixtures/t4.txt` containing the exact V-T4-WIRE bytes. Derive the commit hash with `git rev-parse HEAD` and the blob with `git rev-parse HEAD:fixtures/t4.txt`, bind admission to that store and assert the returned page and identity. Bind a correct-looking but absent commit, then a missing path and a different expected blob. Assert no content read on any miss, and spy on provider fallback and other stores to assert zero calls. This is a future test, not a qualification run.

**V-T4-PARSE.** Duplicate operation (including escaped key spelling), nested duplicate target field and malformed UTF-8 raw bytes all refuse for reads without invoking either branch. Existing quiet proposal keeps its current reply. Separately test a current, authenticated lost-response replay (status only), a stale but credential-valid replay (typed not-current, no metadata), and a revoked credential replay (common 403, no metadata). Verify the same invocation never causes a second dispatch.

## Delivery sequence and rollback

1. **Pin producer and receiver contract, internal.** Extend the DPF launch projection in `apps/web/lib/workroom-runtime/s5-launch-projection.server.ts` only for installed read support and implement the strict wire on both sides. Test mode/schema disjointness and the advertised intersection before adding handlers. DPF2 receiver reviews these exact vectors before implementation admission.
2. **Wire both enforcement ends, internal.** On DPF2 use `apps/control/src/kernel-facade.ts`, `apps/control/src/room-token-custody.ts` and `packages/core/src/room-operation-claim.ts` for the read branch, durable reservation and content-free settlement. On DPF extend the source boundary behind `apps/web/lib/mcp/packs/version-history-pack.ts` with the scoped adapter. Run all vectors plus existing proposal, launch, custody and replay regressions. Verify the implementation impact contract before code and run its affected tests and typechecks.
3. **Qualify the joined route, separate proof.** Use exact producer/receiver identities on the canonical shared served path and capture both real same-room job assignments, authenticated read and quiet proposal receipts, empty native inventories, hook-free refusal and sibling survival. Real TAK-JSI and lifecycle evidence remain separate, including BI-6DB95601, BI-003816C1, BI-3ABE0149 and BI-AE054B53. Fixture vectors are not either proof. Do not retire hooks or extend First Workroom.
4. **Rollback.** Withdraw installed read route support and stop issuing new coding admissions. Revoke only affected coding attempts and keep prior metadata-only dispositions. Preserve the existing quiet proposal and reject the unavailable read. Do not restore broad MCP, reset a spent budget or recover page content from a receipt.

## Backlog coverage

Atomic first scoped-read contract and enforcement slice under BI-B62B218E. The producer and consumer fences are not independently shippable. Use the table to bind immutable plan coverage to baseline-997ec001-bd56-45b8-bf07-4bb0db07d615 after the plan can be resolved as a published blob. No coverage receipt is claimed by this local draft.

| Baseline requirements | Contracts | Flows | Verification |
| --- | --- | --- | --- |
| OBJ-S5-REGISTRY, AC-1 | CT-T4-LAUNCH, CT-T4-READ | FL-T4-ADMIT | V-T4-WIRE |
| OBJ-S5-AUTHORITY, AC-2, AC-5 | CT-T4-LAUNCH, CT-T4-READ, CT-T4-RESERVATION | FL-T4-ADMIT, FL-T4-INVOKE, FL-T4-RESERVE | V-T4-DENY |
| OBJ-S5-BOUNDARY, AC-3, AC-5 | CT-T4-READ, CT-T4-DISCLOSURE, CT-T4-PEER, CT-T4-GIT, CT-T4-PARSE | FL-T4-INVOKE, FL-T4-RETURN, FL-T4-HOP, FL-T4-LOCAL | V-T4-WIRE, V-T4-DENY, V-T4-PEER, V-T4-GIT, V-T4-PARSE |
| OBJ-S5-LIFECYCLE, AC-4, AC-5 | CT-T4-RESERVATION, CT-T4-DISCLOSURE | FL-T4-RESERVE, FL-T4-RETURN | V-T4-REPLAY |
| OBJ-S5-HOOKS, AC-5 | CT-T4-LAUNCH, CT-T4-DISCLOSURE | FL-T4-ADMIT, FL-T4-RETURN | V-T4-DENY, V-T4-REPLAY |

AC-3 is covered only for the scoped read. AC-5 vectors cover the local contract, not qualification, the served acceptance pair or manifest-wide hook retirement.

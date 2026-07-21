# Routed-phase `ReferenceError: workloadClass is not defined` — BI-573A8EB3

Status: source fix applied, build-verification in progress
Related: BI-8C44DB49 (the flood this causes), BI-9257CF19 (auto-resume),
BI-A009313E (7-day stranded age-out safety net)

## The actual root cause behind the flood

Every routed Build Studio phase — `plan`, `design-review`, `plan-review` — fails
model resolution with:

```
rationale: "workloadClass is not defined"
```

That is a JavaScript `ReferenceError`, not a routing verdict. It is why 8 builds
have been stranded in `plan` since 2026-07-18: the plan/review phases can't
resolve a model, the build never advances, the 30-minute auto-resume
(BI-9257CF19) re-dispatches it, and each attempt mints the `Deliberation`
TaskRuns counted in BI-8C44DB49. The "No AI providers configured" banner was a
mislabel — `local`, `chatgpt`, `codex`, `zai-coding` are all active with
`supportsToolUse=true`.

## It's a Turbopack minifier bug, not a source defect

Call path (confirmed): `previewRoute` → `prepareRoute` →
`prepareProviderSuitabilityRuntime` (`routed-inference.ts:214`) →
`deriveProviderSuitabilityWorkContext` (`provider-suitability/work-context.ts`) →
`profileFromHint`.

Source, correct:

```ts
profiles = classes.map((workloadClass) =>
  profileFromHint(workloadClass, input.activity, classificationKnown));

function profileFromHint(workloadClass, activity, classificationKnown) {
  const base = deriveAiWorkloadDataProfile({ workloadClass, classificationKnown, … }); // shorthand
}
```

Deployed minified chunk (`/app/apps/web/.next/server/chunks/_1ks12ad._.js`),
verbatim:

```js
n=s.map(i=>{var o,r;let n,a;return o=e.activity,n=o.governedData,
  {...(a=t[(r={workloadClass,classificationKnown, …
```

Turbopack **inlined** `profileFromHint` into the `.map` callback, renamed that
callback's `workloadClass` parameter to `i`, but then **failed to rewrite the
object-shorthand `{ workloadClass }`** whose value was that renamed parameter —
emitting a bare `workloadClass` bound to nothing. The sibling shorthand
`classificationKnown` survives because it is a closure variable, not the inlined
parameter, which is exactly why only `workloadClass` throws.

## Why it hid for days

- Source is correct, `tsc` is clean, unit tests are clean. **The bug exists only
  in the minified production bundle** — nothing that runs TS source can reproduce
  it.
- The `phase-model-resolution` catch kept only `err.message` and discarded the
  stack, and (pre-slice-1) relabelled it "No AI providers configured", aiming
  every investigator at a configuration problem that did not exist.

## The fix

`work-context.ts` `profileFromHint`: rename the parameter to `hintWorkloadClass`
and write the property explicitly as `workloadClass: hintWorkloadClass` instead
of shorthand. That gives the minifier a distinct value identifier to rename, so
the inliner can no longer collapse it into a dangling shorthand. Semantically
identical; typecheck-clean. A comment marks it load-bearing so it is not
"simplified" back.

## Hardening gap — a unit test cannot guard this

This class of bug only appears after minification, so a source-level test never
sees it. Real regression protection needs a **post-build** check: after
`next build`, load the built suitability module (or scan the emitted chunks) and
assert `deriveProviderSuitabilityWorkContext` resolves without a `ReferenceError`
/ emits no dangling free-variable shorthand. Recommended as a prod-build gate
step (follow-up).

## Verification

The only valid proof is the built bundle, not a unit test:

1. Rebuild the web bundle from this branch.
2. `grep` the emitted `.next/server/chunks` for a bare `workloadClass` shorthand
   in the suitability code — it must be gone (only `.workloadClass` /
   `workloadClass:` property forms remain).
3. On the live install, `resolve_model_selection` must stop returning
   `workloadClass is not defined` for the routed phases.

## Interaction with the flood

Even unfixed, the 8 stranded builds age out to `abandoned` at 7 days
(BI-A009313E, keyed on `createdAt`), i.e. ~2026-07-25, which stops the flood on
its own. This fix lets the routed phases actually resolve, so a build with an
eligible provider can complete `plan` instead of being abandoned.

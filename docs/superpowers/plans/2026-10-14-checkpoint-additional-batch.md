---
status: active
---

# Additional canonical checkpoint batch

Backlog: BI-7BBE7F23. Workroom: WC-39732189.
Base: 2748294d2bbd2139a1c0876f67bde4d67b4bb9a6.
Effective delivery is medium because the existing workflow publishes outward.
Implementation admission: IRD-EFB22A43C5E0. Research receipt:
initiative-4b171236-fe80-4375-bfec-4ebd9b17d961.

## Design grounding

Extend `.github/workflows/daily-checkpoint-tag.yml`, its existing tag-ref
dispatches, `publish-image.yml` and `publish-release.yml`. The daily producer
currently cannot publish later protected merges on the same day. Reuse its
existing bot permissions and concurrency group. No new publisher, credential,
runtime swap or mutable tag is introduced.

An explicit manual boolean input selects an additional batch. It requires the
main ref, an existing daily checkpoint, a descendant head with new commits and
a positive numeric workflow run number. The run number supplies an immutable
`vYYYY.MM.DD-dev-recovery.N` tag. A retry never moves an existing tag; a mismatch
fails. Default and scheduled runs retain their daily no-op behavior. Both
publishers still receive the newly pushed tag as their ref and input.

## Acceptance and verification

The live item's criteria govern this atomic workflow repair:

- Scheduled/default runs preserve once-per-day checkpoint semantics.
- Explicit manual additional batch on main creates one immutable tag for the exact protected source; retries do not overwrite it.
- Empty batch, non-main ref and unsafe identities never publish.
- Both canonical native release and Docker publishers receive the same tag ref.
- Meaningful selection and workflow wiring tests pass; actual qualified artifacts and governed self-upgrade provide deployment proof.

Execute the actual workflow Bash in isolated real Git repositories through the
existing native-shell resolver. Test daily no-op, advanced additional batch,
same-run retry, conflicting tag, empty batch, invalid ref and invalid run number.
Test publisher wiring and the manual input. Independent source review and
required GitHub checks precede canonical publication. Then qualify both native
assets and multi-arch image identities/E2E and request one governed self-upgrade.
Source regressions never substitute for actual publication or served proof.

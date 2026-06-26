# `lib/actions/shared` — shared server-action helpers

Cross-cutting helpers shared by the server actions in `apps/web/lib/actions/`.
Keeping them here (rather than re-deriving them per file) makes the security
surface auditable in one place.

## `guards.ts` — capability authorization preamble

`requireCapability` / `withCapability` deduplicate the `auth() → session →
can() → throw` preamble that was copy-pasted across ~40 action files (the
`requireManageFinance` block was verbatim across the eight finance files).
Design of record: BI-OPT-ACTION-WRAPPER, `docs/superpowers/specs/2026-06-26-platform-optimization-sweep.md`
§"F-D · No shared action auth wrapper".

```ts
import { requireCapability, withCapability } from "@/lib/actions/shared/guards";

// Throws Error("Unauthorized") when unauthenticated or lacking the capability.
const { userId } = await requireCapability("manage_finance");

// Or wrap the action body so the callback receives { userId }:
export const archiveThing = (id: string) =>
  withCapability("manage_backlog", ({ userId }) => doArchive(id, userId));
```

The capability check itself still lives in the canonical `can()` primitive
(`@/lib/permissions`); `guards.ts` only owns the wrapper. `requireCapability`
returns `{ userId }`; void call sites simply `await` it, and id-returning
helpers project `.userId`.

### When NOT to use it (keep the bespoke helper)

`requireCapability` is the **standard** preamble only: resolve the session, run
a single `can()` check, throw `Error("Unauthorized")`. A local helper that does
anything *more* keeps its own body — do not flatten it into the shared wrapper:

- ownership / row-scoped checks (e.g. "you own this `FeatureBuild`");
- a different thrown error type or message (e.g. `WorkbookError`, a custom
  "manage_platform required to …" string);
- returning a result-object union (`{ ok: false; error }`) instead of throwing;
- multi-capability OR logic (`requireAnyCapability`);
- returning richer context than `{ userId }` (full user, email, `isSuperuser`);
- auth-only helpers that intentionally skip `can()` (any signed-in user).

These bespoke helpers are intentionally left in place; only the byte-identical
standard preambles were migrated.

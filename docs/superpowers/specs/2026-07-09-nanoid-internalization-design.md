# nanoid internalization — owned `newId()` façade over Node crypto

- Epic: EP-8DC217EB (Vertical Integration Inward), BET-14
- Backlog item: BI-C0CEB377
- Date: 2026-07-09
- Status: implemented

## Kernel decision

`principle_decide` selected **own-newid-facade** with **HIGH** confidence
(composite 9.760, margin 3.115) over keeping the third-party `nanoid`
dependency. The generator's job — mint short, url-safe, collision-resistant
unique ids for business records — is squarely inside DPF's owned surface and
needs no external package. Internalizing it removes a supply-chain edge for a
handful of lines of code we can own outright.

## Façade design

`apps/web/lib/shared/new-id.ts` exports a single function:

```ts
export function newId(size = 21): string
```

- Backed by `randomBytes` from `node:crypto` — reads `size` random bytes.
- Maps each byte to a character via `byte & 63` into **nanoid's exact default
  64-character url-safe alphabet**
  (`useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict`).
- Default size 21 matches nanoid's default. `& 63` over a 64-symbol alphabet is
  uniform, so no rejection loop is needed.

Ids are opaque unique strings, so byte-for-byte parity with the old library is
not required. We deliberately keep the same alphabet and length semantics so no
downstream length/charset assumption can break — every migrated call site keeps
its existing prefix and size argument unchanged (e.g. `` `FA-${newId(8)}` ``).

Unit test `new-id.test.ts` asserts: default length 21; honoured custom sizes
(1/6/8/10/12/32/64); only-alphabet characters over many draws; and distinctness
across 10,000 calls. No wall-clock or `Math.random` pins — just the crypto call
plus format/distinctness assertions.

The façade is re-exported (extensionless) from the `lib/shared` barrel
(`index.ts`); its barrel snapshot test was updated.

## Codemod

38 call sites across 17 files (`lib/actions`, `lib/storefront`, `lib/finance`,
`lib/release`, `app/api/storefront`) migrated:

- `import { nanoid } from "nanoid"` → `import { newId } from "@/lib/shared/new-id"`
- `nanoid(n)` → `newId(n)`

All call sites passed an explicit size (6/8/10/12/32); there were no arg-less
calls and **no `customAlphabet` / custom-alphabet usage** (verified — the façade
covers every call). No surrounding logic, prefix, or size argument was changed.
Four test files that `vi.mock("nanoid", …)` were redirected to
`vi.mock("@/lib/shared/new-id", …)` with the `newId` export key.

## Dependency drop

- `"nanoid"` removed from `apps/web/package.json` dependencies.
- `nanoid` entry removed from `sbom/dependency-allowlist.json`.
- Lockfile refreshed; `scripts/sbom/check-new-dependencies.mjs` reports OK
  (nanoid no longer declared).

## Ratchet

`scripts/check-no-nanoid-import.mjs` (+ `.test.mjs`) bans any NEW
`from "nanoid"` / `require("nanoid")` import across `apps/web`, `packages`, and
`services`. The ALLOWLIST is **empty** — every site is migrated. It is
auto-discovered by the `scripts/check-no-*.mjs` guard loop, so no `ci.yml` or
`package.json` edit is needed. Copies the frozen-ALLOWLIST + CANONICAL-skip +
self-test idiom from `check-no-local-isrecord.mjs`.

## Remaining BET-14 own-candidate tail

Other BET-14 internalization candidates each still need their **own** kernel
decision before action — this decision only governs `nanoid`:

- **dotenv → Node `--env-file`** — Node's native `--env-file` may replace the
  `dotenv` package outright; needs a `principle_decide` on the flag-vs-package
  trade-off and any `.env` parsing edge cases.
- **picomatch** — glob-matching helper; evaluate whether an owned matcher or a
  narrower built-in covers the usage before dropping it.

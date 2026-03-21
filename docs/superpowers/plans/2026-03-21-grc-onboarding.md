# EP-GRC-ONBOARD: Regulation & Standards Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic onboarding process for any regulation, standard, or framework — 4-step wizard, AI coworker entry point, sourceType extension, policy-obligation many-to-many, and critical UI gap fixes.

**Architecture:** Extend `REGULATION_SOURCE_TYPES` to 4 values, add `PolicyObligationLink` and `OnboardingDraft` tables, create a 4-step onboarding wizard component, add `prefill_onboarding_wizard` MCP tool for AI-assisted onboarding, and add `onboardRegulation()` transactional server action. The existing `CreateRegulationForm` gains sourceType/effectiveDate fields.

**Tech Stack:** TypeScript, Next.js 16, Prisma, Vitest, React (client components for wizard)

**Spec:** `docs/superpowers/specs/2026-03-21-grc-onboarding-design.md`

---

### Task 1: Expand REGULATION_SOURCE_TYPES and update tests

**Files:**
- Modify: `apps/web/lib/compliance-types.ts`
- Modify: `apps/web/lib/compliance-types.test.ts` (if exists, or the test that asserts `toHaveLength(2)`)

- [ ] **Step 1: Update the constant**

In `apps/web/lib/compliance-types.ts`, find line 26:

```ts
export const REGULATION_SOURCE_TYPES = ["external", "internal"] as const;
```

Replace with:

```ts
export const REGULATION_SOURCE_TYPES = ["external", "standard", "framework", "internal"] as const;
```

- [ ] **Step 2: Update test assertion**

Find the test that asserts `REGULATION_SOURCE_TYPES` has length 2 and update it to expect 4. Search for `toHaveLength(2)` in compliance test files.

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run lib/compliance-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/compliance-types.ts apps/web/lib/compliance-types.test.ts
git commit -m "feat(grc): expand REGULATION_SOURCE_TYPES to support standards and frameworks"
```

---

### Task 2: Add PolicyObligationLink and OnboardingDraft to schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add PolicyObligationLink model**

Add after the `PolicyAcknowledgment` model (after the `@@index` lines):

```prisma
model PolicyObligationLink {
  id           String     @id @default(cuid())
  policyId     String
  obligationId String
  notes        String?
  createdAt    DateTime   @default(now())

  policy       Policy     @relation(fields: [policyId], references: [id], onDelete: Cascade)
  obligation   Obligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@unique([policyId, obligationId])
  @@index([policyId])
  @@index([obligationId])
}
```

- [ ] **Step 2: Add OnboardingDraft model**

Add after PolicyObligationLink:

```prisma
model OnboardingDraft {
  id        String   @id @default(cuid())
  data      Json
  createdBy String
  createdAt DateTime @default(now())
  expiresAt DateTime
}
```

- [ ] **Step 3: Add relation fields to Policy and Obligation**

On the `Policy` model, add after `requirements PolicyRequirement[]`:

```prisma
  obligationLinks  PolicyObligationLink[]
```

On the `Obligation` model, add after `policies Policy[]`:

```prisma
  policyLinks      PolicyObligationLink[]
```

- [ ] **Step 4: Push schema**

Run: `cd packages/db && npx prisma migrate dev --name policy_obligation_link_onboarding_draft`
Expected: Migration created and applied successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(grc): add PolicyObligationLink and OnboardingDraft schema models"
```

---

### Task 3: Add policy-obligation linking server actions

**Files:**
- Modify: `apps/web/lib/actions/policy.ts`

- [ ] **Step 1: Add linking functions**

Add at the end of `apps/web/lib/actions/policy.ts` (after all existing exports):

```ts
// ─── Policy ↔ Obligation Linking ──────────────────────────────────────────────

export async function linkPolicyToObligation(
  policyId: string,
  obligationId: string,
  notes?: string | null,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.policyObligationLink.findUnique({
    where: { policyId_obligationId: { policyId, obligationId } },
  });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.policyObligationLink.create({
    data: { policyId, obligationId, notes: notes ?? null },
  });

  await logComplianceAction("policy", policyId, "obligation-linked", employeeId, null, {
    notes: `Linked to obligation ${obligationId}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation linked to policy." };
}

export async function unlinkPolicyFromObligation(
  policyId: string,
  obligationId: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.policyObligationLink.delete({
    where: { policyId_obligationId: { policyId, obligationId } },
  }).catch(() => null);

  await logComplianceAction("policy", policyId, "obligation-unlinked", employeeId, null, {
    notes: `Unlinked obligation ${obligationId}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation unlinked from policy." };
}

export async function getPolicyObligations(policyId: string) {
  await requireViewCompliance();
  return prisma.policyObligationLink.findMany({
    where: { policyId },
    include: {
      obligation: {
        include: {
          regulation: { select: { id: true, shortName: true, sourceType: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}
```

- [ ] **Step 3: Migrate existing obligationId data**

Add a one-time migration function (can be called manually or via seed):

```ts
export async function migrateObligationIdToLinks(): Promise<{ migrated: number }> {
  const policies = await prisma.policy.findMany({
    where: { obligationId: { not: null } },
    select: { id: true, obligationId: true },
  });

  let migrated = 0;
  for (const policy of policies) {
    if (!policy.obligationId) continue;
    const exists = await prisma.policyObligationLink.findUnique({
      where: { policyId_obligationId: { policyId: policy.id, obligationId: policy.obligationId } },
    });
    if (!exists) {
      await prisma.policyObligationLink.create({
        data: { policyId: policy.id, obligationId: policy.obligationId },
      });
      migrated++;
    }
  }
  return { migrated };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/policy.ts
git commit -m "feat(grc): add policy-obligation many-to-many linking actions + migration"
```

---

### Task 4: Add onboardRegulation transactional server action

**Files:**
- Modify: `apps/web/lib/actions/compliance.ts`
- Modify: `apps/web/lib/compliance-types.ts`

- [ ] **Step 1: Add OnboardingInput type**

Add to `apps/web/lib/compliance-types.ts` after the existing input types:

```ts
export type OnboardingObligationInput = {
  title: string;
  reference?: string | null;
  category?: string | null;
  frequency?: string | null;
  applicability?: string | null;
  description?: string | null;
};

export type OnboardingControlInput = {
  title: string;
  controlType: string;
  linkedObligationIndices: number[];
};

export type OnboardingInput = {
  regulation: RegulationInput;
  obligations: OnboardingObligationInput[];
  controls?: OnboardingControlInput[];
};
```

- [ ] **Step 2: Add onboardRegulation server action**

Add to `apps/web/lib/actions/compliance.ts`:

```ts
export async function onboardRegulation(input: OnboardingInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRegulationInput(input.regulation);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create regulation
      const regulation = await tx.regulation.create({
        data: {
          regulationId: generateRegulationId(),
          name: input.regulation.name.trim(),
          shortName: input.regulation.shortName.trim(),
          jurisdiction: input.regulation.jurisdiction.trim(),
          industry: input.regulation.industry ?? null,
          sourceType: input.regulation.sourceType ?? "external",
          effectiveDate: input.regulation.effectiveDate ?? null,
          reviewDate: input.regulation.reviewDate ?? null,
          sourceUrl: input.regulation.sourceUrl ?? null,
          notes: input.regulation.notes ?? null,
        },
      });

      // 2. Create obligations
      const obligations = [];
      for (const obl of input.obligations) {
        const record = await tx.obligation.create({
          data: {
            obligationId: generateObligationId(),
            regulationId: regulation.id,
            title: obl.title.trim(),
            description: obl.description ?? null,
            reference: obl.reference ?? null,
            category: obl.category ?? "other",
            frequency: obl.frequency ?? null,
            applicability: obl.applicability ?? null,
          },
        });
        obligations.push(record);
      }

      // 3. Create controls and link to obligations (if any)
      if (input.controls?.length) {
        for (const ctrl of input.controls) {
          const control = await tx.control.create({
            data: {
              controlId: generateControlId(),
              title: ctrl.title.trim(),
              controlType: ctrl.controlType,
              implementationStatus: "planned",
            },
          });

          for (const idx of ctrl.linkedObligationIndices) {
            const obl = obligations[idx];
            if (obl) {
              await tx.controlObligationLink.create({
                data: { controlId: control.id, obligationId: obl.id },
              });
            }
          }
        }
      }

      return { regulationId: regulation.regulationId, id: regulation.id, obligationCount: obligations.length };
    });

    await logComplianceAction("regulation", result.id, "onboarded", employeeId, null);
    revalidatePath("/compliance");
    return {
      ok: true,
      message: `Onboarded ${input.regulation.shortName} with ${result.obligationCount} obligations.`,
      id: result.id,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Onboarding failed." };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/compliance.ts apps/web/lib/compliance-types.ts
git commit -m "feat(grc): add onboardRegulation transactional server action"
```

---

### Task 5: Create OnboardingWizard component

**Files:**
- Create: `apps/web/components/compliance/OnboardingWizard.tsx`

- [ ] **Step 1: Create the wizard component**

Create `apps/web/components/compliance/OnboardingWizard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { onboardRegulation } from "@/lib/actions/compliance";
import { REGULATION_SOURCE_TYPES, OBLIGATION_CATEGORIES, OBLIGATION_FREQUENCIES } from "@/lib/compliance-types";
import type { OnboardingObligationInput, OnboardingControlInput } from "@/lib/compliance-types";

type Step = 1 | 2 | 3 | 4;

type RegMeta = {
  name: string;
  shortName: string;
  sourceType: string;
  jurisdiction: string;
  industry: string;
  sourceUrl: string;
  effectiveDate: string;
  notes: string;
};

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClasses = "block text-xs text-[var(--dpf-muted)] mb-1";
const btnPrimary = "px-4 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50";
const btnSecondary = "px-4 py-1.5 text-xs font-medium rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]";

type Props = {
  draft?: {
    name?: string;
    shortName?: string;
    sourceType?: string;
    jurisdiction?: string;
    industry?: string;
    sourceUrl?: string;
    obligations?: OnboardingObligationInput[];
    suggestedControls?: OnboardingControlInput[];
  } | null;
};

export function OnboardingWizard({ draft }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meta, setMeta] = useState<RegMeta>({
    name: draft?.name ?? "",
    shortName: draft?.shortName ?? "",
    sourceType: draft?.sourceType ?? "external",
    jurisdiction: draft?.jurisdiction ?? "",
    industry: draft?.industry ?? "",
    sourceUrl: draft?.sourceUrl ?? "",
    effectiveDate: "",
    notes: "",
  });

  const [obligations, setObligations] = useState<OnboardingObligationInput[]>(
    draft?.obligations ?? []
  );

  const [controls, setControls] = useState<OnboardingControlInput[]>(
    draft?.suggestedControls ?? []
  );

  function addObligation() {
    setObligations([...obligations, { title: "", reference: "", category: "other", frequency: "", applicability: "", description: "" }]);
  }

  function removeObligation(idx: number) {
    setObligations(obligations.filter((_, i) => i !== idx));
  }

  function updateObligation(idx: number, field: keyof OnboardingObligationInput, value: string) {
    const updated = [...obligations];
    updated[idx] = { ...updated[idx]!, [field]: value || null };
    setObligations(updated);
  }

  async function handleCommit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await onboardRegulation({
        regulation: {
          name: meta.name,
          shortName: meta.shortName,
          sourceType: meta.sourceType,
          jurisdiction: meta.jurisdiction,
          industry: meta.industry || null,
          sourceUrl: meta.sourceUrl || null,
          effectiveDate: meta.effectiveDate ? new Date(meta.effectiveDate) : null,
          notes: meta.notes || null,
        },
        obligations,
        controls: controls.length > 0 ? controls : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        setSubmitting(false);
        return;
      }
      router.push("/compliance/regulations");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onboarding failed.");
      setSubmitting(false);
    }
  }

  // ─── Step 1: Identity ─────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="max-w-lg">
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-4">Step 1: Identity</h2>
        <div className="space-y-3">
          <div>
            <label className={labelClasses}>Name *</label>
            <input className={inputClasses} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="General Data Protection Regulation" />
          </div>
          <div>
            <label className={labelClasses}>Short Name *</label>
            <input className={inputClasses} value={meta.shortName} onChange={(e) => setMeta({ ...meta, shortName: e.target.value })} placeholder="GDPR" />
          </div>
          <div>
            <label className={labelClasses}>Source Type *</label>
            <select className={inputClasses} value={meta.sourceType} onChange={(e) => setMeta({ ...meta, sourceType: e.target.value })}>
              {REGULATION_SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClasses}>Jurisdiction *</label>
            <input className={inputClasses} value={meta.jurisdiction} onChange={(e) => setMeta({ ...meta, jurisdiction: e.target.value })} placeholder="EU" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>Industry</label>
              <input className={inputClasses} value={meta.industry} onChange={(e) => setMeta({ ...meta, industry: e.target.value })} placeholder="All" />
            </div>
            <div>
              <label className={labelClasses}>Effective Date</label>
              <input type="date" className={inputClasses} value={meta.effectiveDate} onChange={(e) => setMeta({ ...meta, effectiveDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Source URL</label>
            <input type="url" className={inputClasses} value={meta.sourceUrl} onChange={(e) => setMeta({ ...meta, sourceUrl: e.target.value })} placeholder="https://..." />
          </div>
          <div>
            <label className={labelClasses}>Notes</label>
            <textarea className={inputClasses} rows={2} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
          </div>
          <div className="flex justify-end pt-2">
            <button className={btnPrimary} disabled={!meta.name || !meta.shortName || !meta.jurisdiction} onClick={() => setStep(2)}>
              Next: Obligations
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: Obligations ──────────────────────────────────────────────
  if (step === 2) {
    return (
      <div>
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-1">Step 2: Obligations</h2>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">{obligations.length} obligation(s) — edit, add, or remove as needed.</p>
        <div className="space-y-2 mb-4 max-h-[60vh] overflow-y-auto">
          {obligations.map((obl, i) => (
            <div key={i} className="p-3 rounded border border-[var(--dpf-border)] space-y-2">
              <div className="flex gap-2">
                <input className={inputClasses + " flex-1"} placeholder="Title *" value={obl.title} onChange={(e) => updateObligation(i, "title", e.target.value)} />
                <input className={inputClasses + " w-28"} placeholder="Ref" value={obl.reference ?? ""} onChange={(e) => updateObligation(i, "reference", e.target.value)} />
                <button onClick={() => removeObligation(i)} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select className={inputClasses} value={obl.category ?? "other"} onChange={(e) => updateObligation(i, "category", e.target.value)}>
                  {OBLIGATION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className={inputClasses} value={obl.frequency ?? ""} onChange={(e) => updateObligation(i, "frequency", e.target.value)}>
                  <option value="">No frequency</option>
                  {OBLIGATION_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <input className={inputClasses} placeholder="Applicability" value={obl.applicability ?? ""} onChange={(e) => updateObligation(i, "applicability", e.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <button onClick={addObligation} className={btnSecondary + " mb-4"}>+ Add Obligation</button>
        <div className="flex justify-between">
          <button className={btnSecondary} onClick={() => setStep(1)}>Back</button>
          <button className={btnPrimary} onClick={() => setStep(3)}>Next: Controls</button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Controls (optional) ──────────────────────────────────────
  if (step === 3) {
    return (
      <div>
        <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-1">Step 3: Controls (optional)</h2>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">Map controls to obligations. You can skip this and add controls later.</p>
        <p className="text-xs text-[var(--dpf-muted)] mb-4">{controls.length} control(s) suggested.</p>
        {/* Controls editing UI — simplified for initial implementation */}
        {controls.map((ctrl, i) => (
          <div key={i} className="p-3 rounded border border-[var(--dpf-border)] mb-2">
            <div className="flex gap-2 items-center">
              <input className={inputClasses + " flex-1"} value={ctrl.title} onChange={(e) => {
                const updated = [...controls];
                updated[i] = { ...updated[i]!, title: e.target.value };
                setControls(updated);
              }} />
              <select className={inputClasses + " w-32"} value={ctrl.controlType} onChange={(e) => {
                const updated = [...controls];
                updated[i] = { ...updated[i]!, controlType: e.target.value };
                setControls(updated);
              }}>
                <option value="preventive">Preventive</option>
                <option value="detective">Detective</option>
                <option value="corrective">Corrective</option>
              </select>
              <button onClick={() => setControls(controls.filter((_, j) => j !== i))} className="text-xs text-red-400 hover:text-red-300 px-2">Remove</button>
            </div>
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
              Linked to: {ctrl.linkedObligationIndices.map((idx) => obligations[idx]?.title ?? `#${idx}`).join(", ") || "none"}
            </p>
          </div>
        ))}
        <div className="flex justify-between mt-4">
          <button className={btnSecondary} onClick={() => setStep(2)}>Back</button>
          <button className={btnPrimary} onClick={() => setStep(4)}>Next: Confirm</button>
        </div>
      </div>
    );
  }

  // ─── Step 4: Confirm ──────────────────────────────────────────────────
  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-bold text-[var(--dpf-text)] mb-4">Step 4: Confirm</h2>
      <div className="space-y-3 mb-6">
        <div className="p-3 rounded border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Name</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{meta.name} ({meta.shortName})</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Type</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{meta.sourceType}</p>
          </div>
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Obligations</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligations.length}</p>
          </div>
          <div className="p-3 rounded border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Controls</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{controls.length}</p>
          </div>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 mb-4">{error}</p>}
      <div className="flex justify-between">
        <button className={btnSecondary} onClick={() => setStep(3)}>Back</button>
        <button className={btnPrimary} disabled={submitting || obligations.length === 0} onClick={handleCommit}>
          {submitting ? "Onboarding..." : "Commit to Compliance Register"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/compliance/OnboardingWizard.tsx
git commit -m "feat(grc): add OnboardingWizard 4-step component"
```

---

### Task 6: Create onboarding wizard page

**Files:**
- Create: `apps/web/app/(shell)/compliance/onboard/page.tsx`
- Modify: `apps/web/app/(shell)/compliance/regulations/page.tsx`

- [ ] **Step 1: Create the wizard page**

Create `apps/web/app/(shell)/compliance/onboard/page.tsx`:

```tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { OnboardingWizard } from "@/components/compliance/OnboardingWizard";

type Props = { searchParams: Promise<{ draft?: string }> };

export default async function OnboardPage({ searchParams }: Props) {
  const { draft: draftId } = await searchParams;

  // Lazy cleanup: delete expired drafts
  await prisma.onboardingDraft.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).catch(() => {});

  // Load draft if provided
  let draftData = null;
  if (draftId) {
    const draft = await prisma.onboardingDraft.findUnique({ where: { id: draftId } });
    if (draft) {
      draftData = draft.data as Record<string, unknown>;
      // Draft is NOT deleted here — it persists until the wizard commits (OnboardingWizard
      // calls a cleanup action after successful onboardRegulation) or expires after 24h.
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Link href="/compliance/regulations" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Regulations
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Onboard</span>
      </div>
      <OnboardingWizard draft={draftData as any} />
    </div>
  );
}
```

- [ ] **Step 2: Add Onboard button to regulations list page**

In `apps/web/app/(shell)/compliance/regulations/page.tsx`, find the `CreateRegulationForm` button. Add an "Onboard" link next to it:

```tsx
<Link href="/compliance/onboard" className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
  Onboard Regulation / Standard
</Link>
```

Add `import Link from "next/link"` if not present.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(shell)/compliance/onboard/page.tsx" "apps/web/app/(shell)/compliance/regulations/page.tsx"
git commit -m "feat(grc): add onboarding wizard page and link from regulations list"
```

---

### Task 7: Add sourceType and effectiveDate to CreateRegulationForm

**Files:**
- Modify: `apps/web/components/compliance/CreateRegulationForm.tsx`

- [ ] **Step 1: Add sourceType dropdown and effectiveDate field**

Read the current file. Add to the form (after the industry field, before sourceUrl):

```tsx
<div>
  <label className={labelClasses}>Source Type *</label>
  <select name="sourceType" required className={inputClasses}>
    {REGULATION_SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
  </select>
</div>
<div>
  <label className={labelClasses}>Effective Date</label>
  <input name="effectiveDate" type="date" className={inputClasses} />
</div>
```

Add import: `import { REGULATION_SOURCE_TYPES } from "@/lib/compliance-types";`

Update the form data extraction to include:
```ts
sourceType: (form.get("sourceType") as string) || "external",
effectiveDate: form.get("effectiveDate") ? new Date(form.get("effectiveDate") as string) : null,
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/compliance/CreateRegulationForm.tsx
git commit -m "feat(grc): add sourceType and effectiveDate to CreateRegulationForm"
```

---

### Task 8: Add prefill_onboarding_wizard MCP tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add tool definition**

Add to `PLATFORM_TOOLS` array (before the end of the array):

```ts
    {
      name: "prefill_onboarding_wizard",
      description: "Pre-fill the regulation onboarding wizard with AI-drafted data. Stores a draft and returns the wizard URL for human review.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full regulation/standard name" },
          shortName: { type: "string", description: "Abbreviation (e.g., GDPR, WCAG)" },
          sourceType: { type: "string", enum: ["external", "standard", "framework", "internal"], description: "Type of regulation/standard" },
          jurisdiction: { type: "string", description: "Geographic scope (e.g., EU, UK, Global)" },
          industry: { type: "string", description: "Industry applicability" },
          sourceUrl: { type: "string", description: "URL to official text" },
          obligations: {
            type: "array",
            description: "Extracted obligations",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                reference: { type: "string" },
                category: { type: "string" },
                frequency: { type: "string" },
                applicability: { type: "string" },
                description: { type: "string" },
              },
              required: ["title"],
            },
          },
          suggestedControls: {
            type: "array",
            description: "Suggested control mappings",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                controlType: { type: "string", enum: ["preventive", "detective", "corrective"] },
                linkedObligationIndices: { type: "array", items: { type: "number" } },
              },
              required: ["title", "controlType"],
            },
          },
        },
        required: ["name", "shortName", "sourceType"],
      },
      requiredCapability: "manage_compliance",
      sideEffect: true,
    },
```

- [ ] **Step 2: Add execution case**

Add to the `executeTool` switch:

```ts
    case "prefill_onboarding_wizard": {
      const data = {
        name: String(params["name"] ?? ""),
        shortName: String(params["shortName"] ?? ""),
        sourceType: String(params["sourceType"] ?? "external"),
        jurisdiction: String(params["jurisdiction"] ?? ""),
        industry: params["industry"] ? String(params["industry"]) : null,
        sourceUrl: params["sourceUrl"] ? String(params["sourceUrl"]) : null,
        obligations: Array.isArray(params["obligations"]) ? params["obligations"] : [],
        suggestedControls: Array.isArray(params["suggestedControls"]) ? params["suggestedControls"] : [],
      };

      const draft = await prisma.onboardingDraft.create({
        data: {
          data: data as any,
          createdBy: userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      const wizardUrl = `/compliance/onboard?draft=${draft.id}`;
      return {
        success: true,
        message: `Onboarding draft created. Navigate to ${wizardUrl} to review and commit.`,
        data: { wizardUrl, draftId: draft.id },
      };
    }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat(grc): add prefill_onboarding_wizard MCP tool"
```

---

### Task 9: Add onboarding coworker skill to compliance route

**Files:**
- Modify: `apps/web/lib/route-context-map.ts`

- [ ] **Step 1: Add the skill**

Find the `/compliance` route entry's `skills` array. Add a new entry (before or after "Add a regulation"):

```ts
    {
      label: "Onboard a regulation or standard",
      description: "Research and import a regulation, standard, or framework into the compliance register",
      capability: "manage_compliance",
      taskType: "analysis",
      prompt: "Help the user onboard a new regulation, standard, or framework. Ask what they want to onboard. Then: (1) Research it — use web search for public standards, or ask for a document upload for proprietary ones. (2) Extract the obligation structure — titles, references (article/clause numbers), categories, frequency, applicability. (3) Suggest control mappings where obvious. (4) Call prefill_onboarding_wizard with the drafted structure to create a draft and navigate the user to the onboarding wizard for review.",
    },
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/route-context-map.ts
git commit -m "feat(grc): add 'Onboard a regulation or standard' coworker skill"
```

---

### Task 10: Update policy detail page for many-to-many obligations

**Files:**
- Modify: `apps/web/app/(shell)/compliance/policies/[id]/page.tsx`
- Create: `apps/web/components/compliance/LinkPolicyObligationForm.tsx`

- [ ] **Step 1: Create LinkPolicyObligationForm component**

Create `apps/web/components/compliance/LinkPolicyObligationForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ComplianceModal } from "./ComplianceModal";
import { linkPolicyToObligation } from "@/lib/actions/policy";

type AvailableObligation = {
  id: string;
  title: string;
  reference: string | null;
  regulation: { shortName: string; sourceType: string } | null;
};

type Props = {
  policyId: string;
  linkedObligationIds: string[];
  availableObligations: AvailableObligation[];
};

const inputClasses = "w-full rounded border border-[var(--dpf-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";

export function LinkPolicyObligationForm({ policyId, linkedObligationIds, availableObligations }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [linking, setLinking] = useState<string | null>(null);
  const router = useRouter();

  const unlinked = availableObligations.filter((o) => !linkedObligationIds.includes(o.id));
  const filtered = unlinked
    .filter((o) => sourceFilter === "all" || o.regulation?.sourceType === sourceFilter)
    .filter((o) => o.title.toLowerCase().includes(filter.toLowerCase()) ||
      o.regulation?.shortName.toLowerCase().includes(filter.toLowerCase()));

  async function handleLink(obligationId: string) {
    setLinking(obligationId);
    const result = await linkPolicyToObligation(policyId, obligationId);
    setLinking(null);
    if (result.ok) {
      router.refresh();
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
        Link Obligation
      </button>
      <ComplianceModal open={open} onClose={() => setOpen(false)} title="Link Obligation to Policy">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClasses} placeholder="Search obligations..." />
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={inputClasses + " w-36"}>
              <option value="all">All types</option>
              <option value="external">Regulations</option>
              <option value="standard">Standards</option>
              <option value="framework">Frameworks</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--dpf-muted)] py-4 text-center">
                {unlinked.length === 0 ? "All obligations are already linked." : "No obligations match your filter."}
              </p>
            ) : (
              filtered.map((o) => (
                <button key={o.id} disabled={linking !== null} onClick={() => handleLink(o.id)}
                  className="w-full text-left p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors disabled:opacity-50">
                  <span className="text-sm text-[var(--dpf-text)]">{o.title}</span>
                  <div className="flex gap-2 mt-1">
                    {o.regulation && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                        {o.regulation.shortName}
                      </span>
                    )}
                    {o.reference && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                        {o.reference}
                      </span>
                    )}
                  </div>
                  {linking === o.id && <span className="text-[9px] text-[var(--dpf-muted)] mt-1 block">Linking...</span>}
                </button>
              ))
            )}
          </div>
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Cancel</button>
          </div>
        </div>
      </ComplianceModal>
    </>
  );
}
```

- [ ] **Step 2: Update policy detail page**

In `apps/web/app/(shell)/compliance/policies/[id]/page.tsx`:

Add import: `import { LinkPolicyObligationForm } from "@/components/compliance/LinkPolicyObligationForm";`

Update the Prisma query to include `obligationLinks`:
```ts
obligationLinks: {
  include: {
    obligation: {
      include: { regulation: { select: { id: true, shortName: true, sourceType: true } } },
    },
  },
},
```

Also fetch all obligations for the linking form:
```ts
const allObligations = await prisma.obligation.findMany({
  where: { status: "active" },
  select: { id: true, title: true, reference: true, regulation: { select: { shortName: true, sourceType: true } } },
});
```

Replace the existing obligation link section (lines 135-142):
```tsx
{/* Obligation link */}
{policy.obligation ? (
  <p className="text-xs text-blue-400 mb-6">
    Linked to obligation: <a href={`/compliance/obligations/${policy.obligation.id}`} className="underline">{policy.obligation.title}</a>
  </p>
) : (
  <p className="text-xs text-[var(--dpf-muted)] mb-6">Not linked to a regulation or standard.</p>
)}
```

With:
```tsx
{/* Linked Obligations */}
<div className="mb-6">
  <div className="flex items-center gap-2 mb-3">
    <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest">
      Linked Obligations ({policy.obligationLinks.length})
    </h2>
    <LinkPolicyObligationForm
      policyId={policy.id}
      linkedObligationIds={policy.obligationLinks.map((l: any) => l.obligationId)}
      availableObligations={allObligations}
    />
  </div>
  {policy.obligationLinks.length > 0 ? (
    <div className="space-y-1">
      {policy.obligationLinks.map((link: any) => (
        <div key={link.id} className="flex items-center gap-2 text-xs">
          <span className="px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
            {link.obligation.regulation?.shortName ?? "—"}
          </span>
          <a href={`/compliance/obligations/${link.obligation.id}`} className="text-[var(--dpf-accent)] hover:underline">
            {link.obligation.title}
          </a>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-xs text-[var(--dpf-muted)]">No obligations linked yet.</p>
  )}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/compliance/LinkPolicyObligationForm.tsx "apps/web/app/(shell)/compliance/policies/[id]/page.tsx"
git commit -m "feat(grc): replace single obligation link with many-to-many on policy detail page"
```

---

### Task 11: Add regulation list page sourceType filter

**Files:**
- Modify: `apps/web/app/(shell)/compliance/regulations/page.tsx`

- [ ] **Step 1: Add sourceType filter**

Read the current file. The list page fetches all regulations and renders them. Convert to a client component wrapper pattern or use searchParams for filtering:

Add `searchParams` to the page props:
```tsx
type Props = { searchParams: Promise<{ type?: string }> };
```

Filter the query:
```ts
const { type } = await searchParams;
const where: Record<string, unknown> = { status: "active" };
if (type && type !== "all") where.sourceType = type;
```

Add a filter bar above the list:
```tsx
<div className="flex gap-2 mb-4">
  {["all", "external", "standard", "framework", "internal"].map((t) => (
    <a key={t} href={`/compliance/regulations${t === "all" ? "" : `?type=${t}`}`}
      className={`px-3 py-1 text-xs rounded-full border ${(type ?? "all") === t ? "bg-[var(--dpf-accent)] text-white border-[var(--dpf-accent)]" : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"}`}>
      {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
    </a>
  ))}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(shell)/compliance/regulations/page.tsx"
git commit -m "feat(grc): add sourceType filter to regulations list page"
```

---

### Task 12: Add obligation list page filters

**Files:**
- Modify: `apps/web/app/(shell)/compliance/obligations/page.tsx`

- [ ] **Step 1: Add regulation and category filters**

Read the current file. Add `searchParams` to the page props:

```tsx
type Props = { searchParams: Promise<{ regulation?: string; category?: string }> };
```

Filter the query based on params. Add a filter bar above the obligation list with dropdowns for regulation (populated from database) and category (from `OBLIGATION_CATEGORIES` constant).

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(shell)/compliance/obligations/page.tsx"
git commit -m "feat(grc): add regulation and category filters to obligations list page"
```

---

### Task 13: Add Onboard entry to ComplianceTabNav

**Files:**
- Modify: `apps/web/components/compliance/ComplianceTabNav.tsx`

- [ ] **Step 1: Add Onboard tab or button**

Read the current file to find the `TABS` array. Add an "Onboard" entry linking to `/compliance/onboard`. This gives users a direct path from any compliance page to the onboarding wizard.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/compliance/ComplianceTabNav.tsx
git commit -m "feat(grc): add Onboard entry to ComplianceTabNav"
```

---

### Task 14: Add onboardRegulation server action tests

**Files:**
- Modify: `apps/web/lib/actions/compliance.test.ts`

- [ ] **Step 1: Add onboarding transaction tests**

Add tests to the existing compliance test file:

```ts
describe("onboardRegulation", () => {
  it("creates regulation with obligations in a single transaction", async () => {
    const result = await onboardRegulation({
      regulation: { name: "Test Standard", shortName: "TST", jurisdiction: "Global", sourceType: "standard" },
      obligations: [
        { title: "Obligation A", reference: "1.1", category: "operational" },
        { title: "Obligation B", reference: "1.2", category: "cybersecurity" },
      ],
    });
    expect(result.ok).toBe(true);
    // Verify regulation created
    // Verify 2 obligations created with correct regulationId
  });

  it("rolls back on validation failure", async () => {
    const result = await onboardRegulation({
      regulation: { name: "", shortName: "FAIL", jurisdiction: "Global" }, // empty name fails validation
      obligations: [{ title: "Should not exist" }],
    });
    expect(result.ok).toBe(false);
  });

  it("creates controls with obligation links when provided", async () => {
    const result = await onboardRegulation({
      regulation: { name: "Control Test", shortName: "CTL", jurisdiction: "EU" },
      obligations: [{ title: "Obl 1" }, { title: "Obl 2" }],
      controls: [{ title: "Control A", controlType: "preventive", linkedObligationIndices: [0, 1] }],
    });
    expect(result.ok).toBe(true);
    // Verify control created and linked to both obligations
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run lib/actions/compliance.test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/compliance.test.ts
git commit -m "test(grc): add onboardRegulation transaction tests"
```

---

### Task 15: Seed the GRC onboarding epic

**Files:**
- Create: `scripts/seed-grc-onboarding-epic.sql`

- [ ] **Step 1: Create and run the seed script**

Create `scripts/seed-grc-onboarding-epic.sql`:

```sql
-- Seed GRC Onboarding epic
DO $$
DECLARE
  found_id TEXT;
  epic_id  TEXT;
BEGIN
  SELECT id INTO found_id FROM "Portfolio" WHERE slug = 'foundational';

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Regulation & Standards Onboarding',
    'Generic onboarding process for any regulation, standard, or framework. 4-step wizard, AI coworker entry point, sourceType extension, policy-obligation many-to-many, and critical UI enhancements.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  IF found_id IS NOT NULL THEN
    INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
    VALUES (epic_id, found_id);
  END IF;
END $$;
```

Run: `cd packages/db && npx prisma db execute --file ../../scripts/seed-grc-onboarding-epic.sql`

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-grc-onboarding-epic.sql
git commit -m "chore: add GRC onboarding epic seed script"
```

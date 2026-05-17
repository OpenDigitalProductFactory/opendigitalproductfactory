import { Link2, Plus, Save } from "lucide-react";

import {
  createBusinessCapabilityFromForm,
  createBusinessCapabilityTraceLinkFromForm,
  updateBusinessCapabilityMaturityFromForm,
} from "@/lib/actions/business-capabilities";
import type {
  BusinessCapabilityRecord,
  BusinessCapabilityTargetOptions,
} from "@/lib/business-capabilities/data";
import {
  IT4IT_VALUE_STREAMS,
  MATURITY_LEVELS,
  TRACE_RELATIONSHIPS,
  TRACE_TARGET_TYPES,
} from "@/lib/business-capabilities/types";

type Props = {
  capabilities: BusinessCapabilityRecord[];
  targetOptions: BusinessCapabilityTargetOptions;
};

const inputClass =
  "w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:border-[var(--dpf-accent)] focus:outline-none";
const labelClass = "mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--dpf-muted)]";
const optionClass = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";

export function BusinessCapabilityForms({ capabilities, targetOptions }: Props) {
  const parentOptions = capabilities.filter((capability) => capability.level < 3);

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <FormShell title="Add Capability" icon={Plus}>
        <form action={createBusinessCapabilityFromForm} className="space-y-3">
          <Field label="Name">
            <input name="name" className={inputClass} required placeholder="Customer Relationship Management" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Level">
              <select name="level" className={inputClass} defaultValue="1" required>
                <option className={optionClass} value="1">L1</option>
                <option className={optionClass} value="2">L2</option>
                <option className={optionClass} value="3">L3</option>
              </select>
            </Field>
            <Field label="Current">
              <MaturitySelect name="currentMaturity" defaultValue={1} />
            </Field>
            <Field label="Target">
              <MaturitySelect name="targetMaturity" defaultValue={3} />
            </Field>
          </div>
          <Field label="Parent">
            <select name="parentId" className={inputClass} defaultValue="">
              <option className={optionClass} value="">None</option>
              {parentOptions.map((capability) => (
                <option className={optionClass} key={capability.id} value={capability.id}>
                  L{capability.level} {capability.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea name="description" className={`${inputClass} min-h-20 resize-y`} />
          </Field>
          <Field label="Maturity Rationale">
            <input name="maturityRationale" className={inputClass} />
          </Field>
          <Field label="IT4IT Alignment">
            <ValueStreamChecks />
          </Field>
          <SubmitButton icon={Plus}>Add</SubmitButton>
        </form>
      </FormShell>

      <FormShell title="Maturity Overlay" icon={Save}>
        <form action={updateBusinessCapabilityMaturityFromForm} className="space-y-3">
          <CapabilitySelect capabilities={capabilities} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Current">
              <MaturitySelect name="currentMaturity" defaultValue={2} />
            </Field>
            <Field label="Target">
              <MaturitySelect name="targetMaturity" defaultValue={4} />
            </Field>
          </div>
          <Field label="Rationale">
            <textarea name="maturityRationale" className={`${inputClass} min-h-24 resize-y`} />
          </Field>
          <SubmitButton icon={Save}>Save</SubmitButton>
        </form>
      </FormShell>

      <FormShell title="Traceability Link" icon={Link2}>
        <form action={createBusinessCapabilityTraceLinkFromForm} className="space-y-3">
          <CapabilitySelect capabilities={capabilities} />
          <Field label="Target">
            <select name="targetRef" className={inputClass} required defaultValue="">
              <option className={optionClass} value="">Select target</option>
              <TargetGroup label="Taxonomy" type="taxonomy_node" options={targetOptions.taxonomyNodes} />
              <TargetGroup label="Products" type="digital_product" options={targetOptions.digitalProducts} />
              <TargetGroup label="Backlog" type="backlog_item" options={targetOptions.backlogItems} />
              <TargetGroup label="Architecture" type="ea_element" options={targetOptions.eaElements} />
            </select>
          </Field>
          <Field label="Relationship">
            <select name="relationship" className={inputClass} defaultValue="supported_by">
              {TRACE_RELATIONSHIPS.map((relationship) => (
                <option className={optionClass} key={relationship.value} value={relationship.value}>
                  {relationship.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <input name="note" className={inputClass} />
          </Field>
          <SubmitButton icon={Link2}>Link</SubmitButton>
        </form>
      </FormShell>
    </section>
  );
}

function FormShell({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Plus;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function MaturitySelect({ name, defaultValue }: { name: string; defaultValue: number }) {
  return (
    <select name={name} className={inputClass} defaultValue={String(defaultValue)} required>
      {MATURITY_LEVELS.map((level) => (
        <option className={optionClass} key={level.value} value={level.value}>
          {level.value} {level.label}
        </option>
      ))}
    </select>
  );
}

function CapabilitySelect({ capabilities }: { capabilities: BusinessCapabilityRecord[] }) {
  return (
    <Field label="Capability">
      <select name="capabilityRowId" className={inputClass} required defaultValue="">
        <option className={optionClass} value="">Select capability</option>
        {capabilities.map((capability) => (
          <option className={optionClass} key={capability.id} value={capability.id}>
            L{capability.level} {capability.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ValueStreamChecks() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {IT4IT_VALUE_STREAMS.map((stream) => (
        <label
          key={stream.slug}
          className="flex items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-xs text-[var(--dpf-text)]"
        >
          <input
            type="checkbox"
            name="it4itValueStreams"
            value={stream.slug}
            className="h-3.5 w-3.5 accent-[var(--dpf-accent)]"
          />
          {stream.label}
        </label>
      ))}
    </div>
  );
}

function TargetGroup({
  label,
  type,
  options,
}: {
  label: string;
  type: string;
  options: Array<{ id: string; label: string }>;
}) {
  if (options.length === 0) return null;
  return (
    <optgroup label={label}>
      {options.map((option) => (
        <option className={optionClass} key={`${type}:${option.id}`} value={`${type}:${option.id}`}>
          {option.label}
        </option>
      ))}
    </optgroup>
  );
}

function SubmitButton({ icon: Icon, children }: { icon: typeof Plus; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}

"use client";
// EP-UX-SYSTEM L6 (BI-3880DA1D): the founder-facing capture form for the UX
// critique corpus. This is the door the founder walks through to turn a UX
// review note into a stored, verdicted entry — the input that gates the design
// judge and AGT-906's promotion past curation.
//
// This form is itself a surface AGT-906 would critique, so it practises what it
// captures. Layout decided by the kernel (DI-E1600108C932, human_cognitive_load
// axis): the default view carries only what a capture needs — route, the
// finding, and the verdict (the founder's core act) — while the reproduction
// metadata (screenshot, git ref, viewport, theme, lenses) is deferred behind a
// native <details>, which is also the exact construct the budget measurement
// path excises, so disclosure is rewarded here, not taxed. It composes the
// shared accessible form contract (components/ui/form) rather than hand-rolling
// fields, per the UX-fit convergence guardrail.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  CheckboxField,
  FormStatus,
  SelectField,
  SubmitButton,
  TextField,
  TextareaField,
  type SelectOption,
} from "@/components/ui/form";
import { captureCritiqueEntry } from "@/lib/actions/critique-entry";
import {
  CRITIQUE_LENSES,
  CRITIQUE_VERDICTS,
  type CritiqueLens,
  type CritiqueVerdict,
} from "@/lib/ux-critique/critique-entry";

const VERDICT_LABEL: Record<CritiqueVerdict, string> = {
  "change-needed": "Change needed",
  "no-change-needed": "Fine as-is",
  "accepted-debt": "Real, but not now",
};

const LENS_LABEL: Record<CritiqueLens, string> = {
  hierarchy: "Hierarchy",
  density: "Density",
  hick: "Hick (too many choices)",
  fitts: "Fitts (target size / distance)",
  miller: "Miller (grouping / memory)",
  doherty: "Doherty (perceived latency)",
};

const VERDICT_OPTIONS: SelectOption[] = [
  { value: "", label: "No verdict yet (leave for review)" },
  ...CRITIQUE_VERDICTS.map((v) => ({ value: v, label: VERDICT_LABEL[v] })),
];

const AUTHORITY_OPTIONS: SelectOption[] = [
  { value: "founder", label: "Founder" },
  { value: "designer", label: "Designer" },
];

const THEME_OPTIONS: SelectOption[] = [
  { value: "", label: "—" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function CritiqueCaptureForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [route, setRoute] = useState("");
  const [finding, setFinding] = useState("");
  const [verdict, setVerdict] = useState<"" | CritiqueVerdict>("");
  const [verdictAuthority, setVerdictAuthority] = useState<"founder" | "designer">("founder");
  const [screenshotRef, setScreenshotRef] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [viewportWidth, setViewportWidth] = useState("");
  const [colorScheme, setColorScheme] = useState<"" | "light" | "dark">("");
  const [lenses, setLenses] = useState<Set<CritiqueLens>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleLens(lens: CritiqueLens) {
    setLenses((prev) => {
      const next = new Set(prev);
      if (next.has(lens)) next.delete(lens);
      else next.add(lens);
      return next;
    });
  }

  function reset() {
    setTitle("");
    setRoute("");
    setFinding("");
    setVerdict("");
    setScreenshotRef("");
    setGitRef("");
    setViewportWidth("");
    setColorScheme("");
    setLenses(new Set());
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const width = viewportWidth.trim() ? Number(viewportWidth.trim()) : null;
    startTransition(async () => {
      const result = await captureCritiqueEntry({
        title,
        callerKind: "human",
        route,
        finding,
        screenshotRef: screenshotRef.trim() || null,
        gitRef: gitRef.trim() || null,
        viewportWidth: width !== null && Number.isFinite(width) ? width : null,
        colorScheme: colorScheme || null,
        lenses: [...lenses],
        verdict: verdict || null,
        // A verdict on this founder-facing form is an ATTACHED human ruling.
        verdictAuthority: verdict ? verdictAuthority : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      reset();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <p className="text-sm font-medium text-[var(--dpf-text)] mb-1">Capture a UX critique</p>
      <p className="text-xs text-[var(--dpf-muted)] mb-4">
        Record a design review of a real screen. Saved as a draft; your verdict is what makes it
        count. Say what is specifically wrong &mdash; a measurement or a structural observation, not
        an impression.
      </p>

      <div className="flex flex-col gap-3">
        <TextField
          name="critique-title"
          label="Short title"
          value={title}
          onValueChange={setTitle}
          required
          placeholder="Workspace lead band buries the next action"
        />

        <TextField
          name="critique-route"
          label="Route"
          value={route}
          onValueChange={setRoute}
          required
          hint="The path the screen was captured from."
          placeholder="/workspace"
        />

        <TextareaField
          name="critique-finding"
          label="What is wrong, specifically"
          value={finding}
          onValueChange={setFinding}
          required
          rows={3}
          placeholder="Lead band carries 240 words before the owner's next action appears; the primary action sits below three secondary ones."
        />

        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            name="critique-verdict"
            label="Your verdict"
            value={verdict}
            onValueChange={(v) => setVerdict(v as "" | CritiqueVerdict)}
            options={VERDICT_OPTIONS}
            optional
            className="min-w-[16rem]"
          />
          {verdict && (
            <SelectField
              name="critique-verdict-authority"
              label="Attributed to"
              value={verdictAuthority}
              onValueChange={(v) => setVerdictAuthority(v as "founder" | "designer")}
              options={AUTHORITY_OPTIONS}
            />
          )}
        </div>
      </div>

      <details className="mt-4 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
        <summary className="cursor-pointer text-xs text-[var(--dpf-muted)]">
          Reproduction details (optional, but a screenshot is what lets the entry calibrate the
          judge)
        </summary>

        <div className="mt-3 flex flex-col gap-3">
          <TextField
            name="critique-shot"
            label="Screenshot reference"
            value={screenshotRef}
            onValueChange={setScreenshotRef}
            optional
            inputClassName="bg-[var(--dpf-surface-1)]"
            placeholder="capture/workspace-390-light.png"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              name="critique-git"
              label="Git ref at capture"
              value={gitRef}
              onValueChange={setGitRef}
              optional
              inputClassName="bg-[var(--dpf-surface-1)]"
              placeholder="abc1234"
            />
            <TextField
              name="critique-viewport"
              label="Viewport px"
              type="number"
              inputMode="numeric"
              value={viewportWidth}
              onValueChange={setViewportWidth}
              optional
              inputClassName="bg-[var(--dpf-surface-1)]"
              placeholder="390"
            />
            <SelectField
              name="critique-scheme"
              label="Theme"
              value={colorScheme}
              onValueChange={(v) => setColorScheme(v as "" | "light" | "dark")}
              options={THEME_OPTIONS}
              optional
              selectClassName="bg-[var(--dpf-surface-1)]"
            />
          </div>
          <fieldset>
            <legend className="text-xs text-[var(--dpf-muted)] mb-1">
              Lenses (which explain why it is wrong)
            </legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {CRITIQUE_LENSES.map((lens) => (
                <CheckboxField
                  key={lens}
                  name={`lens-${lens}`}
                  label={LENS_LABEL[lens]}
                  checked={lenses.has(lens)}
                  onCheckedChange={() => toggleLens(lens)}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <FormStatus
        className="mt-3"
        error={error}
        success={saved ? "Captured as a draft. Publish it to make it calibration-eligible." : null}
      />

      <div className="mt-3 flex items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Capturing…">
          Capture as draft
        </SubmitButton>
        <span className="text-xs text-[var(--dpf-muted)]">
          A draft is a proposal; publishing is what makes your verdict count.
        </span>
      </div>
    </form>
  );
}

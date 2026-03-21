"use client";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
  onPause: () => void;
  isLastStep?: boolean;
  continueDisabled?: boolean;
  continueLabel?: string;
};

export function SetupStepNav({
  onContinue,
  onSkip,
  onPause,
  isLastStep = false,
  continueDisabled = false,
  continueLabel,
}: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <button
        onClick={onPause}
        className="text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        Pause and come back later
      </button>
      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="px-4 py-2 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Skip for now
        </button>
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          className="px-6 py-2 text-sm font-medium text-white bg-[var(--dpf-accent)] rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continueLabel ?? (isLastStep ? "Finish Setup" : "Continue")}
        </button>
      </div>
    </div>
  );
}

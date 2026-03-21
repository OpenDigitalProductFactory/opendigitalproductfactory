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
    <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
      <button
        onClick={onPause}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Pause and come back later
      </button>
      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Skip for now
        </button>
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continueLabel ?? (isLastStep ? "Finish Setup" : "Continue")}
        </button>
      </div>
    </div>
  );
}

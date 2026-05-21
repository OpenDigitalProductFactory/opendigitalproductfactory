"use client"

import { useState, useTransition } from "react"
import { createVoiceConsentRecord } from "@/lib/actions/voice-consent"

interface Props {
  capturedByPrincipalId: string
  onSuccess?: (consentRecordId: string) => void
}

const CONSENT_METHODS = [
  { value: "recorded-statement", label: "Recorded Statement" },
  { value: "signed-document", label: "Signed Document" },
  { value: "witnessed-verbal", label: "Witnessed Verbal" },
] as const

const USE_CASES = [
  { value: "build-studio-gate", label: "Build Studio Gate narration" },
  { value: "decision-perspective", label: "Decision Perspective responses" },
  { value: "general-tts", label: "General TTS output" },
]

export function VoiceConsentForm({ capturedByPrincipalId, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [subjectName, setSubjectName] = useState("")
  const [subjectEmail, setSubjectEmail] = useState("")
  const [consentMethod, setConsentMethod] = useState<"recorded-statement" | "signed-document" | "witnessed-verbal">(
    "recorded-statement"
  )
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([])
  const [expiresAt, setExpiresAt] = useState("")
  const [evidenceRef, setEvidenceRef] = useState("")

  function toggleUseCase(value: string) {
    setSelectedUseCases((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const expiry = new Date(expiresAt)
    if (isNaN(expiry.getTime()) || expiry <= new Date()) {
      setError("Expiry date must be a valid future date.")
      return
    }

    startTransition(async () => {
      try {
        const record = await createVoiceConsentRecord({
          subjectName,
          subjectEmail: subjectEmail || undefined,
          consentMethod,
          authorizedUseCases: selectedUseCases,
          expiresAt: expiry,
          capturedByPrincipalId,
          evidenceRef: evidenceRef || undefined,
        })
        setSuccess(true)
        onSuccess?.(record.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred.")
      }
    })
  }

  if (success) {
    return (
      <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
        Consent record created successfully.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="subjectName">
          Subject Name <span aria-hidden>*</span>
        </label>
        <input
          id="subjectName"
          type="text"
          required
          value={subjectName}
          onChange={(e) => setSubjectName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="subjectEmail">
          Subject Email (optional)
        </label>
        <input
          id="subjectEmail"
          type="email"
          value={subjectEmail}
          onChange={(e) => setSubjectEmail(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="consentMethod">
          Consent Method <span aria-hidden>*</span>
        </label>
        <select
          id="consentMethod"
          value={consentMethod}
          onChange={(e) => setConsentMethod(e.target.value as typeof consentMethod)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {CONSENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Authorized Use Cases</legend>
        <div className="mt-2 space-y-2">
          {USE_CASES.map((uc) => (
            <label key={uc.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedUseCases.includes(uc.value)}
                onChange={() => toggleUseCase(uc.value)}
                className="rounded border-gray-300"
              />
              {uc.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="expiresAt">
          Consent Expiry Date <span aria-hidden>*</span>
        </label>
        <input
          id="expiresAt"
          type="date"
          required
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="evidenceRef">
          Evidence Reference (optional)
        </label>
        <input
          id="evidenceRef"
          type="text"
          value={evidenceRef}
          onChange={(e) => setEvidenceRef(e.target.value)}
          placeholder="e.g. recording URL or document ID"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save Consent Record"}
      </button>
    </form>
  )
}

// EP-WIKI-001 Phase 6a: Decision Perspective Profiles index.
// Route: /wiki/perspectives
//
// Lists all active decision perspective profiles with links to each
// profile's voice configuration page. Entry point for voice admin.

import Link from "next/link"
import { prisma } from "@dpf/db"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Decision Perspectives · Wiki",
}

const KIND_LABELS: Record<string, string> = {
  organization: "Organization",
  platform: "Platform",
  "persona-real": "Real persona",
  "persona-fictional": "Fictional persona",
  "persona-synthetic": "Synthetic persona",
}

const VOICE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ready:      { label: "Voice ready",    className: "bg-green-500/10 text-green-600 border border-green-500/20" },
  training:   { label: "Training…",      className: "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20" },
  failed:     { label: "Training failed", className: "bg-red-500/10 text-red-600 border border-red-500/20" },
  pending:    { label: "Pending",         className: "bg-muted text-muted-foreground" },
}

export default async function PerspectivesIndexPage() {
  const session = await auth()
  if (!session?.user?.id) notFound()

  const profiles = await prisma.decisionPerspectiveProfile.findMany({
    where: { status: "active" },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      profileId: true,
      name: true,
      kind: true,
      voiceEnabled: true,
      voiceProfile: {
        select: { status: true },
      },
    },
  })

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/wiki" className="hover:text-foreground">Wiki</Link>
        <span>/</span>
        <span className="text-foreground font-medium">Decision Perspectives</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          Decision Perspectives
        </h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Active perspective profiles for WWMD/WWTD decision narration. Configure
          a cloned voice for any profile to enable spoken decision rationale.
        </p>
      </header>

      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active perspective profiles found.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {profiles.map((profile) => {
            const voiceStatus = profile.voiceProfile?.status ?? null
            const badge = voiceStatus ? VOICE_STATUS_LABELS[voiceStatus] : null

            return (
              <div key={profile.profileId} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
                    {KIND_LABELS[profile.kind] ?? profile.kind}
                  </span>
                  <span className="font-medium text-sm truncate">{profile.name}</span>
                  {profile.voiceEnabled && voiceStatus === "ready" && (
                    <span className="text-xs text-green-600 shrink-0">● active</span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  {badge && (
                    <span className={`text-xs px-2 py-0.5 rounded ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  <Link
                    href={`/wiki/perspectives/${profile.profileId}/voice`}
                    className="text-sm text-primary hover:underline"
                  >
                    Voice config →
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// apps/web/app/sandbox-restricted/page.tsx
//
// Rewrite target for routes blocked by middleware in sandbox mode.
// Shown when a user navigates to /build, /platform, or /admin inside
// the sandbox preview iframe.

export default function SandboxRestrictedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--dpf-surface-1)]">
      <div className="text-center max-w-md space-y-4 p-8">
        <div className="text-4xl opacity-30">&#128736;</div>
        <h2 className="text-lg font-semibold text-[var(--dpf-text)]">
          Sandbox Preview
        </h2>
        <p className="text-sm text-[var(--dpf-muted)] leading-relaxed">
          This page is not available in the sandbox environment.
          Administration and Build Studio are only accessible from the
          main portal.
        </p>
      </div>
    </div>
  );
}

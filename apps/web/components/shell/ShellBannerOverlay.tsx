export function ShellBannerOverlay({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      aria-label="System notices"
      className="pointer-events-none fixed inset-x-0 top-20 z-[80] flex flex-col items-center gap-2 px-3 pt-3 sm:px-4"
      data-testid="shell-banner-overlay"
    >
      {children}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Declare the shell's initial hydration boundary to the UX route sweep.
 *
 * Server HTML is intentionally pending. The marker clears after React has
 * hydrated the route tree, so the sweep cannot capture a mixture of server
 * markup and client state. Components that start additional initial-load work
 * still own their narrower pending markers.
 */
export function UxInitialLoadBoundary({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <div data-dpf-ux-settle={hydrated ? undefined : "pending"}>
      {children}
    </div>
  );
}

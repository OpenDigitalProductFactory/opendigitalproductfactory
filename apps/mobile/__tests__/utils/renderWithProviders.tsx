import React from "react";
import { render, RenderOptions } from "@testing-library/react-native";

/**
 * Test wrapper that provides all required providers.
 * Add navigation, auth context, or theme providers here as needed.
 */
function AllProviders({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

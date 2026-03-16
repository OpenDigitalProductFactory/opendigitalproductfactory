"use client";

import { useState } from "react";
import { BrandingWizard } from "./BrandingWizard";
import { BrandingQuickEdit } from "./BrandingQuickEdit";

type Props = {
  hasExistingBrand: boolean;
  currentName: string;
  currentLogoUrl: string;
  currentAccent: string;
  currentFont: string;
};

export function BrandingPageClient({ hasExistingBrand, currentName, currentLogoUrl, currentAccent, currentFont }: Props) {
  const [showWizard, setShowWizard] = useState(!hasExistingBrand);

  if (showWizard) {
    return (
      <BrandingWizard
        existingName={hasExistingBrand ? currentName : undefined}
        existingLogoUrl={hasExistingBrand ? currentLogoUrl : undefined}
        existingAccent={hasExistingBrand ? currentAccent : undefined}
        existingFont={hasExistingBrand ? currentFont : undefined}
        onCancel={hasExistingBrand ? () => setShowWizard(false) : undefined}
      />
    );
  }

  return (
    <BrandingQuickEdit
      currentName={currentName}
      currentLogoUrl={currentLogoUrl}
      currentAccent={currentAccent}
      currentFont={currentFont}
      onRerunWizard={() => setShowWizard(true)}
    />
  );
}

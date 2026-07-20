"use client";

import { useEffect, useState } from "react";
import { SetupActionButtons } from "./SetupActionButtons";

/** Renders setup actions only while the setup overlay owns the page. */
export function SetupActionButtonsWrapper({ isPending }: { isPending: boolean }) {
  const [active, setActive] = useState(false);
  const [isLast, setIsLast] = useState(false);

  useEffect(() => {
    function check() {
      setActive(document.documentElement.hasAttribute("data-setup-active"));
      setIsLast(document.documentElement.getAttribute("data-setup-last-step") === "true");
    }
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-setup-active", "data-setup-last-step"] });
    return () => observer.disconnect();
  }, []);

  if (!active || isPending) return null;
  return <SetupActionButtons isLastStep={isLast} />;
}

"use client";

import { useEffect } from "react";

type Props = {
  frameMaxWidth?: string;
  contentMaxWidth?: string;
  pagePadding?: string;
  bottomGap?: string;
};

type StyleTarget = {
  setProperty: (name: string, value: string) => void;
  removeProperty: (name: string) => void;
};

type QueryRoot = {
  querySelector: (selector: string) => {
    getBoundingClientRect: () => { top: number };
  } | null;
};

const SHELL_PRESENTATION_KEYS = [
  "--shell-page-frame-max-width",
  "--shell-page-content-max-width",
  "--shell-page-padding",
  "--shell-page-bottom-gap",
  "--shell-content-top",
] as const;

export function resolveShellContentTop(root: QueryRoot): string {
  const shellContent = root.querySelector("[data-shell-content='true']");
  const top = shellContent?.getBoundingClientRect().top;

  return typeof top === "number" && Number.isFinite(top)
    ? `${Math.round(top)}px`
    : "16px";
}

export function applyShellPresentationMode(
  style: StyleTarget,
  {
    frameMaxWidth,
    contentMaxWidth,
    pagePadding,
    bottomGap,
    contentTop,
  }: Props & { contentTop: string },
) {
  if (frameMaxWidth) {
    style.setProperty("--shell-page-frame-max-width", frameMaxWidth);
  }
  if (contentMaxWidth) {
    style.setProperty("--shell-page-content-max-width", contentMaxWidth);
  }
  if (pagePadding) {
    style.setProperty("--shell-page-padding", pagePadding);
  }
  if (bottomGap) {
    style.setProperty("--shell-page-bottom-gap", bottomGap);
  }

  style.setProperty("--shell-content-top", contentTop);
}

export function clearShellPresentationMode(style: StyleTarget) {
  SHELL_PRESENTATION_KEYS.forEach((key) => style.removeProperty(key));
}

export function ShellPresentationMode({
  frameMaxWidth,
  contentMaxWidth,
  pagePadding,
  bottomGap,
}: Props) {
  useEffect(() => {
    function syncPresentationMode() {
      applyShellPresentationMode(document.documentElement.style, {
        frameMaxWidth,
        contentMaxWidth,
        pagePadding,
        bottomGap,
        contentTop: resolveShellContentTop(document),
      });
    }

    syncPresentationMode();
    window.addEventListener("resize", syncPresentationMode);

    return () => {
      window.removeEventListener("resize", syncPresentationMode);
      clearShellPresentationMode(document.documentElement.style);
    };
  }, [bottomGap, contentMaxWidth, frameMaxWidth, pagePadding]);

  return null;
}

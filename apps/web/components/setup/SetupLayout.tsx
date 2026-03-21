"use client";

import { type ReactNode } from "react";

type Props = {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
};

export function SetupLayout({ leftPanel, rightPanel }: Props) {
  return (
    <div className="flex h-[calc(100vh-52px)]">
      <div className="flex-1 overflow-y-auto min-w-0">
        {leftPanel}
      </div>
      <div className="w-[350px] flex-shrink-0">
        {rightPanel}
      </div>
    </div>
  );
}

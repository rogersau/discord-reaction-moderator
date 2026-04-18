import type { ReactNode } from "react";

import { Label } from "./ui/label";

export function EditorPanel({ children }: { children: ReactNode }) {
  return <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">{children}</div>;
}

export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function EditorActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">{children}</div>;
}

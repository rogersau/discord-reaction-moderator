import type { ReactNode } from "react";

import { Card, CardContent } from "./ui/card";
import { ServerIcon } from "./ui/icons";

export function NoGuildSelected({
  feature,
  description,
}: {
  feature: string;
  description?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground">
          <ServerIcon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No server selected</p>
          <p className="mx-auto max-w-sm text-xs text-muted-foreground">
            {description ?? `Pick a server from the sidebar to load its ${feature}.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

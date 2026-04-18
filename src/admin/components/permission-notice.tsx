import { Alert, AlertDescription } from "./ui/alert";

export function PermissionNotice({
  description,
  checks,
}: {
  description: string;
  checks: string[];
}) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/10">
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Permission watch</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {checks.map((check) => (
            <span
              key={check}
              className="rounded-md border border-amber-500/30 bg-background/60 px-2.5 py-1 text-xs font-medium text-amber-100"
            >
              {check}
            </span>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

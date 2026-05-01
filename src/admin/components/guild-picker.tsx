import { useMemo, useState } from "react";

import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ChevronDownIcon, SearchIcon } from "./ui/icons";

interface GuildPickerProps {
  id: string;
  value: string;
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  loadError: string | null;
  onChange: (nextGuildId: string) => void;
}

export function GuildPicker({ id, value, guildDirectory, loadError, onChange }: GuildPickerProps) {
  const [query, setQuery] = useState("");

  const filteredGuilds = useMemo(() => {
    if (!guildDirectory) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return guildDirectory;
    }

    return guildDirectory.filter((guild) => guild.label.toLowerCase().includes(normalizedQuery));
  }, [guildDirectory, query]);

  if (loadError) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>Guild ID</Label>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter a guild ID"
        />
        <p className="text-xs text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-query`}>Server</Label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-query`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter servers"
            disabled={!guildDirectory}
            className="pl-9"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={id}>Server</Label>
        <div className="relative">
          <select
            id={id}
            className="flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={!guildDirectory}
          >
            <option value="">{guildDirectory ? "— select a server —" : "Loading servers…"}</option>
            {filteredGuilds.map((guild) => (
              <option key={guild.guildId} value={guild.guildId}>
                {guild.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

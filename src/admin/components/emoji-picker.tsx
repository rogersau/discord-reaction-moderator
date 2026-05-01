import { useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { Input } from "./ui/input";
import { SearchIcon } from "./ui/icons";

export interface GuildEmojiResource {
  id: string;
  name: string;
  animated: boolean;
  available: boolean;
}

interface EmojiPickerProps {
  emojis: GuildEmojiResource[];
  loading?: boolean;
  selectedName?: string;
  onSelect: (emoji: GuildEmojiResource) => void;
}

export function EmojiPicker({ emojis, loading, selectedName, onSelect }: EmojiPickerProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const available = emojis.filter((emoji) => emoji.available);
    if (!term) return available;
    return available.filter((emoji) => emoji.name.toLowerCase().includes(term));
  }, [emojis, filter]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder="Search server emojis…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div
        className={cn(
          "max-h-48 overflow-y-auto rounded-md border bg-muted/20 p-2",
          (loading || filtered.length === 0) && "flex min-h-[5rem] items-center justify-center"
        )}
      >
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading server emojis…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {emojis.length === 0
              ? "This server has no custom emojis."
              : "No emojis match your search."}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
            {filtered.map((emoji) => {
              const isSelected = emoji.name === selectedName;
              const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=64&quality=lossless`;
              return (
                <button
                  key={emoji.id}
                  type="button"
                  title={`:${emoji.name}:`}
                  aria-label={emoji.name}
                  onClick={() => onSelect(emoji)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md border border-transparent transition-colors hover:border-border hover:bg-background",
                    isSelected && "border-primary bg-primary/15"
                  )}
                >
                  <img
                    src={url}
                    alt={emoji.name}
                    className="h-6 w-6 object-contain"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

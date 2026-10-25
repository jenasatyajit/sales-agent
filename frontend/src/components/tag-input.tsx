"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * Chip-list input: type + Enter to add, × to remove, Backspace removes the last chip.
 * Used for status-quo stack, hidden pains and switching objections.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 border bg-muted px-1.5 py-0.5 text-xs"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onChange(value.filter((item) => item !== tag))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}

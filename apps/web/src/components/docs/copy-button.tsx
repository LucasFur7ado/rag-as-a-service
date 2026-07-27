"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copies `text` to the clipboard, flashing a check for confirmation. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently no-op.
    }
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      className={cn("size-7 text-muted-foreground hover:text-foreground", className)}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </Button>
  );
}

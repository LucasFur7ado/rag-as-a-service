"use client";

import { useState } from "react";
import { CalendarIcon, RefreshCwIcon } from "lucide-react";
import type { Collection } from "@rag/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RANGE_PRESETS,
  fromDatetimeLocal,
  rangeLabel,
  toDatetimeLocal,
  type RangePreset,
  type ResolvedRange,
} from "@/lib/analytics-range";

/**
 * Header filter bar (Feature 5, Part C §1): date-range preset picker (24h /
 * 7d / 30d / custom) + collection filter + refresh. Selections are lifted to
 * the page, which persists them in the URL query string.
 */

const ALL_COLLECTIONS = "__all__";

export interface RangeChange {
  preset: RangePreset;
  from?: number;
  to?: number;
}

export function FilterBar({
  range,
  collectionId,
  collections,
  onRangeChange,
  onCollectionChange,
  onRefresh,
}: {
  range: ResolvedRange;
  collectionId?: string;
  collections: Collection[] | null;
  onRangeChange: (next: RangeChange) => void;
  onCollectionChange: (id: string | undefined) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={range.preset}
        onValueChange={(v) => {
          if (!v) return;
          const preset = v as RangePreset;
          // For a preset switch we can resolve immediately; custom is applied
          // from the popover below.
          if (preset !== "custom") onRangeChange({ preset });
          else onRangeChange({ preset: "custom", from: range.from, to: range.to });
        }}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {range.preset === "custom" && (
        <CustomRangePopover range={range} onApply={onRangeChange} />
      )}

      <Select
        value={collectionId ?? ALL_COLLECTIONS}
        onValueChange={(v) =>
          onCollectionChange(v && v !== ALL_COLLECTIONS ? v : undefined)
        }
      >
        <SelectTrigger size="sm" className="w-[190px]">
          <SelectValue placeholder="All collections" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_COLLECTIONS}>All collections</SelectItem>
          {(collections ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        aria-label="Refresh"
        className="ml-auto"
      >
        <RefreshCwIcon data-icon="inline-start" />
        Refresh
      </Button>
    </div>
  );
}

function CustomRangePopover({
  range,
  onApply,
}: {
  range: ResolvedRange;
  onApply: (next: RangeChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => toDatetimeLocal(range.from));
  const [to, setTo] = useState(() => toDatetimeLocal(range.to));

  const apply = () => {
    const fromMs = fromDatetimeLocal(from);
    const toMs = fromDatetimeLocal(to);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs) {
      onApply({ preset: "custom", from: fromMs, to: toMs });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <CalendarIcon data-icon="inline-start" />
            {rangeLabel(range)}
          </Button>
        }
      />
      <PopoverContent className="w-72" align="start">
        <div className="grid gap-2">
          <label className="text-xs font-medium">From</label>
          <Input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8"
          />
          <label className="mt-1 text-xs font-medium">To</label>
          <Input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8"
          />
          <Button size="sm" className="mt-1" onClick={apply}>
            Apply range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

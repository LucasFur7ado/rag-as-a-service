"use client";

import type { ReactNode } from "react";
import { InboxIcon, TriangleAlertIcon } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsResourceState } from "@/lib/use-analytics";
import { cn } from "@/lib/utils";

/**
 * Shared widget shell for the analytics dashboard (Feature 5). Every widget
 * gets consistent chrome plus the three non-data states the visual bar
 * requires: a SKELETON while loading (never a spinner), a designed EMPTY
 * state, and a readable error — each isolated to the widget so one slow or
 * failing query never blanks the page.
 */

interface WidgetProps<T> {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Header-right slot (e.g. a legend or filter). */
  action?: ReactNode;
  state: AnalyticsResourceState<T>;
  /** True when `data` is present but has nothing to show. */
  isEmpty?: (data: T) => boolean;
  /** Empty-state copy; a CTA can be passed as the second line. */
  emptyMessage?: string;
  emptyHint?: ReactNode;
  /** Skeleton shown while loading; defaults to a block matching the body. */
  skeleton?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: (data: T) => ReactNode;
}

export function Widget<T>({
  title,
  description,
  icon,
  action,
  state,
  isEmpty,
  emptyMessage = "No data for this range",
  emptyHint,
  skeleton,
  className,
  contentClassName,
  children,
}: WidgetProps<T>) {
  const { data, loading, error } = state;
  const empty = data != null && (isEmpty?.(data) ?? false);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn("flex-1", contentClassName)}>
        {loading ? (
          (skeleton ?? <Skeleton className="h-40 w-full" />)
        ) : error ? (
          <WidgetError message={error} />
        ) : empty || data == null ? (
          <WidgetEmpty message={emptyMessage} hint={emptyHint} />
        ) : (
          children(data)
        )}
      </CardContent>
    </Card>
  );
}

export function WidgetError({ message }: { message: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <TriangleAlertIcon className="size-6 text-destructive" />
      <p className="text-sm font-medium">Couldn&apos;t load this widget</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function WidgetEmpty({
  message,
  hint,
}: {
  message: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <InboxIcon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{message}</p>
      {hint && <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

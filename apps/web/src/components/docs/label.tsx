import { cn } from "@/lib/utils";

/** Small form label used in the Try-it console. */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1 block text-xs font-medium text-foreground", className)}
      {...props}
    />
  );
}

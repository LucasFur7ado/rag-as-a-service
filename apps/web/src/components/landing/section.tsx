import { cn } from "@/lib/utils";

/**
 * Layout primitives shared by every marketing section.
 *
 * Each section is a labelled landmark (`aria-labelledby` points at its own
 * heading) so assistive tech can jump between them, and carries `scroll-mt` so
 * in-page anchors land below the sticky site header.
 */
export function Section({
  id,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { id: string }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-14 border-t py-16 sm:py-24", className)}
      {...props}
    >
      <div className="mx-auto w-full max-w-5xl px-4">{children}</div>
    </section>
  );
}

/** Eyebrow + heading + lead paragraph. `id` must match the parent `Section`. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  id: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-3",
        align === "center" ? "mx-auto items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </span>
      ) : null}
      <h2
        id={`${id}-heading`}
        className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
      >
        {title}
      </h2>
      {description ? (
        <p className="text-base text-pretty text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

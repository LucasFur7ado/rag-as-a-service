"use client";

import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Dark/light switch.
 *
 * Both icons are always rendered and swapped with the `dark:` variant rather
 * than with `resolvedTheme`, so the markup is identical on the server and on
 * the first client render — no hydration mismatch and no post-mount icon flip.
 * Only the click handler reads the resolved theme, which by then is accurate.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="hidden dark:block" />
      <MoonIcon className="block dark:hidden" />
    </Button>
  );
}

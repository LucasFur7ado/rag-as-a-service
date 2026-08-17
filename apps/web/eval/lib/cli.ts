/**
 * Argument parsing for the harness scripts.
 *
 * Hand-rolled rather than a dependency: the surface is a handful of flags, and
 * `pnpm eval:run -- --config a --config b` needs repeatable options, which is
 * the only thing here that is not entirely obvious.
 */

export interface ParsedArgs {
  /** Repeatable options, in the order given. */
  list: (name: string) => string[];
  /** Last value wins for single-valued options. */
  value: (name: string, fallback?: string) => string | undefined;
  /** Presence of a boolean flag. */
  flag: (name: string) => boolean;
  /** Positional arguments, in order. */
  positional: string[];
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalsAt = body.indexOf("=");
    if (equalsAt !== -1) {
      push(options, body.slice(0, equalsAt), body.slice(equalsAt + 1));
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      push(options, body, next);
      i++;
    } else {
      flags.add(body);
    }
  }

  return {
    list: (name) => options.get(name) ?? [],
    value: (name, fallback) => options.get(name)?.at(-1) ?? fallback,
    flag: (name) => flags.has(name) || options.has(name),
    positional,
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** Print an error the way a CLI should — no stack trace for a usage mistake. */
export function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  ✗ ${message.split("\n").join("\n    ")}\n`);
  process.exit(1);
}

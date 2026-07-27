"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { deref, type JsonSchema } from "@/lib/openapi";
import { cn } from "@/lib/utils";

/** A compact type label for a schema (resolves refs, arrays, enums, null). */
function typeLabel(schema: JsonSchema): string {
  if (schema.$ref) return deref(schema).name ?? "object";
  if (schema.enum) return schema.enum.map((e) => JSON.stringify(e)).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nonNull = types.filter((t) => t !== "null");
  let label: string;
  if (nonNull.includes("array") || schema.items) {
    const { name, schema: item } = deref(schema.items);
    label = `${name ?? (item ? typeLabel(item) : "any")}[]`;
  } else if (nonNull.length) {
    label = nonNull.join(" | ");
  } else {
    label = schema.properties ? "object" : "any";
  }
  if (types.includes("null")) label += " | null";
  return label;
}

/** Does this schema (deref'd) expand into nested fields? */
function expandable(schema: JsonSchema): JsonSchema | null {
  const { schema: s } = deref(schema);
  if (!s) return null;
  if (s.properties) return s;
  if (s.items) {
    const { schema: item } = deref(s.items);
    if (item?.properties) return item;
  }
  return null;
}

function FieldRow({
  name,
  schema,
  required,
  depth,
}: {
  name: string;
  schema: JsonSchema;
  required: boolean;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  const child = expandable(schema);
  const { schema: resolved } = deref(schema);
  const description = schema.description ?? resolved?.description;
  const example = schema.example ?? resolved?.example;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
        {child ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 font-mono text-sm font-medium text-foreground hover:underline"
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            {name}
          </button>
        ) : (
          <span className="font-mono text-sm font-medium text-foreground">{name}</span>
        )}
        <span className="font-mono text-xs text-chart-embed">{typeLabel(schema)}</span>
        {required ? (
          <span className="text-[10px] font-semibold uppercase text-chart-error">required</span>
        ) : (
          <span className="text-[10px] uppercase text-muted-foreground">optional</span>
        )}
        {description ? (
          <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{description}</span>
        ) : null}
        {example !== undefined && !child ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            e.g. {JSON.stringify(example)}
          </span>
        ) : null}
      </div>
      {child && open ? (
        <div className="ml-4 border-l pl-3">
          <SchemaFields schema={child} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  );
}

function SchemaFields({ schema, depth }: { schema: JsonSchema; depth: number }) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(props);
  if (entries.length === 0) {
    return <p className="py-1 text-xs text-muted-foreground">No properties.</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {entries.map(([name, prop]) => (
        <FieldRow key={name} name={name} schema={prop} required={required.has(name)} depth={depth} />
      ))}
    </div>
  );
}

/**
 * Render a JSON schema as an expandable field list. Resolves `$ref`s and nests
 * objects/arrays behind collapsible rows. Used for request bodies and responses.
 */
export function SchemaViewer({ schema }: { schema?: JsonSchema }) {
  const { name, schema: s } = deref(schema);
  if (!s) return <p className="text-xs text-muted-foreground">No schema.</p>;

  if (s.properties) return <SchemaFields schema={s} depth={0} />;

  // Non-object (string/binary/array-of-scalars/etc.) — a one-line summary.
  return (
    <p className="font-mono text-sm">
      {name ? <span className="text-foreground">{name} </span> : null}
      <span className="text-chart-embed">{typeLabel(s)}</span>
      {s.description ? (
        <span className="ml-2 font-sans text-xs text-muted-foreground">{s.description}</span>
      ) : null}
    </p>
  );
}

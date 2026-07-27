"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "./copy-button";

/** One build-time highlighted sample: rendered HTML + the raw source to copy. */
export interface HighlightedSample {
  html: string;
  raw: string;
}

export interface EndpointSamples {
  curl: HighlightedSample;
  ts: HighlightedSample;
  python: HighlightedSample;
}

const LANGS: Array<{ key: keyof EndpointSamples; label: string }> = [
  { key: "curl", label: "curl" },
  { key: "ts", label: "TypeScript" },
  { key: "python", label: "Python" },
];

/** Language-tabbed code samples with a copy button per language. */
export function CodeSamplesTabs({ samples }: { samples: EndpointSamples }) {
  return (
    <Tabs defaultValue="curl" className="overflow-hidden rounded-lg border bg-muted/40">
      <TabsList variant="line" className="w-full justify-start border-b bg-muted/60 px-2">
        {LANGS.map((l) => (
          <TabsTrigger key={l.key} value={l.key}>
            {l.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {LANGS.map((l) => (
        <TabsContent key={l.key} value={l.key} className="relative">
          <div
            className="overflow-x-auto p-4 text-sm [&_pre]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: samples[l.key].html }}
          />
          <CopyButton text={samples[l.key].raw} className="absolute right-2 top-2" />
        </TabsContent>
      ))}
    </Tabs>
  );
}

import type { Metadata } from "next";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

export const metadata: Metadata = {
  title: "Docs — RAG as a Service",
  description: "Developer documentation for the RAG as a Service API.",
};

/**
 * Docs shell: a sticky nav rail (left), the page content (center), and — on
 * prose pages — an in-page table of contents (right, added per page). Publicly
 * accessible: there is no auth gate, so prospective users can read signed out.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl gap-8 px-4 py-8 lg:py-10">
      <DocsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

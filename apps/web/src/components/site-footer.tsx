import Link from "next/link";
import { OPENAPI_JSON_URL, REPO_URL } from "@/lib/docs-config";

/**
 * Site footer for the public marketing surface.
 *
 * Only destinations that actually resolve are listed — every href here maps to
 * a real route, landing-page anchor or configured external URL. Add entries
 * back as the corresponding pages ship, not before. Anything pointing off-site
 * opens in a new tab.
 */

interface FooterLink {
  label: string;
  href: string;
  /** External destinations render as a plain anchor, not a routed <Link>. */
  external?: boolean;
}

interface FooterColumn {
  id: string;
  title: string;
  links: FooterLink[];
}

const COLUMNS: FooterColumn[] = [
  {
    id: "product",
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Use cases", href: "/#use-cases" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Playground", href: "/dashboard/collections/playground" },
    ],
  },
  {
    id: "developers",
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Quickstart", href: "/docs#quickstart" },
      { label: "API reference", href: "/docs/reference" },
      { label: "Authentication", href: "/docs/authentication" },
      { label: "Rate limits", href: "/docs/rate-limits" },
      { label: "Errors", href: "/docs/errors" },
      { label: "OpenAPI spec", href: OPENAPI_JSON_URL, external: true },
    ],
  },
  {
    id: "resources",
    title: "Resources",
    links: [
      { label: "Ingestion guide", href: "/docs/guides/ingestion" },
    ],
  },
];

function FooterAnchor({ link }: { link: FooterLink }) {
  const className =
    "text-sm text-muted-foreground transition-colors hover:text-foreground";

  if (link.external) {
    return (
      <a href={link.href} className={className} target="_blank" rel="noreferrer">
        {link.label}
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    // `role` is explicit because the page mounts this inside the root layout's
    // <main>, where <footer> would otherwise lose its implicit contentinfo
    // landmark. Drop it if the footer ever moves out to the layout itself.
    <footer role="contentinfo" className="border-t bg-muted/30">
      <div className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* Brand */}
          <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-1">
            <Link href="/" className="w-fit font-semibold">
              RAG<span className="text-muted-foreground">aaS</span>
            </Link>
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              Multi-tenant ingestion, vector search and grounded generation behind
              a single API. Bring your documents; we handle the retrieval.
            </p>
          </div>

          {/* Link columns */}
          {COLUMNS.map((column) => (
            <nav
              key={column.id}
              aria-labelledby={`footer-${column.id}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`footer-${column.id}`} className="text-sm font-medium">
                {column.title}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} RAG as a Service
          </p>
        </div>
      </div>
    </footer>
  );
}

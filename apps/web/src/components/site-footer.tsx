import Link from "next/link";
import { OPENAPI_JSON_URL, REPO_URL } from "@/lib/docs-config";

/**
 * Site footer for the public marketing surface.
 *
 * Several destinations below are not built yet (blog, changelog, legal pages,
 * …). They are linked anyway so the information architecture is settled and the
 * pages can be filled in without touching this file — until then they 404.
 * Anything pointing off-site opens in a new tab.
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
      { label: "Changelog", href: "/changelog" },
      { label: "Roadmap", href: "/roadmap" },
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
      { label: "Blog", href: "/blog" },
      { label: "Community", href: "/community" },
      { label: "Support", href: "/support" },
      { label: "System status", href: "/status" },
      { label: "Source on GitHub", href: REPO_URL, external: true },
    ],
  },
  {
    id: "company",
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Customers", href: "/customers" },
      { label: "Partners", href: "/partners" },
      { label: "Security", href: "/security" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

const LEGAL: FooterLink[] = [
  { label: "Privacy", href: "/legal/privacy" },
  { label: "Terms", href: "/legal/terms" },
  { label: "Cookies", href: "/legal/cookies" },
  { label: "DPA", href: "/legal/dpa" },
  { label: "Sub-processors", href: "/legal/subprocessors" },
];

const SOCIAL: Array<{ label: string; href: string; path: string }> = [
  {
    label: "GitHub",
    href: REPO_URL,
    path: "M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.23c-3.34.72-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z",
  },
  {
    label: "X",
    href: "https://x.com",
    path: "M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.22-6.82-5.96 6.82H1.67l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z",
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com",
    path: "M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM2.4 21.5h5.16V9.75H2.4V21.5Zm7.9-11.75h4.95v1.6h.07c.69-1.24 2.37-2.05 4.06-2.05 4.34 0 5.14 2.68 5.14 6.16v6.04h-5.15v-5.36c0-1.28-.02-2.93-1.84-2.93-1.85 0-2.13 1.4-2.13 2.84v5.45H10.3V9.75Z",
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
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          {/* Brand */}
          <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-1">
            <Link href="/" className="w-fit font-semibold">
              RAG<span className="text-muted-foreground">aaS</span>
            </Link>
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              Multi-tenant ingestion, vector search and grounded generation behind
              a single API. Bring your documents; we handle the retrieval.
            </p>
            <ul className="flex items-center gap-2">
              {SOCIAL.map((social) => (
                <li key={social.label}>
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={social.label}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                      className="size-4"
                    >
                      <path d={social.path} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
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
        <div className="mt-12 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} RAG as a Service
            </p>
            <Link
              href="/status"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-chart-success"
              />
              All systems operational
            </Link>
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {LEGAL.map((link) => (
              <li key={link.href}>
                <FooterAnchor link={link} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

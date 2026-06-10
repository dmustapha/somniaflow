"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SiteNavProps {
  right?: React.ReactNode;
}

const NAV_LINKS = [
  { href: "/",           label: "Home"      },
  { href: "/pipeline/1", label: "Live Demo" },
  { href: "/compose",    label: "Compose"   },
  { href: "/proof",      label: "Proof"     },
];

function isComposePath(href: string, pathname: string) {
  if (href === "/compose") return pathname.startsWith("/compose");
  return false;
}

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href.startsWith("/pipeline")) return pathname.startsWith("/pipeline");
  if (isComposePath(href, pathname)) return true;
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteNav({ right }: SiteNavProps) {
  const pathname = usePathname();

  return (
    <header className="sf-header">
      <div style={{
        maxWidth: "1200px", margin: "0 auto",
        padding: "13px 36px",
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <Link href="/" style={{ textDecoration: "none", flexShrink: 0, display: "flex", alignItems: "center" }}>
          <img src="/logo-v3.svg" alt="SomniaFlow" height={32} style={{ display: "block" }} />
        </Link>
        <span style={{ width: "1px", height: "14px", background: "var(--border)", flexShrink: 0 }} />
        <nav style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                fontSize: "13px",
                letterSpacing: "0.03em",
                color: isActive(href, pathname) ? "var(--brand)" : "var(--text-lo)",
                fontWeight: 400,
                fontFamily: "var(--font-sans)",
                textDecoration: "none",
                transition: "color 0.2s",
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        {right && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
            {right}
          </div>
        )}
      </div>
    </header>
  );
}

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

function NavIcon({ name }: { name: string }) {
  const cls = "w-[16px] h-[16px] shrink-0";
  switch (name) {
    case "Dashboard":
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
          <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
        </svg>
      );
    case "Wallet":
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
          <path d="M1.5 6.5h13" />
          <circle cx="11" cy="9" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case "Trades":
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12V4m0 0L2.5 6.5M5 4l2.5 2.5M11 4v8m0 0l2.5-2.5M11 12l-2.5-2.5" />
        </svg>
      );
    case "Markets":
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="5" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" strokeLinecap="round" />
        </svg>
      );
    case "Settings":
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M1.5 4h3m4 0h6M1.5 8h6m4 0h3M1.5 12h4.5m4 0h4.5" />
          <circle cx="6" cy="4" r="1.25" />
          <circle cx="10" cy="8" r="1.25" />
          <circle cx="7.5" cy="12" r="1.25" />
        </svg>
      );
    default:
      return null;
  }
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/wallet", label: "Wallet" },
  { href: "/trades", label: "Trades" },
  { href: "/markets", label: "Markets" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated, isReady, logout } = useAuth();

  // Don't show sidebar on login/onboarding
  if (pathname === "/login" || pathname?.startsWith("/onboarding")) {
    return null;
  }

  if (!isReady || !isAuthenticated) return null;

  const handleLogout = async () => {
    await logout();
    window.location.href = "/login";
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#111]/90 border border-[#1F1F1F] text-gray-400 hover:text-white transition-colors"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 left-0 z-40 h-screen w-56
        border-r border-[#1A1A1A]
        flex flex-col
        transition-transform lg:translate-x-0
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
      `}
        style={{ background: 'linear-gradient(180deg, #0D0D0D 0%, #0A0A0A 100%)' }}
      >
        {/* Logo */}
        <div className="px-5 pt-6 pb-4">
          <Link href="/dashboard" className="block logo-glow">
            <span
              className="inline-block text-[22px] font-display uppercase tracking-wide"
              style={{
                background: 'linear-gradient(180deg, #FFD43B 0%, #F0B90B 50%, #C99700 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              PROPHIT
            </span>
          </Link>
          <p className="text-[8px] text-[#444] mt-1.5 uppercase tracking-[0.35em] font-medium">Arbitrage Engine</p>
        </div>

        <div className="h-px mx-4 bg-gradient-to-r from-[#F0B90B]/15 via-[#F0B90B]/08 to-transparent" />

        {/* Nav */}
        <nav className="flex-1 px-3 mt-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`
                  nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-200
                  ${isActive
                    ? "nav-item-active bg-[#F0B90B]/8 text-[#F0B90B]"
                    : "text-[#555] hover:text-[#999] hover:bg-white/[0.02]"
                  }
                `}
              >
                <NavIcon name={item.label} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="px-4 py-4 border-t border-[#1A1A1A]">
          <button
            onClick={handleLogout}
            className="w-full text-[11px] px-3 py-2 rounded-lg text-[#444] hover:text-[#888] hover:bg-white/[0.02] transition-colors text-left uppercase tracking-wider"
          >
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { hasSession, clearSession } from "../hooks/use-platform-api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "\u25C9" },
  { href: "/wallet", label: "Wallet", icon: "\u25C8" },
  { href: "/trades", label: "Trades", icon: "\u21C4" },
  { href: "/markets", label: "Markets", icon: "\u25EB" },
  { href: "/settings", label: "Settings", icon: "\u2699" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    setAuthenticated(hasSession());
  }, [pathname]);

  // Don't show sidebar on login/onboarding
  if (pathname === "/login" || pathname?.startsWith("/onboarding")) {
    return null;
  }

  if (!authenticated) return null;

  const handleLogout = () => {
    clearSession();
    window.location.href = "/login";
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-gray-900/90 border border-gray-800/60 text-gray-400 hover:text-white transition-colors"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 left-0 z-40 h-screen w-60
        bg-gray-950 border-r border-gray-800/40
        flex flex-col
        transition-transform lg:translate-x-0
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        {/* Logo */}
        <div className="p-6 pb-4">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <span className="text-xl font-bold tracking-tight">
              <span className="text-emerald-400">Pro</span>
              <span className="text-white">phit</span>
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover:animate-pulse" />
          </Link>
          <p className="text-[10px] text-gray-600 mt-1 tracking-widest uppercase">Prediction Market Arb</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all
                  ${isActive
                    ? "bg-emerald-500/10 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.15)]"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/50"
                  }
                `}
              >
                <span className="text-base opacity-70">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-gray-800/40">
          <button
            onClick={handleLogout}
            className="w-full text-xs px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-900/50 transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}

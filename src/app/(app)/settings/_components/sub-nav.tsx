"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", label: "Workspace" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/engine", label: "Engine" },
  { href: "/settings/pricing", label: "Pricing" },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings sections" className="mb-8 flex gap-5 overflow-x-auto border-b border-border">
      {ITEMS.map((i) => {
        const active = path === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b py-2 text-[13.5px] transition-colors", active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

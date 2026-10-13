/** Navigation model shared by the sidebar, mobile navigation and command palette. */
export type NavItem = { href: string; label: string; icon: string; shortcut?: string; mobile?: boolean; group: "Monitor" | "Decide" | "Analyze" | "Workspace" };

export const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: "house", shortcut: "g o", mobile: true, group: "Monitor" },
  { href: "/data", label: "Data & streams", icon: "database", shortcut: "g d", group: "Monitor" },
  { href: "/monitoring", label: "Monitoring", icon: "pulse", shortcut: "g m", mobile: true, group: "Monitor" },
  { href: "/decisions", label: "Decisions", icon: "scales", shortcut: "g r", mobile: true, group: "Decide" },
  { href: "/lifecycle", label: "Lifecycle", icon: "git", shortcut: "g l", group: "Decide" },
  { href: "/models", label: "Models", icon: "cube", shortcut: "g t", mobile: true, group: "Decide" },
  { href: "/experiments", label: "Experiments", icon: "flask", shortcut: "g e", group: "Analyze" },
  { href: "/audit", label: "Agent & audit", icon: "list", shortcut: "g a", group: "Analyze" },
  { href: "/settings", label: "Settings", icon: "gear", shortcut: "g s", group: "Workspace" },
];

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘ K", label: "Search and run commands" },
  { keys: "b", label: "Process the next batch" },
  { keys: "e", label: "Evaluate update options" },
  { keys: "r", label: "View the recommendation" },
  { keys: "g then o / d / m / r / l / t / e / a / s", label: "Go to a section" },
  { keys: "?", label: "Show keyboard shortcuts" },
];

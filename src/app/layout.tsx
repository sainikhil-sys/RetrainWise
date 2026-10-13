import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/client";
import { AppShell, type ShellRun } from "@/components/shell";
import { getActiveRun, getSettings } from "@/lib/queries";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RetrainWise", template: "%s · RetrainWise" },
  description: "Lifecycle-aware ML decision system: full retraining, incremental update, or defer — decided by evidence and cost.",
};

export const viewport: Viewport = { themeColor: "#0a1220", colorScheme: "dark" };

export const dynamic = "force-dynamic";

async function shellData(): Promise<{ run: ShellRun; autonomy: boolean }> {
  try {
    const [run, settings] = await Promise.all([getActiveRun(), getSettings()]);
    return {
      run: run && {
        id: run.id,
        dataset: run.dataset,
        size: run.size_label,
        position: run.position,
        rows: run.n_rows,
        version: run.active_version,
        spent: run.spent,
        budget: settings.budget,
      },
      autonomy: settings.autonomy,
    };
  } catch {
    // The engine may still be starting (or Python is missing); pages show the detailed error.
    return { run: null, autonomy: false };
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { run, autonomy } = await shellData();
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ToastProvider>
          <AppShell run={run} autonomy={autonomy}>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}

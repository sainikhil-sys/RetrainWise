import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { renderEmail } from "@/lib/email-template";
import { codeEmail } from "@/lib/mail";

export const metadata: Metadata = { title: "Email previews" };
export const dynamic = "force-dynamic";

/** Development-only gallery of every email design, rendered with sample content. Nothing is sent. */
export default function EmailPreviews() {
  if (process.env.NODE_ENV === "production") notFound();
  const samples: { name: string; html: string }[] = [
    { name: "Sign-in code", html: codeEmail("482913", 10).html },
    {
      name: "Work report · batches processed",
      html: renderEmail({
        preheader: "Monitoring suggests evaluating update options.",
        eyebrow: "Work report",
        status: { label: "Attention", tone: "warn" },
        title: "2 batches processed",
        context: "Fraud models",
        paragraphs: ["Monitoring suggests evaluating update options: sustained degradation; avoidable staleness above threshold."],
        facts: [
          ["Batches", "12–13"],
          ["Rows", "6,500–7,500"],
          ["Model", "v004"],
          ["Rolling error", "21.40%"],
          ["Performed by", "you@example.com"],
          ["Time", "15 Oct 2026, 11:42"],
        ],
        cta: { label: "Evaluate update options", url: "http://localhost:3000/decisions" },
        footnote: "Sample content for preview only.",
      }).html,
    },
    {
      name: "Work report · training finished",
      html: renderEmail({
        preheader: "Candidate v006 is ready for review.",
        eyebrow: "Work report",
        status: { label: "Completed", tone: "ok" },
        title: "Training finished: candidate v006 is ready for review",
        context: "Fraud models",
        paragraphs: ["The model was trained on earlier rows and validated on withheld, later rows. It is a candidate: production changes only after an approver promotes it."],
        facts: [
          ["Accuracy", "87.42%"],
          ["Macro F1", "85.10%"],
          ["Change vs production", "+2.31 pts accuracy"],
          ["Validation gate", "passed"],
        ],
        cta: { label: "Review the candidate", url: "http://localhost:3000/models/6" },
        footnote: "Sample content for preview only.",
      }).html,
    },
  ];
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-serif text-[34px]">Email previews</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">Development only. Sample content; nothing is sent.</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {samples.map((s) => (
          <figure key={s.name}>
            <figcaption className="mb-2 text-[13px] font-medium">{s.name}</figcaption>
            <iframe title={s.name} srcDoc={s.html} className="h-[760px] w-full rounded-lg border border-border bg-white" />
          </figure>
        ))}
      </div>
    </main>
  );
}

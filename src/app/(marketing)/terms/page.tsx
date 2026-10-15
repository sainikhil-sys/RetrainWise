import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, DocSection } from "../_components/doc-page";

export const metadata: Metadata = { title: "Terms", description: "Terms for using RetrainWise." };

export default function TermsPage() {
  return (
    <DocPage
      eyebrow="Legal"
      title="Terms of use"
      intro="The short version: RetrainWise is decision support. People stay responsible for what reaches production."
      updated="15 October 2026"
      toc={[
        { id: "use", label: "Using RetrainWise" },
        { id: "accounts", label: "Accounts" },
        { id: "decisions", label: "Decisions and costs" },
        { id: "data", label: "Your data" },
        { id: "acceptable", label: "Acceptable use" },
        { id: "warranty", label: "No warranty" },
        { id: "changes", label: "Changes" },
      ]}
    >
      <DocSection id="use" title="Using RetrainWise">
        <p>You may use RetrainWise to monitor machine-learning models, evaluate and train candidate models, run benchmarks and record approvals, for yourself or your organisation.</p>
      </DocSection>
      <DocSection id="accounts" title="Accounts">
        <p>Sign in only with an email address you control. Keep sign-in codes private. Workspace admins decide who joins and with which role, and are responsible for keeping that list current.</p>
      </DocSection>
      <DocSection id="decisions" title="Decisions and costs">
        <p>
          Recommendations, staleness estimates and agent explanations are estimates based on data and assumptions you configure. Costs shown are simulated unless you supply your own prices. Promoting or rolling back a model is a human decision; you are responsible for validating models before they serve real users.
        </p>
      </DocSection>
      <DocSection id="data" title="Your data">
        <p>
          You keep all rights to your data and models. Datasets downloaded through the product remain subject to their original licences. See <Link href="/privacy">Privacy</Link> for what is stored.
        </p>
      </DocSection>
      <DocSection id="acceptable" title="Acceptable use">
        <p>Do not use RetrainWise to break the law, to process data you have no right to use, to attempt to bypass approval rules or access controls, or to disrupt the service for others.</p>
      </DocSection>
      <DocSection id="warranty" title="No warranty">
        <p>RetrainWise is provided as is, without warranties of any kind. To the extent permitted by law, the authors are not liable for losses arising from its use, including decisions made with its recommendations.</p>
      </DocSection>
      <DocSection id="changes" title="Changes">
        <p>
          These terms may change as the product evolves; the date above shows the latest revision. Questions: <Link href="/contact">contact us</Link>.
        </p>
      </DocSection>
    </DocPage>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, DocSection } from "../_components/doc-page";

export const metadata: Metadata = { title: "Privacy", description: "What RetrainWise stores, why, where it lives and how to remove it." };

export default function PrivacyPage() {
  return (
    <DocPage
      eyebrow="Legal"
      title="Privacy"
      intro="RetrainWise is local-first software. Whoever runs an installation controls its data. This page describes what the software stores and sends."
      updated="15 October 2026"
      toc={[
        { id: "summary", label: "Summary" },
        { id: "collect", label: "What is stored" },
        { id: "use", label: "How it is used" },
        { id: "email", label: "Email" },
        { id: "sharing", label: "Sharing" },
        { id: "retention", label: "Retention & deletion" },
        { id: "security", label: "Security" },
        { id: "contact", label: "Contact" },
      ]}
    >
      <DocSection id="summary" title="Summary">
        <ul>
          <li>Your models, data and decisions stay in the installation that runs RetrainWise.</li>
          <li>We store only what the product needs: your account, workspace membership, activity and audit records.</li>
          <li>No advertising, no tracking pixels, no sale of data.</li>
          <li>Emails are sent only for sign-in codes, invitations, approval requests and the work reports you can switch off.</li>
        </ul>
      </DocSection>
      <DocSection id="collect" title="What is stored">
        <ul>
          <li>
            <strong>Account:</strong> email address, name, job title, company, role, use case, number of models in production and notification preferences.
          </li>
          <li>
            <strong>Sessions:</strong> a session record that expires automatically. Sign-in codes are stored only as a salted hash and expire after 10 minutes.
          </li>
          <li>
            <strong>Workspace data:</strong> settings, team membership, invitations, notifications and the audit trail of actions.
          </li>
          <li>
            <strong>Engine data:</strong> stream telemetry, decisions, model versions with checksums, training jobs and logs, in the installation&apos;s local databases.
          </li>
          <li>
            <strong>Datasets:</strong> public datasets you choose to download, cached locally with their provenance.
          </li>
        </ul>
      </DocSection>
      <DocSection id="use" title="How it is used">
        <p>To sign you in, show the right workspace and permissions, run the features you use, send the emails described below, and keep an audit trail so teams can see who did what. Profile details help teammates recognise you and may tailor defaults; they are not used for marketing.</p>
      </DocSection>
      <DocSection id="email" title="Email">
        <p>
          Emails are delivered through the provider the installation configures (an SMTP server or Resend). The provider processes the recipient address and message content to deliver it. Work reports can be turned off on your Profile page; sign-in codes cannot, as they are how you sign in.
        </p>
      </DocSection>
      <DocSection id="sharing" title="Sharing">
        <p>
          Data is visible to members of the workspace according to their role. Optional integrations send data only when you use them: a language-model endpoint receives the decision evidence you ask it to explain, and dataset downloads contact the dataset&apos;s public source. Nothing else leaves the installation.
        </p>
      </DocSection>
      <DocSection id="retention" title="Retention & deletion">
        <p>
          Sessions and sign-in codes expire automatically. Audit records are append-only by design so that approvals remain verifiable. To delete an account or workspace, contact the administrator of your installation or <Link href="/contact">contact us</Link>.
        </p>
      </DocSection>
      <DocSection id="security" title="Security">
        <p>Passwordless sign-in with single-use codes, expiring database sessions, rate limits, role-based permissions enforced on the server, checksum-verified model artifacts, and audit tables that reject edits and deletions.</p>
      </DocSection>
      <DocSection id="contact" title="Contact">
        <p>
          Questions about privacy: <Link href="/contact">contact us</Link>.
        </p>
      </DocSection>
    </DocPage>
  );
}

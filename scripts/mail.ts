/**
 * Check SMTP settings and send a real test message:
 *   npm run mail:check
 *   npm run mail:test -- you@example.com
 */
import { loadEnvFiles } from "./env";
loadEnvFiles();

import { describeMail, MailError, mailProblems, mailSettingsFromEnv, sendEmail } from "../src/lib/auth/mail";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cfg = mailSettingsFromEnv();
  console.log(`SMTP: ${describeMail(cfg)}`);
  const problems = mailProblems(cfg);
  for (const p of problems) console.log(`  ! ${p}`);
  const idx = argv.indexOf("--test-email");
  if (idx >= 0) {
    const to = argv[idx + 1];
    if (!to) {
      console.log("Usage: npm run mail:test -- you@example.com");
      return 2;
    }
    try {
      await sendEmail({ to, subject: "RetrainWise test email",
        text: "If you can read this, RetrainWise can send verification codes." }, cfg);
    } catch (exc) {
      console.log(`FAILED: ${exc instanceof MailError ? exc.message : String(exc)}`);
      return 1;
    }
    console.log(`Sent to ${to}. If it is not in the inbox within a minute, check the spam/junk folder.`);
    return 0;
  }
  return problems.length ? 1 : 0;
}

main().then((code) => process.exit(code));

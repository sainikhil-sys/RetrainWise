// Walk RetrainWise like a new user: sign up, read the emailed code, verify, start the demo,
// process batches, inspect monitoring, evaluate, approve, run a small benchmark, generate an
// explanation, sign out, reset the password and sign in again.
//   node drive.mjs [run_dir] [app_url]
// Screenshots land in <run_dir>/shots/. Exits non-zero on the first failed step.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const RUN = process.argv[2] || "/tmp/retrainwise-run";
const URL = process.argv[3] || "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = path.join(RUN, "shots");
const EMAIL = `user${Date.now()}@example.com`;
fs.mkdirSync(SHOTS, { recursive: true });

function latestCode() {
  const codes = [...fs.readFileSync(path.join(RUN, "mails.txt"), "utf-8").matchAll(/^\s+(\d{6})\s*$/gm)].map((m) => m[1]);
  if (!codes.length) throw new Error("No code was emailed; check the sign-up screen and next.log");
  return codes.at(-1);
}

const browser = await chromium.launch(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(60_000);
const field = (label) => page.getByLabel(label, { exact: true });
const button = (name) => page.getByRole("button", { name });
const heading = (name) => page.getByRole("heading", { name, exact: true }).waitFor();
const shot = (name) => page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
const step = (msg) => console.log(`✔ ${msg}`);

try {
  await page.goto(URL);
  await heading("Sign in");
  await shot("01_signin.png");
  step("unauthenticated visit redirects to sign in");

  await page.getByRole("link", { name: "Create an account" }).click();
  await field("Name").fill("Test User");
  await field("Email").fill(EMAIL);
  await field("Password").fill("retrain-2026");
  await field("Confirm password").fill("retrain-2026");
  await button("Create account").click();
  await heading("Verify your email");
  await shot("02_verify.png");
  const code = latestCode();
  step(`sign-up emailed code ${code} to ${EMAIL}`);

  await field("Verification code").fill(code);
  await button("Verify email").click();
  await heading("Overview");
  step("verified and signed in");

  await button(/Start offline demo/).click();
  await page.getByText("Active run").waitFor();
  await shot("03_overview_start.png");
  step("demo run started");

  await page.getByRole("link", { name: /Data and simulation/ }).click();
  await heading("Data and simulation");
  await field("Batches to process").fill("9");
  await button(/Process batches/).click();
  await page.getByText(/Processed 9 batch/).waitFor();
  await shot("04_data.png");
  step("processed 9 batches");

  await page.getByRole("link", { name: /Monitoring/ }).click();
  await heading("Monitoring");
  await page.waitForTimeout(1000);
  await shot("05_monitoring.png");
  step("monitoring rendered");

  await page.getByRole("link", { name: /Decision analysis/ }).click();
  await heading("Decision analysis");
  await button(/Evaluate update options/).click();
  await page.getByText(/^Decision [0-9a-f]+: recommend/).waitFor();
  await page.waitForTimeout(1000);
  await shot("06_decision.png");
  step("decision evaluated");

  await page.getByRole("link", { name: /Model lifecycle/ }).click();
  await heading("Model lifecycle");
  await page.getByLabel(/I approve this action/).check();
  await button("Execute approved action").click();
  const outcome = page.getByText(/Latest decision \w+ is (promoted|rejected|deferred|failed)/);
  await outcome.waitFor();
  console.log(`  ${(await outcome.textContent()).replace(/\s+/g, " ").trim()}`);
  await shot("07_lifecycle.png");
  step("approved action executed");

  await page.getByRole("link", { name: /Experiments/ }).click();
  await heading("Experiments");
  await page.locator("select[name=policies]").selectOption(["never", "retrainwise"]);
  await field("Seeds (comma-separated)").fill("1");
  await button("Start benchmark job").click();
  await page.getByText(/^Job [0-9a-f]+ started/).waitFor();
  await page.getByText(/2 runs in/).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1000);
  await shot("08_experiments.png");
  step("benchmark job completed");

  await page.getByRole("link", { name: /Agent and audit/ }).click();
  await heading("Agent and audit");
  await button(/Generate explanation/).click();
  await page.getByText(/^Report #\d+ \(/).waitFor();
  await shot("09_agent.png");
  step("explanation generated");

  await button("Sign out").click();
  await heading("Sign in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await heading("Reset your password");
  await field("Email").fill(EMAIL);
  await button("Send reset code").click();
  await heading("Choose a new password");
  await field("Reset code").fill(latestCode());
  await field("New password").fill("brand-new-2026");
  await field("Confirm new password").fill("brand-new-2026");
  await button("Reset password").click();
  await page.getByText("Password updated").waitFor();
  await field("Password").fill("brand-new-2026");
  await button("Sign in").click();
  await heading("Overview");
  await shot("10_after_reset.png");
  step("password reset and signed in again");
  console.log(`OK - screenshots in ${SHOTS}`);
} catch (exc) {
  await shot("failure.png").catch(() => {});
  console.error(`FAILED: ${exc.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

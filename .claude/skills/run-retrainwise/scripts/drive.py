"""Walk RetrainWise like a new user: sign up, read the emailed code, verify,
open Overview and Model lifecycle, sign out, reset the password, sign in.

    python drive.py [run_dir] [app_url]

Screenshots land in <run_dir>/shots/. Exits non-zero on the first failed step.
"""
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

RUN = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/retrainwise-run")
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8501"
CHROMIUM = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
SHOTS = RUN / "shots"
EMAIL = f"user{int(time.time())}@example.com"


def latest_code() -> str:
    codes = re.findall(r"^\s+(\d{6})\s*$", (RUN / "mails.txt").read_text(), re.M)
    if not codes:
        raise SystemExit("No code was emailed; check the sign-up screen and streamlit.log")
    return codes[-1]


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    launch = {"executable_path": CHROMIUM} if Path(CHROMIUM).exists() else {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1300, "height": 900})
        field = lambda label: page.get_by_label(label, exact=True)  # noqa: E731
        button = lambda name: page.get_by_role("button", name=name)  # noqa: E731
        heading = lambda name: page.get_by_role("heading", name=name).wait_for(timeout=30000)  # noqa: E731

        page.goto(URL)
        heading("Sign in")
        page.screenshot(path=SHOTS / "1_signin.png")

        button("Create an account").click()
        field("Name").fill("Test User")
        field("Email").fill(EMAIL)
        field("Password").fill("retrain-2026")
        field("Confirm password").fill("retrain-2026")
        button("Create account").click()
        heading("Verify your email")
        page.screenshot(path=SHOTS / "2_verify.png")
        code = latest_code()
        print(f"sign-up: code {code} emailed to {EMAIL}")

        field("Verification code").fill(code)
        button("Verify email").click()
        page.get_by_text("Signed in as").wait_for(timeout=30000)
        page.wait_for_timeout(2000)
        page.screenshot(path=SHOTS / "3_overview.png")
        print("verify: signed in")

        page.get_by_text("Model lifecycle").click()
        page.get_by_role("heading", name="Model lifecycle").wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        page.screenshot(path=SHOTS / "4_lifecycle.png", full_page=True)

        button("Sign out").click()
        button("Forgot password?").click()
        field("Email").fill(EMAIL)
        button("Send reset code").click()
        heading("Choose a new password")
        field("Reset code").fill(latest_code())
        field("New password").fill("brand-new-2026")
        field("Confirm new password").fill("brand-new-2026")
        button("Reset password").click()
        page.get_by_text("Password updated").wait_for(timeout=30000)
        field("Email").fill(EMAIL)
        field("Password").fill("brand-new-2026")
        button("Sign in").click()
        page.get_by_text("Signed in as").wait_for(timeout=30000)
        page.screenshot(path=SHOTS / "5_after_reset.png")
        print("reset: signed in with the new password")
        browser.close()
    print(f"OK - screenshots in {SHOTS}")


if __name__ == "__main__":
    main()

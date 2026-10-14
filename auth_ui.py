"""Streamlit screens for sign in, sign up, email verification and password reset.

``require_login(auth)`` returns the signed-in user, or renders the auth screens
and stops the script so no application page is reachable without an account.
"""
from __future__ import annotations

import streamlit as st

from auth import Auth, AuthError, CodeDelivery, MailError, MailNotConfigured, UnverifiedEmail

VIEW, EMAIL, USER = "auth_view", "auth_email", "user"


def _go(view: str, email: str | None = None, notice: str | None = None) -> None:
    st.session_state[VIEW] = view
    if email is not None:
        st.session_state[EMAIL] = email
    if notice:
        st.session_state["auth_notice"] = notice
    st.rerun()


def _notice() -> None:
    message = st.session_state.pop("auth_notice", None)
    if message:
        st.success(message)
    dev = st.session_state.get("auth_dev_code")
    if dev and st.session_state.get(VIEW) in ("verify", "reset"):
        st.warning(f"Development mode (SMTP not configured, AUTH_DEV_CODES=1): your code is **{dev}**")


def _delivered(delivery: CodeDelivery | None, email: str) -> str:
    st.session_state["auth_dev_code"] = delivery.dev_code if delivery else None
    if delivery and delivery.dev_code:
        return "Email is not configured, so the code is shown below instead of being emailed."
    return (f"We sent a 6-digit code to {email}. It can take a minute to arrive; "
            f"check your spam/junk folder if you do not see it.")


def _mail_error(exc: MailError) -> None:
    st.error(f"We could not send the email. {exc}")
    if isinstance(exc, MailNotConfigured):
        st.info("Administrator: copy `.env.example` to `.env`, fill in the SMTP settings, restart the app, "
                "and run `python auth.py --test-email you@example.com` to confirm delivery.")


def _mail_status(auth: Auth) -> None:
    cfg = auth.mail
    if not cfg.configured:
        st.warning("Email delivery is not configured, so verification and reset codes cannot be sent. "
                   "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in `.env` "
                   "(see `.env.example`)." + (" Development codes are shown on screen instead."
                                              if cfg.dev_codes else ""))
    else:
        for problem in cfg.problems():
            st.caption(f"⚠ Mail configuration: {problem}")


def _sign_in(auth: Auth) -> None:
    with st.form("signin"):
        email = st.text_input("Email", value=st.session_state.get(EMAIL, ""), autocomplete="email")
        password = st.text_input("Password", type="password", autocomplete="current-password")
        submitted = st.form_submit_button("Sign in", type="primary", use_container_width=True)
    if submitted:
        try:
            st.session_state[USER] = auth.login(email, password)
            st.session_state.pop(VIEW, None)
            st.rerun()
        except UnverifiedEmail as exc:
            st.session_state[EMAIL] = email.strip().lower()
            try:
                note = _delivered(auth.send_code(email, "verify"), email.strip().lower())
            except AuthError as wait:      # cooldown: an earlier code is still valid
                note = f"{exc} {wait}"
            except MailError as mail_exc:
                _mail_error(mail_exc)
                return
            _go("verify", notice=note)
        except AuthError as exc:
            st.error(str(exc))
    c1, c2 = st.columns(2)
    if c1.button("Create an account", use_container_width=True):
        _go("signup")
    if c2.button("Forgot password?", use_container_width=True):
        _go("forgot")


def _sign_up(auth: Auth) -> None:
    with st.form("signup"):
        name = st.text_input("Name", autocomplete="name")
        email = st.text_input("Email", autocomplete="email")
        password = st.text_input("Password", type="password", autocomplete="new-password",
                                 help="At least 8 characters, mixing letters with numbers or symbols.")
        confirm = st.text_input("Confirm password", type="password", autocomplete="new-password")
        submitted = st.form_submit_button("Create account", type="primary", use_container_width=True)
    if submitted:
        try:
            delivery = auth.register(name, email, password, confirm)
            _go("verify", email.strip().lower(), _delivered(delivery, email.strip().lower()))
        except MailError as exc:
            st.session_state[EMAIL] = email.strip().lower()
            _mail_error(exc)
            st.caption("Your account was saved. Fix the email settings, then use *Resend code* on the "
                       "verification screen.")
            if st.button("Go to verification"):
                _go("verify")
        except AuthError as exc:
            st.error(str(exc))
    if st.button("I already have an account", use_container_width=True):
        _go("signin")


def _resend(auth: Auth, purpose: str) -> None:
    email = st.session_state.get(EMAIL, "")
    try:
        st.session_state["auth_notice"] = _delivered(auth.send_code(email, purpose), email)
        st.rerun()
    except MailError as exc:
        _mail_error(exc)
    except AuthError as exc:
        st.error(str(exc))


def _verify(auth: Auth) -> None:
    email = st.session_state.get(EMAIL)
    if not email:
        _go("signin")
    st.markdown(f"Enter the 6-digit code sent to **{email}**.")
    with st.form("verify"):
        code = st.text_input("Verification code", max_chars=7, autocomplete="one-time-code")
        submitted = st.form_submit_button("Verify email", type="primary", use_container_width=True)
    if submitted:
        try:
            st.session_state[USER] = auth.verify_email(email, code)
            st.session_state.pop("auth_dev_code", None)
            st.session_state.pop(VIEW, None)
            st.rerun()
        except AuthError as exc:
            st.error(str(exc))
    c1, c2 = st.columns(2)
    if c1.button("Resend code", use_container_width=True):
        _resend(auth, "verify")
    if c2.button("Back to sign in", use_container_width=True):
        _go("signin")


def _forgot(auth: Auth) -> None:
    st.markdown("Enter your account email and we will send you a code to reset your password.")
    with st.form("forgot"):
        email = st.text_input("Email", value=st.session_state.get(EMAIL, ""), autocomplete="email")
        submitted = st.form_submit_button("Send reset code", type="primary", use_container_width=True)
    if submitted:
        try:
            delivery = auth.request_reset(email)
            clean = email.strip().lower()
            note = _delivered(delivery, clean) if delivery else (
                f"If an account exists for {clean}, a reset code is on its way. "
                f"Check your spam/junk folder if you do not see it.")
            _go("reset", clean, note)
        except MailError as exc:
            _mail_error(exc)
        except AuthError as exc:
            st.error(str(exc))
    if st.button("Back to sign in", use_container_width=True):
        _go("signin")


def _reset(auth: Auth) -> None:
    email = st.session_state.get(EMAIL)
    if not email:
        _go("forgot")
    st.markdown(f"Enter the code sent to **{email}** and choose a new password.")
    with st.form("reset"):
        code = st.text_input("Reset code", max_chars=7, autocomplete="one-time-code")
        password = st.text_input("New password", type="password", autocomplete="new-password")
        confirm = st.text_input("Confirm new password", type="password", autocomplete="new-password")
        submitted = st.form_submit_button("Reset password", type="primary", use_container_width=True)
    if submitted:
        try:
            auth.reset_password(email, code, password, confirm)
            st.session_state.pop("auth_dev_code", None)
            _go("signin", notice="Password updated. Sign in with your new password.")
        except AuthError as exc:
            st.error(str(exc))
    c1, c2 = st.columns(2)
    if c1.button("Resend code", use_container_width=True):
        _resend(auth, "reset")
    if c2.button("Back to sign in", use_container_width=True):
        _go("signin")


SCREENS = {"signin": ("Sign in", _sign_in), "signup": ("Create your account", _sign_up),
           "verify": ("Verify your email", _verify), "forgot": ("Reset your password", _forgot),
           "reset": ("Choose a new password", _reset)}


def require_login(auth: Auth) -> dict:
    user = st.session_state.get(USER)
    if user:
        fresh = auth.user(user["email"])
        if fresh and fresh["verified"]:
            st.session_state[USER] = fresh
            return fresh
        st.session_state.pop(USER, None)     # account removed or no longer verified
    view = st.session_state.get(VIEW, "signin")
    title, screen = SCREENS.get(view, SCREENS["signin"])
    _, middle, _ = st.columns([1, 1.4, 1])
    with middle:
        st.markdown("## ♻️ RetrainWise")
        st.markdown(f"### {title}")
        _notice()
        screen(auth)
        _mail_status(auth)
    st.stop()


def account_sidebar(auth: Auth, user: dict) -> None:
    st.markdown(f"Signed in as **{user['name']}**  \n`{user['email']}`")
    with st.expander("Change password"):
        with st.form("change_password", clear_on_submit=True):
            current = st.text_input("Current password", type="password", autocomplete="current-password")
            new = st.text_input("New password", type="password", autocomplete="new-password")
            confirm = st.text_input("Confirm new password", type="password", autocomplete="new-password")
            if st.form_submit_button("Update password"):
                try:
                    auth.change_password(user["email"], current, new, confirm)
                    st.success("Password updated.")
                except AuthError as exc:
                    st.error(str(exc))
    if st.button("Sign out", use_container_width=True):
        for key in (USER, VIEW, "auth_dev_code"):
            st.session_state.pop(key, None)
        st.session_state[EMAIL] = user["email"]
        st.rerun()

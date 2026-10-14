"""Accounts, email verification and password reset for RetrainWise.

Flow: sign up -> 6-digit code emailed -> verify -> sign in. Forgotten passwords
use the same emailed-code mechanism. Passwords are stored as scrypt hashes and
codes as SHA-256 digests; nothing secret is kept in plain text.

Email is sent over SMTP using settings from environment variables or a ``.env``
file in the project folder (see ``.env.example``). Check the configuration
from a terminal with::

    python auth.py --check
    python auth.py --test-email you@example.com

Every send failure is raised as ``MailError`` with a plain-language reason
(wrong port/security mode, rejected login, refused recipient, ...) instead of
being swallowed, so "the email never arrived" always has a visible cause.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import smtplib
import socket
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

from config import ROOT
from database import Database, log, now

AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL,
    last_login TEXT, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT);
CREATE TABLE IF NOT EXISTS auth_codes(
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS auth_codes_lookup ON auth_codes(email, purpose, id);
"""

PURPOSES = ("verify", "reset")
CODE_TTL = timedelta(minutes=10)
CODE_MAX_ATTEMPTS = 5
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_CODES_PER_HOUR = 5
MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=15)
MIN_PASSWORD = 8
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
SCRYPT = dict(n=2 ** 14, r=8, p=1)


class AuthError(ValueError):
    """A user-facing authentication failure (safe to show in the UI)."""


class MailError(RuntimeError):
    """An email could not be handed to the SMTP server; the message says why."""


class MailNotConfigured(MailError):
    pass


# ----------------------------------------------------------------- helpers
def _utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(when: datetime) -> str:
    return when.isoformat(timespec="seconds")


def _parse(text: str | None) -> datetime | None:
    return datetime.fromisoformat(text) if text else None


def normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise AuthError("Enter a valid email address.")
    return email


def check_password_strength(password: str) -> None:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise AuthError(f"Password must be at least {MIN_PASSWORD} characters.")
    if len(password) > 256:
        raise AuthError("Password is too long (max 256 characters).")
    if password.isdigit() or password.isalpha():
        raise AuthError("Password must mix letters with numbers or symbols.")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        test = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                              dklen=len(bytes.fromhex(digest)))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, TypeError):
        return False


def _code_hash(email: str, purpose: str, code: str) -> str:
    return hashlib.sha256(f"{purpose}:{email}:{code}".encode()).hexdigest()


# ----------------------------------------------------------------- mail settings
def load_env_file(path=None) -> None:
    """Read KEY=VALUE lines from ``.env`` without overriding real environment variables."""
    path = path or ROOT / ".env"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip().removeprefix("export ").strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)


@dataclass
class MailSettings:
    host: str = ""
    port: int = 587
    user: str = ""
    password: str = ""
    sender: str = ""
    security: str = "starttls"     # starttls | ssl | none
    timeout: float = 20.0
    dev_codes: bool = False         # show codes in the UI when SMTP is not configured

    @classmethod
    def from_env(cls) -> "MailSettings":
        load_env_file()
        env = os.environ.get
        host = env("SMTP_HOST", "").strip()
        try:
            port = int(env("SMTP_PORT", "") or 0)
        except ValueError:
            port = 0
        security = env("SMTP_SECURITY", "").strip().lower()
        if security not in ("starttls", "ssl", "none"):
            security = "ssl" if port == 465 else "starttls"
        port = port or (465 if security == "ssl" else 587)
        user = env("SMTP_USER", "").strip()
        password = env("SMTP_PASSWORD", "")
        if "gmail" in host or "googlemail" in host:
            password = password.replace(" ", "")   # Google shows App Passwords as 4 groups of 4
        return cls(host=host, port=port, user=user, password=password,
                   sender=env("SMTP_FROM", "").strip() or user, security=security,
                   timeout=float(env("SMTP_TIMEOUT", "20") or 20),
                   dev_codes=env("AUTH_DEV_CODES", "").strip().lower() in ("1", "true", "yes"))

    @property
    def configured(self) -> bool:
        return bool(self.host and self.sender)

    def problems(self) -> list[str]:
        """Configuration mistakes that are known to make mail silently fail."""
        out = []
        if not self.host:
            out.append("SMTP_HOST is not set.")
        if not self.sender:
            out.append("SMTP_FROM (or SMTP_USER) is not set, so there is no sender address.")
        elif "@" not in parseaddr(self.sender)[1]:
            out.append(f"SMTP_FROM {self.sender!r} is not an email address.")
        if self.host and not self.user and self.security != "none":
            out.append("SMTP_USER is empty; almost every provider requires a login.")
        if self.user and not self.password:
            out.append("SMTP_PASSWORD is empty.")
        if self.port == 465 and self.security == "starttls":
            out.append("Port 465 needs SMTP_SECURITY=ssl (STARTTLS uses port 587).")
        if self.port == 587 and self.security == "ssl":
            out.append("Port 587 needs SMTP_SECURITY=starttls (implicit SSL uses port 465).")
        if "gmail" in self.host and self.password and len(self.password) != 16:
            out.append("Gmail needs a 16-character App Password (Google Account > Security > "
                       "2-Step Verification > App passwords), not your normal password.")
        sender_addr = parseaddr(self.sender)[1].lower()
        if ("gmail" in self.host or "office365" in self.host or "outlook" in self.host) and self.user \
                and sender_addr and sender_addr != self.user.lower():
            out.append("SMTP_FROM differs from SMTP_USER; Gmail/Outlook rewrite or reject mail sent "
                       "from an address you have not verified with them.")
        return out

    def describe(self) -> str:
        if not self.configured:
            return "not configured"
        return f"{self.host}:{self.port} ({self.security}) as {self.user or 'anonymous'}, from {self.sender}"


# ----------------------------------------------------------------- mail sending
def _explain(exc: Exception, cfg: MailSettings) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        hint = (" Gmail requires 2-Step Verification and an App Password." if "gmail" in cfg.host else
                " Outlook/Office 365 needs SMTP AUTH enabled for the mailbox." if "office365" in cfg.host
                or "outlook" in cfg.host else "")
        return f"The SMTP server rejected the username/password ({exc.smtp_code}).{hint}"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return f"The server refused the sender address {cfg.sender!r}: {exc.smtp_error!r}."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        reasons = "; ".join(f"{k}: {v[1]!r}" for k, v in exc.recipients.items())
        return f"The server refused the recipient ({reasons})."
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return f"The server does not support this security mode ({cfg.security}); check SMTP_SECURITY/SMTP_PORT."
    if isinstance(exc, ssl.SSLError):
        return (f"TLS handshake failed on port {cfg.port} ({exc}). Use SMTP_SECURITY=ssl with port 465 "
                f"or SMTP_SECURITY=starttls with port 587.")
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return (f"Timed out connecting to {cfg.host}:{cfg.port}. The port may be blocked by a firewall "
                f"or need a different security mode.")
    if isinstance(exc, socket.gaierror):
        return f"Cannot resolve SMTP host {cfg.host!r}; check SMTP_HOST."
    if isinstance(exc, ConnectionRefusedError):
        return f"Connection refused by {cfg.host}:{cfg.port}; check SMTP_PORT."
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return (f"The server closed the connection ({exc}). This usually means a port/security mismatch "
                f"(465 = ssl, 587 = starttls).")
    if isinstance(exc, smtplib.SMTPException):
        return f"SMTP error: {exc}"
    return f"{type(exc).__name__}: {exc}"


def send_email(to: str, subject: str, text: str, html: str | None = None,
               cfg: MailSettings | None = None) -> None:
    """Hand one message to the SMTP server or raise ``MailError`` explaining why not."""
    cfg = cfg or MailSettings.from_env()
    if not cfg.configured:
        raise MailNotConfigured("Email is not configured: " + " ".join(cfg.problems()) +
                                " Copy .env.example to .env and fill in your SMTP settings.")
    msg = EmailMessage()
    name, addr = parseaddr(cfg.sender)
    msg["From"] = formataddr((name or "RetrainWise", addr))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=addr.rsplit("@", 1)[-1] if "@" in addr else None)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    context = ssl.create_default_context()
    try:
        if cfg.security == "ssl":
            server = smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=cfg.timeout, context=context)
        else:
            server = smtplib.SMTP(cfg.host, cfg.port, timeout=cfg.timeout)
        with server:
            server.ehlo()
            if cfg.security == "starttls":
                server.starttls(context=context)
                server.ehlo()
            if cfg.user:
                server.login(cfg.user, cfg.password)
            refused = server.send_message(msg)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    except Exception as exc:
        reason = _explain(exc, cfg)
        log("mail_failed", to=to, subject=subject, reason=reason)
        raise MailError(reason) from exc
    log("mail_sent", to=to, subject=subject)


def _code_email(purpose: str, name: str, code: str) -> tuple[str, str, str]:
    minutes = int(CODE_TTL.total_seconds() // 60)
    if purpose == "verify":
        subject, intro = "Your RetrainWise verification code", "Use this code to verify your email address:"
    else:
        subject, intro = "Your RetrainWise password reset code", "Use this code to reset your password:"
    text = (f"Hi {name or 'there'},\n\n{intro}\n\n    {code}\n\nIt expires in {minutes} minutes. "
            f"If you did not request this, you can ignore this email.\n\n- RetrainWise")
    html = (f"<p>Hi {name or 'there'},</p><p>{intro}</p>"
            f"<p style=\"font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace\">{code}</p>"
            f"<p>It expires in {minutes} minutes. If you did not request this, you can ignore this email.</p>"
            f"<p>- RetrainWise</p>")
    return subject, text, html


# ----------------------------------------------------------------- accounts
@dataclass
class CodeDelivery:
    sent: bool                 # True when the email was accepted by the SMTP server
    dev_code: str | None = None  # only set when AUTH_DEV_CODES is on and SMTP is not configured


class Auth:
    def __init__(self, db: Database, mail: MailSettings | None = None, sender=send_email):
        self.db = db
        self.mail = mail or MailSettings.from_env()
        self._send = sender
        with self.db.transaction() as conn:
            for statement in AUTH_SCHEMA.split(";"):
                if statement.strip():
                    conn.execute(statement)

    # ------------------------------------------------------------- lookups
    def user(self, email: str) -> dict | None:
        return self.db.one("SELECT id, email, name, verified, created, last_login, failed_logins, "
                           "locked_until FROM users WHERE email=?", (email,))

    def _password_hash(self, email: str) -> str | None:
        row = self.db.one("SELECT password_hash FROM users WHERE email=?", (email,))
        return row["password_hash"] if row else None

    # ------------------------------------------------------------- codes
    def send_code(self, email: str, purpose: str) -> CodeDelivery:
        """Create a fresh code (invalidating older ones) and email it."""
        if purpose not in PURPOSES:
            raise ValueError(f"Unknown purpose {purpose!r}")
        email = normalize_email(email)
        user = self.user(email)
        if user is None:
            raise AuthError("No account exists for that email.")
        now_ = _utc()
        recent = self.db.query("SELECT created FROM auth_codes WHERE email=? AND purpose=? AND created>=? "
                               "ORDER BY id DESC", (email, purpose, _iso(now_ - timedelta(hours=1))))
        if recent:
            wait = _parse(recent[0]["created"]) + RESEND_COOLDOWN - now_
            if wait.total_seconds() > 0:
                raise AuthError(f"Please wait {int(wait.total_seconds()) + 1} seconds before requesting another code.")
        if len(recent) >= MAX_CODES_PER_HOUR:
            raise AuthError("Too many codes requested for this email. Try again in an hour.")
        code = f"{secrets.randbelow(1_000_000):06d}"
        subject, text, html = _code_email(purpose, user["name"], code)
        dev = not self.mail.configured and self.mail.dev_codes
        if not dev:
            self._send(email, subject, text, html, cfg=self.mail)   # raises MailError on failure
        with self.db.transaction() as conn:
            conn.execute("UPDATE auth_codes SET used=1 WHERE email=? AND purpose=? AND used=0", (email, purpose))
            conn.execute("INSERT INTO auth_codes(email,purpose,code_hash,created,expires) VALUES(?,?,?,?,?)",
                         (email, purpose, _code_hash(email, purpose, code), _iso(now_), _iso(now_ + CODE_TTL)))
            self.db.event("auth_code_sent", {"email": email, "purpose": purpose, "dev": dev}, conn, actor=email)
        return CodeDelivery(sent=not dev, dev_code=code if dev else None)

    def _consume_code(self, email: str, purpose: str, code: str) -> None:
        code = (code or "").strip().replace(" ", "")
        error = None
        # Record the attempt and commit before raising: an exception inside the
        # transaction would roll back the attempt counter and void the limit.
        with self.db.transaction() as conn:
            row = conn.execute("SELECT id, code_hash, expires, attempts FROM auth_codes WHERE email=? AND "
                               "purpose=? AND used=0 ORDER BY id DESC LIMIT 1", (email, purpose)).fetchone()
            if row is None:
                error = "No active code. Request a new one."
            elif _parse(row["expires"]) < _utc():
                conn.execute("UPDATE auth_codes SET used=1 WHERE id=?", (row["id"],))
                error = "That code has expired. Request a new one."
            elif row["attempts"] >= CODE_MAX_ATTEMPTS:
                conn.execute("UPDATE auth_codes SET used=1 WHERE id=?", (row["id"],))
                error = "Too many wrong attempts. Request a new code."
            elif not hmac.compare_digest(row["code_hash"], _code_hash(email, purpose, code)):
                left = CODE_MAX_ATTEMPTS - row["attempts"] - 1
                conn.execute("UPDATE auth_codes SET attempts=attempts+1, used=? WHERE id=?",
                             (int(left <= 0), row["id"]))
                error = (f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left." if left > 0
                         else "Incorrect code. Request a new one.")
            else:
                conn.execute("UPDATE auth_codes SET used=1 WHERE id=?", (row["id"],))
        if error:
            raise AuthError(error)

    # ------------------------------------------------------------- flows
    def register(self, name: str, email: str, password: str, confirm: str) -> CodeDelivery:
        name = (name or "").strip()[:80]
        if not name:
            raise AuthError("Enter your name.")
        email = normalize_email(email)
        if password != confirm:
            raise AuthError("Passwords do not match.")
        check_password_strength(password)
        existing = self.user(email)
        if existing and existing["verified"]:
            raise AuthError("An account with this email already exists. Sign in instead.")
        with self.db.transaction() as conn:
            if existing:   # unverified sign-up retried: take the latest details
                conn.execute("UPDATE users SET name=?, password_hash=? WHERE email=?",
                             (name, hash_password(password), email))
            else:
                conn.execute("INSERT INTO users(email,name,password_hash,created) VALUES(?,?,?,?)",
                             (email, name, hash_password(password), now()))
            self.db.event("auth_registered", {"email": email}, conn, actor=email)
        return self.send_code(email, "verify")

    def verify_email(self, email: str, code: str) -> dict:
        email = normalize_email(email)
        self._consume_code(email, "verify", code)
        with self.db.transaction() as conn:
            conn.execute("UPDATE users SET verified=1, failed_logins=0, locked_until=NULL, last_login=? "
                         "WHERE email=?", (now(), email))
            self.db.event("auth_verified", {"email": email}, conn, actor=email)
        return self.user(email)

    def login(self, email: str, password: str) -> dict:
        """Return the user on success. Raises ``AuthError``; ``UnverifiedEmail`` needs the verify step."""
        email = normalize_email(email)
        user = self.user(email)
        stored = self._password_hash(email)
        if user and user["locked_until"] and _parse(user["locked_until"]) > _utc():
            minutes = int((_parse(user["locked_until"]) - _utc()).total_seconds() // 60) + 1
            raise AuthError(f"Too many failed sign-in attempts. Try again in {minutes} minute(s) "
                            f"or reset your password.")
        if not verify_password(password or "", stored or hash_password("dummy-password-0")):
            if user:
                with self.db.transaction() as conn:
                    failures = user["failed_logins"] + 1
                    locked = _iso(_utc() + LOCKOUT) if failures >= MAX_FAILED_LOGINS else None
                    conn.execute("UPDATE users SET failed_logins=?, locked_until=? WHERE email=?",
                                 (0 if locked else failures, locked, email))
                    self.db.event("auth_login_failed", {"email": email, "locked": bool(locked)}, conn, actor=email)
            raise AuthError("Incorrect email or password.")
        if not user["verified"]:
            raise UnverifiedEmail("Your email is not verified yet. Enter the code we emailed you.")
        with self.db.transaction() as conn:
            conn.execute("UPDATE users SET failed_logins=0, locked_until=NULL, last_login=? WHERE email=?",
                         (now(), email))
            self.db.event("auth_login", {"email": email}, conn, actor=email)
        return self.user(email)

    def request_reset(self, email: str) -> CodeDelivery | None:
        """Email a reset code. Unknown emails return None without revealing that to the caller's UI."""
        email = normalize_email(email)
        if self.user(email) is None:
            log("auth_reset_unknown_email")
            return None
        return self.send_code(email, "reset")

    def reset_password(self, email: str, code: str, password: str, confirm: str) -> None:
        email = normalize_email(email)
        if password != confirm:
            raise AuthError("Passwords do not match.")
        check_password_strength(password)
        if self.user(email) is None:
            raise AuthError("No active code. Request a new one.")
        self._consume_code(email, "reset", code)
        with self.db.transaction() as conn:
            # A reset code proves control of the mailbox, so it also verifies the email.
            conn.execute("UPDATE users SET password_hash=?, verified=1, failed_logins=0, locked_until=NULL "
                         "WHERE email=?", (hash_password(password), email))
            self.db.event("auth_password_reset", {"email": email}, conn, actor=email)

    def change_password(self, email: str, current: str, password: str, confirm: str) -> None:
        if not verify_password(current or "", self._password_hash(email) or ""):
            raise AuthError("Current password is incorrect.")
        if password != confirm:
            raise AuthError("Passwords do not match.")
        check_password_strength(password)
        with self.db.transaction() as conn:
            conn.execute("UPDATE users SET password_hash=? WHERE email=?", (hash_password(password), email))
            self.db.event("auth_password_changed", {"email": email}, conn, actor=email)


class UnverifiedEmail(AuthError):
    pass


# ----------------------------------------------------------------- CLI diagnostics
def _cli(argv: list[str]) -> int:
    cfg = MailSettings.from_env()
    print(f"SMTP: {cfg.describe()}")
    problems = cfg.problems()
    for p in problems:
        print(f"  ! {p}")
    if "--test-email" in argv:
        idx = argv.index("--test-email")
        if idx + 1 >= len(argv):
            print("Usage: python auth.py --test-email you@example.com")
            return 2
        to = argv[idx + 1]
        try:
            send_email(to, "RetrainWise test email",
                       "If you can read this, RetrainWise can send verification codes.", cfg=cfg)
        except MailError as exc:
            print(f"FAILED: {exc}")
            return 1
        print(f"Sent to {to}. If it is not in the inbox within a minute, check the spam/junk folder.")
        return 0
    if "--check" in argv:
        return 1 if problems else 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))

import net from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import { Auth, AuthError, CODE_MAX_ATTEMPTS, hashPassword, MAX_FAILED_LOGINS, UnverifiedEmail,
  verifyPassword } from "@/lib/auth/auth";
import { MailError, MailNotConfigured, mailProblems, mailSettingsFromEnv, sendEmail, type MailSettings,
  type OutgoingMail } from "@/lib/auth/mail";
import { useTempStore } from "./helpers";

const MAIL: MailSettings = { host: "smtp.test", port: 587, user: "bot@test.io", password: "pw", sender: "bot@test.io",
  security: "starttls", timeoutSeconds: 5, devCodes: false };

describe("auth", () => {
  const tmp = useTempStore();
  let sent: OutgoingMail[];
  let auth: Auth;
  const lastCode = () => sent.at(-1)!.text.match(/\b\d{6}\b/)![0];
  const ageCodes = () => tmp.db().run("UPDATE auth_codes SET created=?", new Date(Date.now() - 120_000).toISOString());

  beforeEach(() => {
    sent = [];
    auth = new Auth(tmp.db(), MAIL, async (mail) => {
      sent.push(mail);
    });
  });

  it("hashes passwords", () => {
    const stored = hashPassword("s3cret-pass");
    expect(stored).not.toContain("s3cret-pass");
    expect(verifyPassword("s3cret-pass", stored)).toBe(true);
    expect(verifyPassword("wrong-pass1", stored)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });

  it("signs up, verifies and logs in", async () => {
    await auth.register("Ada", "Ada@Example.com ", "pass-word1", "pass-word1");
    expect(sent[0].to).toBe("ada@example.com");
    expect(() => auth.login("ada@example.com", "pass-word1")).toThrow(UnverifiedEmail);
    expect(() => auth.verifyEmail("ada@example.com", lastCode() === "000000" ? "111111" : "000000")).toThrow(AuthError);
    expect(auth.verifyEmail("ada@example.com", lastCode()).verified).toBe(1);
    expect(auth.login("ADA@example.com", "pass-word1").name).toBe("Ada");
    await expect(auth.register("Ada", "ada@example.com", "pass-word1", "pass-word1")).rejects.toThrow(/already exists/);
  });

  it("validates sign-up input before sending anything", async () => {
    for (const args of [["", "a@b.co", "pass-word1", "pass-word1"], ["A", "not-an-email", "pass-word1", "pass-word1"],
      ["A", "a@b.co", "short1", "short1"], ["A", "a@b.co", "pass-word1", "pass-word2"],
      ["A", "a@b.co", "onlyletters", "onlyletters"]] as [string, string, string, string][]) {
      await expect(auth.register(...args)).rejects.toThrow(AuthError);
    }
    expect(sent).toHaveLength(0);
  });

  it("codes are single use and replaced by a resend", async () => {
    await auth.register("Bo", "bo@test.io", "pass-word1", "pass-word1");
    const first = lastCode();
    await expect(auth.sendCode("bo@test.io", "verify")).rejects.toThrow(/wait/); // cooldown
    ageCodes();
    await auth.sendCode("bo@test.io", "verify");
    const second = lastCode();
    if (first !== second) expect(() => auth.verifyEmail("bo@test.io", first)).toThrow(AuthError);
    auth.verifyEmail("bo@test.io", second);
    expect(() => auth.verifyEmail("bo@test.io", second)).toThrow(AuthError);
  });

  it("enforces code expiry and the attempt limit", async () => {
    await auth.register("Cy", "cy@test.io", "pass-word1", "pass-word1");
    const code = lastCode();
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) expect(() => auth.verifyEmail("cy@test.io", wrong)).toThrow(AuthError);
    expect(() => auth.verifyEmail("cy@test.io", code)).toThrow(AuthError); // locked even with the right code
    ageCodes();
    await auth.sendCode("cy@test.io", "verify");
    tmp.db().run("UPDATE auth_codes SET expires=?", "2000-01-01T00:00:00+00:00");
    expect(() => auth.verifyEmail("cy@test.io", lastCode())).toThrow(/expired/);
  });

  it("locks the account after repeated failed logins", async () => {
    await auth.register("Di", "di@test.io", "pass-word1", "pass-word1");
    auth.verifyEmail("di@test.io", lastCode());
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) expect(() => auth.login("di@test.io", "wrong-pass1")).toThrow(/Incorrect/);
    expect(() => auth.login("di@test.io", "pass-word1")).toThrow(/Too many/);
    expect(() => auth.login("nobody@test.io", "pass-word1")).toThrow(/Incorrect/);
  });

  it("resets and changes passwords and revokes sessions", async () => {
    await auth.register("Ed", "ed@test.io", "pass-word1", "pass-word1");
    const user = auth.verifyEmail("ed@test.io", lastCode());
    const { token } = auth.createSession(user.id);
    expect(auth.sessionUser(token)!.email).toBe("ed@test.io");
    expect(await auth.requestReset("ghost@test.io")).toBeNull();
    await auth.requestReset("ed@test.io");
    expect(sent.at(-1)!.subject).toMatch(/reset/);
    expect(() => auth.resetPassword("ed@test.io", lastCode(), "new-pass1", "different1")).toThrow(AuthError);
    auth.resetPassword("ed@test.io", lastCode(), "new-pass1", "new-pass1");
    expect(auth.sessionUser(token)).toBeUndefined();
    expect(() => auth.login("ed@test.io", "pass-word1")).toThrow(AuthError);
    expect(auth.login("ed@test.io", "new-pass1").email).toBe("ed@test.io");
    auth.changePassword("ed@test.io", "new-pass1", "third-pass1", "third-pass1");
    expect(() => auth.changePassword("ed@test.io", "new-pass1", "x-pass-123", "x-pass-123")).toThrow(AuthError);
    auth.login("ed@test.io", "third-pass1");
  });

  it("surfaces mail failures and stores no code", async () => {
    const failing = new Auth(tmp.db(), MAIL, async () => {
      throw new MailError("The SMTP server rejected the username/password (535).");
    });
    await expect(failing.register("Fi", "fi@test.io", "pass-word1", "pass-word1")).rejects.toThrow(/rejected/);
    expect(failing.user("fi@test.io")).toBeDefined(); // kept so "Resend code" works after fixing settings
    expect(tmp.db().all("SELECT * FROM auth_codes")).toHaveLength(0);
  });

  it("refuses to pretend when mail is not configured, unless dev codes are on", async () => {
    const off = new Auth(tmp.db(), { ...MAIL, host: "", sender: "" });
    await expect(off.register("Gu", "gu@test.io", "pass-word1", "pass-word1")).rejects.toThrow(MailNotConfigured);
    const dev = new Auth(tmp.db(), { ...MAIL, host: "", sender: "", devCodes: true });
    const delivery = await dev.sendCode("gu@test.io", "verify");
    expect(delivery.sent).toBe(false);
    expect(dev.verifyEmail("gu@test.io", delivery.devCode!).verified).toBe(1);
  });

  it("reads settings from the environment and flags known mistakes", () => {
    const cfg = mailSettingsFromEnv({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "me@gmail.com",
      SMTP_PASSWORD: "abcd efgh ijkl mnop" } as unknown as NodeJS.ProcessEnv);
    expect([cfg.security, cfg.password, cfg.sender]).toEqual(["ssl", "abcdefghijklmnop", "me@gmail.com"]);
    expect(mailProblems(cfg)).toEqual([]);
    expect(mailProblems({ ...cfg, security: "starttls", password: "normal-password", sender: "other@x.com" })).toHaveLength(3);
  });
});

/** Minimal SMTP server (EHLO, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA) for delivery tests. */
function fakeSmtp(user: string, password: string) {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let mode: "cmd" | "data" | "login-user" | "login-pass" = "cmd";
    let loginUser = "";
    let data: string[] = [];
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (mode === "data") {
          if (line === ".") {
            messages.push(data.join("\n"));
            data = [];
            mode = "cmd";
            reply("250 queued");
          } else data.push(line);
          continue;
        }
        if (mode === "login-user") {
          loginUser = Buffer.from(line, "base64").toString();
          mode = "login-pass";
          reply("334 UGFzc3dvcmQ6");
          continue;
        }
        if (mode === "login-pass") {
          mode = "cmd";
          reply(loginUser === user && Buffer.from(line, "base64").toString() === password ? "235 ok" : "535 5.7.8 bad credentials");
          continue;
        }
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (verb === "AUTH") {
          const parts = line.split(" ");
          if (parts[1].toUpperCase() === "PLAIN") {
            const creds = Buffer.from(parts[2], "base64").toString().split("\0").slice(1);
            reply(creds[0] === user && creds[1] === password ? "235 ok" : "535 5.7.8 bad credentials");
          } else {
            mode = "login-user";
            reply("334 VXNlcm5hbWU6");
          }
        } else if (verb === "RCPT") reply(line.includes("reject") ? "550 no such user" : "250 ok");
        else if (verb === "DATA") {
          mode = "data";
          reply("354 go");
        } else if (verb === "QUIT") {
          reply("221 bye");
          socket.end();
        } else reply("250 ok");
      }
    });
    socket.on("error", () => {});
  });
  return { server, messages };
}

describe("real SMTP delivery", () => {
  const tmp = useTempStore();

  it("delivers through a local SMTP server and explains failures", async () => {
    const { server, messages } = fakeSmtp("bot@test.io", "pw");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    const cfg: MailSettings = { host: "127.0.0.1", port, user: "bot@test.io", password: "pw",
      sender: "Bot <bot@test.io>", security: "none", timeoutSeconds: 5, devCodes: false };
    try {
      const auth = new Auth(tmp.db(), cfg);
      await auth.register("Hu", "hu@test.io", "pass-word1", "pass-word1");
      expect(messages).toHaveLength(1);
      for (const header of ["To: hu@test.io", "Subject: Your RetrainWise verification code", "Message-ID:", "Date:"]) {
        expect(messages[0]).toContain(header);
      }
      await expect(sendEmail({ to: "reject@test.io", subject: "s", text: "t" }, cfg)).rejects.toThrow(/refused the recipient/);
      await expect(sendEmail({ to: "hu@test.io", subject: "s", text: "t" }, { ...cfg, password: "no" }))
        .rejects.toThrow(/rejected the username\/password/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await expect(sendEmail({ to: "hu@test.io", subject: "s", text: "t" }, { ...cfg, timeoutSeconds: 2 }))
      .rejects.toThrow(/refused|Timed out|closed/);
  });
});

import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { audit } from "@/lib/audit";
import { layout, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

const maxAgeDays = Math.max(1, Math.min(90, Number(process.env.SESSION_MAX_AGE_DAYS) || 7));

/**
 * Email magic-link authentication (Auth.js + Prisma adapter).
 * - First sign-in creates the account; the email is verified by the link itself.
 * - Database sessions expire after SESSION_MAX_AGE_DAYS (default 7) and are
 *   refreshed at most daily.
 * - Pending workspace invitations for the email are accepted on sign-in.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  session: { strategy: "database", maxAge: maxAgeDays * 24 * 3600, updateAge: 24 * 3600 },
  pages: { signIn: "/signin", verifyRequest: "/signin/check-email", error: "/signin/error" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY || "development-outbox",
      from: process.env.EMAIL_FROM || "RetrainWise <onboarding@resend.dev>",
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        const { text, html } = layout(
          "Sign in to RetrainWise",
          ["Use the button below to sign in. The link expires in 15 minutes and can be used once."],
          { label: "Sign in", url },
        );
        await sendMail({ to: identifier, subject: "Your RetrainWise sign-in link", text, html, url });
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      await audit({ kind: "account_created", actorEmail: user.email ?? "unknown", actorId: user.id ?? null });
    },
    async signIn({ user }) {
      if (!user?.email || !user.id) return;
      const email = user.email.toLowerCase();
      const pending = await prisma.invitation.findMany({ where: { email, acceptedAt: null } });
      for (const inv of pending) {
        await prisma.$transaction([
          prisma.membership.upsert({
            where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
            create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role },
            update: {},
          }),
          prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
        ]);
        await audit({ kind: "invitation_accepted", actorEmail: email, actorId: user.id, workspaceId: inv.workspaceId, detail: { role: inv.role } });
      }
      await audit({ kind: "signed_in", actorEmail: email, actorId: user.id });
    },
    async signOut(message) {
      const session = "session" in message ? message.session : null;
      if (session && "userId" in session) {
        const u = await prisma.user.findUnique({ where: { id: session.userId } });
        await audit({ kind: "signed_out", actorEmail: u?.email ?? "unknown", actorId: session.userId });
      }
    },
  },
});

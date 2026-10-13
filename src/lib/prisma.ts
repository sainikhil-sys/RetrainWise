import "server-only";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __rwPrisma?: PrismaClient };

/** Shared Prisma client (survives hot reloads in development). */
export const prisma = globalForPrisma.__rwPrisma ?? new PrismaClient({ log: ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.__rwPrisma = prisma;

-- CreateTable
CREATE TABLE "EmailReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "delivered" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "notifyApprovals" BOOLEAN NOT NULL DEFAULT true,
    "notifyDecisions" BOOLEAN NOT NULL DEFAULT true,
    "notifyJobs" BOOLEAN NOT NULL DEFAULT true,
    "emailApprovals" BOOLEAN NOT NULL DEFAULT false,
    "emailReports" BOOLEAN NOT NULL DEFAULT true,
    "dismissedTips" TEXT NOT NULL DEFAULT '',
    "lastWorkspaceId" TEXT,
    "jobTitle" TEXT,
    "company" TEXT,
    "teamRole" TEXT,
    "useCase" TEXT,
    "modelsInProduction" TEXT,
    "profileCompletedAt" DATETIME
);
INSERT INTO "new_User" ("company", "createdAt", "dismissedTips", "email", "emailApprovals", "emailVerified", "id", "image", "jobTitle", "lastWorkspaceId", "modelsInProduction", "name", "notifyApprovals", "notifyDecisions", "notifyJobs", "profileCompletedAt", "teamRole", "updatedAt", "useCase") SELECT "company", "createdAt", "dismissedTips", "email", "emailApprovals", "emailVerified", "id", "image", "jobTitle", "lastWorkspaceId", "modelsInProduction", "name", "notifyApprovals", "notifyDecisions", "notifyJobs", "profileCompletedAt", "teamRole", "updatedAt", "useCase" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EmailReport_dedupeKey_key" ON "EmailReport"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailReport_userId_createdAt_idx" ON "EmailReport"("userId", "createdAt");

-- CreateTable
CREATE TABLE "ProviderKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME
);

-- CreateTable
CREATE TABLE "OtpAttempt" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "firstAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProviderKey_workspaceId_idx" ON "ProviderKey"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderKey_workspaceId_provider_key" ON "ProviderKey"("workspaceId", "provider");

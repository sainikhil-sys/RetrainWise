-- CreateTable
CREATE TABLE "EngineStore" (
    "workspace" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "archive" BLOB NOT NULL,
    "updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EngineDataset" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "archive" BLOB NOT NULL,
    "updated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

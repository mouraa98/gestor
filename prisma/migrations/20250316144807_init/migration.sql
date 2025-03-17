-- CreateTable
CREATE TABLE "Divida" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "descricao" TEXT NOT NULL,
    "valorTotal" REAL NOT NULL,
    "parcelasRestantes" INTEGER NOT NULL,
    "valorParcela" REAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Divida_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

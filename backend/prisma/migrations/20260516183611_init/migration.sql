-- CreateTable
CREATE TABLE "_schema_info" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_schema_info_pkey" PRIMARY KEY ("key")
);

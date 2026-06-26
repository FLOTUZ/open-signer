-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "signature_requests" ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "logo_url" TEXT,
ALTER COLUMN "redirect_url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "revoked_certificates" (
    "serial_number" TEXT NOT NULL,
    "revocation_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revoked_certificates_pkey" PRIMARY KEY ("serial_number")
);

-- CreateTable
CREATE TABLE "crl_sync_logs" (
    "id" TEXT NOT NULL,
    "sync_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "records_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "crl_sync_logs_pkey" PRIMARY KEY ("id")
);

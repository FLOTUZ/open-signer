-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('PENDING', 'SIGNED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WebhookJobStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "document_hash" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "document_size" INTEGER NOT NULL,
    "document_url" TEXT NOT NULL,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "redirect_url" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "signature_data" TEXT,
    "nom151_stamp" TEXT,
    "signer_name" TEXT,
    "signer_rfc" TEXT,
    "cer_serial_number" TEXT,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_jobs" (
    "id" TEXT NOT NULL,
    "signature_request_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "WebhookJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "last_response_code" INTEGER,
    "last_response_body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_jobs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_jobs" ADD CONSTRAINT "webhook_jobs_signature_request_id_fkey" FOREIGN KEY ("signature_request_id") REFERENCES "signature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

import { prisma } from "../src/config/db";
import { WebhookDispatcherService } from "../src/services/WebhookDispatcherService";

async function main() {
  console.log("🤖 Creando solicitud de firma de prueba...");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const client = await prisma.user.findFirst({ where: { role: "CLIENT" } });
  if (!client) {
    throw new Error("No hay clientes en la BD");
  }

  const req = await prisma.signatureRequest.create({
    data: {
      documentHash:
        "d57849c71a3962b1b369c4fa2b77dcfeb856b14533e8b0895b5fdcf84b64019a",
      documentName: "audit_webhook_test.pdf",
      documentSize: 1024,
      documentUrl:
        "https://opensigner-signer.s3.us-east-2.amazonaws.com/audit_webhook_test.pdf",
      status: "PENDING",
      webhookUrl: "https://httpbin.org/post", // URL pública segura de pruebas que responde 200
      clientId: client.id,
      expiresAt,
    },
  });
  console.log(`✅ Solicitud de firma de prueba creada con ID: ${req.id}`);

  // 1. Simular la firma completada en BD
  console.log("📝 Marcando como firmada y creando SignedDocument...");
  const updated = await prisma.signatureRequest.update({
    where: { id: req.id },
    data: {
      status: "SIGNED",
      signatureData: "MOCK_SIGNATURE_DATA_RSA_SHA256_BASE64",
      signerName: "JUAN PEREZ LOPEZ",
      signerRfc: "PELJ800101XYZ",
      cerSerialNumber: "20001000000300022815",
    },
  });

  await prisma.signedDocument.create({
    data: {
      id: updated.id,
      clientId: updated.clientId,
      s3Url: updated.documentUrl,
      documentHash: updated.documentHash,
      signatureString: updated.signatureData!,
      signerName: updated.signerName!,
      signerRfc: updated.signerRfc!,
      cadenaOriginal: updated.documentHash,
    },
  });

  // 2. Encolar y despachar webhook
  console.log("📬 Encolando webhook...");
  await WebhookDispatcherService.enqueue(updated);

  console.log("🚀 Despachando webhook...");
  // Buscar el job recién creado
  const job = await prisma.webhookJob.findFirst({
    where: { signatureRequestId: updated.id },
  });

  if (job) {
    await WebhookDispatcherService.dispatch(job);
    console.log("✅ Despacho finalizado.");
  } else {
    console.error("❌ No se encontró el job de webhook encolado.");
  }
}

main().catch((err) => {
  console.error("Error:", err);
});

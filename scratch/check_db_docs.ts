import { prisma } from '../src/config/db';

async function main() {
  console.log('📋 Consultando últimos 5 SignatureRequests...');
  const reqs = await prisma.signatureRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  reqs.forEach((r) => {
    console.log(`Req ID: ${r.id}`);
    console.log(`  Nombre: ${r.documentName}`);
    console.log(`  Url: ${r.documentUrl}`);
    console.log(`  Status: ${r.status}`);
  });

  console.log('\n📋 Consultando últimos 5 SignedDocuments...');
  const docs = await prisma.signedDocument.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  docs.forEach((d) => {
    console.log(`Doc ID: ${d.id}`);
    console.log(`  Url: ${d.s3Url}`);
    console.log(`  Stamped Url: ${d.stampedS3Url}`);
  });
}

main().catch((err) => console.error(err));

import { prisma } from '../src/config/db';

async function main() {
  console.log('📋 Consultando últimos 15 logs de auditoría...');
  const logs = await prisma.auditLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 15,
  });

  logs.forEach((log) => {
    console.log(`----------------------------------------`);
    console.log(`[${log.timestamp.toISOString()}] ${log.method} ${log.endpoint}`);
    console.log(`Usuario: ${log.username || 'Anónimo'} (Rol: ${log.role || 'N/A'})`);
    console.log(`IP: ${log.originIp}`);
    console.log(`Descripción: ${log.description}`);
  });
  console.log(`----------------------------------------`);
}

main().catch((err) => {
  console.error('Error:', err);
});

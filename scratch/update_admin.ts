import { prisma } from '../src/config/db';

async function main() {
  const result = await prisma.user.updateMany({
    where: { email: 'admin@opensigner.com' },
    data: { mustChangePassword: true },
  });
  console.log(`Updated ${result.count} users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { prisma } from '../src/config/db';
import crypto from 'crypto';
import { Role } from '@prisma/client';

async function main() {
  console.log('🤖 Iniciando pruebas de branding por API Key...');

  // 1. Asegurar usuario admin
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin12345', salt, 10000, 64, 'sha512').toString('hex');
  const passwordHash = `${salt}:${hash}`;

  const admin = await prisma.user.upsert({
    where: { email: 'admin@opensigner.com' },
    update: { passwordHash },
    create: {
      email: 'admin@opensigner.com',
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });
  console.log(`✅ Super Admin configurado: ${admin.email}`);

  // 2. Asegurar cliente demo
  const clientSalt = crypto.randomBytes(16).toString('hex');
  const clientHash = crypto.pbkdf2Sync('client12345', clientSalt, 10000, 64, 'sha512').toString('hex');
  const clientPasswordHash = `${clientSalt}:${clientHash}`;

  const client = await prisma.user.upsert({
    where: { email: 'client@opensigner.com' },
    update: { passwordHash: clientPasswordHash },
    create: {
      email: 'client@opensigner.com',
      passwordHash: clientPasswordHash,
      role: Role.CLIENT,
      name: 'Cliente Corporativo Demo',
    },
  });
  console.log(`✅ Cliente Demo configurado: ${client.email}`);

  // 3. Login HTTP como cliente para obtener JWT
  const loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'client@opensigner.com',
      password: 'client12345',
    }),
  });

  if (!loginRes.ok) {
    throw new Error(`Fallo en login de cliente: ${loginRes.statusText}`);
  }

  const loginData = await loginRes.json() as any;
  const token = loginData.data.token;
  console.log(`✅ Login de cliente exitoso. JWT obtenido: ${token.substring(0, 15)}...`);

  // 4. Crear una API Key
  const apiKeyRes = await fetch('http://localhost:5000/api/v1/clients/apikeys', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!apiKeyRes.ok) {
    throw new Error(`Fallo al generar API Key: ${apiKeyRes.statusText}`);
  }
  const apiKeyData = await apiKeyRes.json() as any;
  const keyId = apiKeyData.data.id;
  const apiKey = apiKeyData.data.apiKey;
  console.log(`✅ API Key generada con ID: ${keyId}`);

  // 5. Configurar Branding en la API Key (POST /clients/apikeys/:keyId/branding)
  // Crear un FormData con un logo dummy en memoria y subirlo
  // Imagen de 1x1 px transparente en PNG (Base64)
  const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const dummyBuffer = Buffer.from(dummyPngBase64, 'base64');

  const boundary = '----TestBoundary' + Math.random().toString(36).substring(2);
  const logoHeader = `--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="project_logo.png"\r\nContent-Type: image/png\r\n\r\n`;
  const nameHeader = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nMi Proyecto Personalizado API`;
  const footer = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(logoHeader, 'utf-8'),
    dummyBuffer,
    Buffer.from(nameHeader, 'utf-8'),
    Buffer.from(footer, 'utf-8'),
  ]);

  console.log(`📤 Subiendo branding a la API Key ${keyId}...`);
  const uploadRes = await fetch(`http://localhost:5000/api/v1/clients/apikeys/${keyId}/branding`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Error en subida de branding: [${uploadRes.status}] ${errText}`);
  }

  const uploadData = await uploadRes.json() as any;
  console.log('✅ Branding configurado en API Key:', JSON.stringify(uploadData.data, null, 2));

  // 6. Crear una solicitud de firma usando la API Key configurada
  const docHeader = `--${boundary}\r\nContent-Disposition: form-data; name="documento"; filename="test_doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
  const docContent = Buffer.from('%PDF-1.4 ... test doc ...');
  const webhookHeader = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="webhookUrl"\r\n\r\nhttp://localhost/webhook`;
  
  const docBody = Buffer.concat([
    Buffer.from(docHeader, 'utf-8'),
    docContent,
    Buffer.from(webhookHeader, 'utf-8'),
    Buffer.from(footer, 'utf-8'),
  ]);

  console.log('📤 Solicitando firma con la API Key configurada...');
  const reqRes = await fetch('http://localhost:5000/api/v1/signatures/request', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: docBody,
  });

  if (!reqRes.ok) {
    const errText = await reqRes.text();
    throw new Error(`Error al solicitar firma: ${errText}`);
  }

  const reqData = await reqRes.json() as any;
  const requestId = reqData.data.id;
  console.log(`✅ SignatureRequest creada con ID: ${requestId}`);

  // 7. Consultar el contexto de la solicitud de firma (público)
  const ctxRes = await fetch(`http://localhost:5000/api/v1/signatures/request/${requestId}/context`);
  if (!ctxRes.ok) {
    throw new Error(`Error al obtener contexto: ${ctxRes.statusText}`);
  }

  const ctxData = await ctxRes.json() as any;
  console.log('✅ Contexto de firma obtenido:', JSON.stringify(ctxData.data, null, 2));

  if (ctxData.data.clientName === "Mi Proyecto Personalizado API" && ctxData.data.logoUrl) {
    console.log('🎉 ¡PRUEBA TOTALMENTE EXITOSA! El clientName y logoUrl de la API Key están presentes en el contexto.');
  } else {
    throw new Error('❌ Fallo: El branding de la API Key no está en la respuesta del contexto.');
  }
}

main()
  .catch((e) => {
    console.error('❌ Error en las pruebas:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

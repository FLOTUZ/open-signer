#!/bin/bash

# --- 1. Configuración y Limpieza Inicial ---
echo "⚙️ Limpiando archivos de build anteriores..."
rm -rf dist api-deploy.zip
if [ $? -ne 0 ]; then
  echo "❌ Error al limpiar archivos anteriores."
  exit 1
fi

echo "📦 Instalando dependencias del Backend..."
npm ci
if [ $? -ne 0 ]; then
  echo "❌ Error al instalar dependencias del Backend."
  exit 1
fi

# --- 2. Compilación de la Aplicación y Prisma ---
echo "🔗 Generando cliente Prisma..."
npx prisma generate
if [ $? -ne 0 ]; then
  echo "❌ Error al generar cliente Prisma."
  exit 1
fi

echo "🛠️ Compilando aplicación Express (TypeScript)..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Error al compilar la aplicación."
  exit 1
fi

# --- 3. Empaquetado Final ---
echo "🔒 Creando paquete de despliegue (api-deploy.zip)..."
zip -r api-deploy.zip \
    Dockerfile \
    prisma \
    dist \
    public \
    package.json \
    package-lock.json
if [ $? -ne 0 ]; then
  echo "❌ Error al empaquetar el archivo ZIP."
  exit 1
fi

echo "✅ Despliegue listo: api-deploy.zip"

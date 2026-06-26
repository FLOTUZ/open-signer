# ─── FASE 1: BUILDER ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias (incluyendo devDependencies)
COPY package*.json ./
RUN npm ci

# Generar cliente Prisma
COPY prisma ./prisma
RUN npx prisma generate

# Copiar código fuente y compilar
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ─── FASE 2: RUNNER (PRODUCCIÓN REAL) ──────────────────────────────
FROM node:20-alpine AS runner

# Etiqueta para vincular la imagen al repositorio en GitHub Container Registry
LABEL org.opencontainers.image.source="https://github.com/FLOTUZ/open-signer"

# Dependencias del sistema requeridas por Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# CRÍTICO: Usar el usuario 'node' sin privilegios (incluido en la imagen base)
# Cambiamos la propiedad del directorio de trabajo antes de cambiar de usuario
RUN chown -R node:node /app
USER node

# Copiar SOLO los artefactos necesarios desde la fase builder
COPY --from=builder --chown=node:node /app/package*.json ./
# En un entorno estricto, aquí harías 'npm ci --omit=dev', pero usaremos el node_modules generado si Prisma lo requiere
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public

# Crear directorio de uploads con los permisos del usuario sin privilegios
RUN mkdir -p uploads

EXPOSE 5000

# Ejecutar migraciones pendientes automáticamente antes de iniciar el servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
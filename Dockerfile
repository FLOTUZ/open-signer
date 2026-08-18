# ─── FASE 1: FRONTEND BUILDER ──────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# La app se sirve desde el mismo origen que la API, por lo que la ruta
# puede ser relativa salvo que se necesite apuntar a otro dominio.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── FASE 2: BACKEND BUILDER ───────────────────────────────────────
FROM node:20-alpine AS backend-builder

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

# ─── FASE 3: RUNNER (PRODUCCIÓN REAL) ──────────────────────────────
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

# Copiar SOLO los artefactos necesarios desde la fase builder del backend
COPY --from=backend-builder --chown=node:node /app/package*.json ./
# En un entorno estricto, aquí harías 'npm ci --omit=dev', pero usaremos el node_modules generado si Prisma lo requiere
COPY --from=backend-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-builder --chown=node:node /app/dist ./dist
COPY --from=backend-builder --chown=node:node /app/prisma ./prisma
COPY --from=backend-builder --chown=node:node /app/public ./public

# Copiar el build estático del frontend, servido directamente por Express
COPY --from=frontend-builder --chown=node:node /app/frontend/dist ./frontend-dist

# Crear directorio de uploads con los permisos del usuario sin privilegios
RUN mkdir -p uploads

EXPOSE 5000

# Ejecutar migraciones pendientes automáticamente y copiar certificados (failsafe)
CMD ["sh", "-c", "mkdir -p /app/certs/sat && cp -r /etc/sat-certs/* /app/certs/sat/ 2>/dev/null || true && npx prisma migrate deploy && node dist/server.js"]

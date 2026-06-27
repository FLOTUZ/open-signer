# --- Etapa 1: Compilación de React ---
FROM node:20-alpine AS build

WORKDIR /usr/src/app

# Copiar manifiestos
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Recibir e inyectar variable de entorno de compilación para Vite
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Compilar archivos estáticos del frontend
RUN npm run build

# --- Etapa 2: Servidor Nginx ---
FROM nginx:alpine

# Etiqueta para vincular la imagen al repositorio en GitHub Container Registry
LABEL org.opencontainers.image.source="https://github.com/FLOTUZ/open-signer"

# Copiar compilación de la etapa anterior al directorio raíz de Nginx
COPY --from=build /usr/src/app/dist /usr/share/nginx/html

# Copiar configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Script para inyectar variables de entorno en tiempo de ejecución
COPY generate-env.sh /docker-entrypoint.d/40-generate-env.sh
RUN chmod +x /docker-entrypoint.d/40-generate-env.sh

# Exponer puerto HTTP estándar
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

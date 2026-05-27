# Multi-stage build pour optimiser la taille
FROM node:18-alpine AS builder

WORKDIR /app

# Copier les dépendances
COPY package*.json ./

# Installer les dépendances (développement et production)
RUN npm ci --only=production

# Stage de production final (Node.js est suffisant)
FROM node:18-alpine

WORKDIR /app

# Copier les fichiers de l'application
COPY . .

# Copier les dépendances du builder
COPY --from=builder /app/node_modules ./node_modules

# Exposer le port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8000/ || exit 1

# Commande de démarrage
CMD ["node", "server.js"]

# Labels
LABEL maintainer="Maieutik"
LABEL description="SPA pour résolution d'exercices avec IA DeepSeek R1"
LABEL version="1.0.0"

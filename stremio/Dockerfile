# Build séparé de l'exécution : l'image finale n'embarque ni TypeScript ni
# les dépendances de développement.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Le journal de /debug/live y est écrit quand LIVE_LOG_FILE le demande. Créé
# ici plutôt que par le volume : un volume nommé hérite des droits du dossier
# de l'image, et sans ce chown il appartiendrait à root — donc illisible pour
# l'utilisateur `node` ci-dessous.
RUN mkdir -p /data && chown node:node /data

# L'addon ne sert que du HTTP : pas de privilèges à conserver.
USER node
EXPOSE 7000

# Le healthcheck tape l'endpoint /health, qui n'appelle aucun site externe.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

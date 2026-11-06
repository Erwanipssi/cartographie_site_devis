FROM node:22-alpine
RUN apk add --no-cache openssl ca-certificates
# Autorités de certification supplémentaires : derrière un proxy d'entreprise qui inspecte le HTTPS, déposez
# son certificat racine (.crt, format PEM) dans docker/certs/ avant de construire. Sans fichier, rien ne change.
COPY docker/certs/ /tmp/certs/
# update-ca-certificates (Alpine) ne lit pas les sous-dossiers : les .crt vont directement dans le dossier attendu.
RUN for cert in /tmp/certs/*.crt; do [ -f "$cert" ] && cp "$cert" /usr/local/share/ca-certificates/; done; \
    update-ca-certificates && rm -rf /tmp/certs
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
# Corepack installé dans un dossier partagé : l'utilisateur non root « node » doit pouvoir lancer pnpm.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# --ignore-scripts : le « prisma generate » de postinstall échouerait ici, le schéma n'est pas encore copié.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @cartographie/api...
COPY . .
# Génère le client et télécharge les moteurs Prisma (dont celui des migrations) dès le build, pas au démarrage.
RUN pnpm --filter @cartographie/api exec prisma generate && pnpm --filter @cartographie/api exec prisma --version
# Seuls les dossiers de données (exports, journaux) sont modifiables par le processus.
RUN mkdir -p /app/apps/api/data/exports /app/apps/api/data/logs && chown -R node:node /app/apps/api/data
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]

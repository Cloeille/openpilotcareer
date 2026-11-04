# syntax=docker/dockerfile:1
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci && npm run build -w @opc/web && npm prune --omit=dev

FROM node:26-slim
ENV NODE_ENV=production OPC_DB=/data/opc.sqlite OPC_PORT=8080
WORKDIR /app
COPY --from=build /app ./
COPY data ./data
# The node image's unprivileged user owns the volume, so the container never runs as root.
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.OPC_PORT+'/api/v1/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/server/src/index.ts"]

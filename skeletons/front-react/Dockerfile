FROM zot.homelab/golden/node-builder:stable AS build

WORKDIR /home/node

COPY --chown=node:node package.json package-lock.json .npmrc ./

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

FROM zot.homelab/golden/runtime:node

WORKDIR /app

COPY --from=build /home/node/dist ./dist
COPY --from=build /home/node/server/server.mjs ./server/server.mjs

EXPOSE 8080

USER 65532:65532

CMD ["server/server.mjs"]

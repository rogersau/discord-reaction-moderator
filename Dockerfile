FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm approve-builds --all \
  && pnpm rebuild --pending

COPY . .
RUN pnpm run build:node

FROM node:22-bookworm-slim
WORKDIR /app

ENV PORT=8787

COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-node ./dist-node

EXPOSE 8787

CMD ["node", "dist-node/src/runtime/node-main.js"]

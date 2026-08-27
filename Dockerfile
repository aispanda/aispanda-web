FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/scripts/studio-tiptap-schema.mjs ./src/scripts/studio-tiptap-schema.mjs
COPY --from=build /app/package.json ./package.json
RUN node --input-type=module --eval "await import('./server/studio-content-document.mjs')"
EXPOSE 8080
CMD ["node", "server/server.mjs"]

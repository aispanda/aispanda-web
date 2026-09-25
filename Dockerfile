FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN node scripts/blog-package.mjs install \
    && for runtime in .blog/releases/*/runtime; do (cd "$runtime" && pnpm install --frozen-lockfile); done \
    && node scripts/blog-package.mjs build \
    && pnpm build && pnpm prune --prod \
    && for runtime in .blog/releases/*/runtime; do (cd "$runtime" && pnpm prune --prod); done

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV BLOG_CAPABILITY_ENABLED=true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/.blog ./.blog
COPY --from=build /app/config ./config
COPY --from=build /app/src/scripts/studio-tiptap-schema.mjs ./src/scripts/studio-tiptap-schema.mjs
COPY --from=build /app/package.json ./package.json
RUN node --input-type=module --eval "await import('./server/studio-content-document.mjs')"
EXPOSE 8080
CMD ["node", "server/server.mjs"]

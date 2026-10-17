# syntax=docker/dockerfile:1

# Build the production frontend with the same Node major version used in CI.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Include a lockfile automatically if the repository adds one later.
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=10000
WORKDIR /app

# The application executes server.ts through tsx, so its server-side TypeScript
# modules and required static assets must be present in the runtime image.
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server.ts ./server.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist

# The settings service may write a local, non-durable settings cache under WORKDIR.
RUN chown node:node /app
USER node

EXPOSE 10000
CMD ["npm", "start"]

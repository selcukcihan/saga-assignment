FROM node:24.13.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY scripts/build.mjs ./scripts/build.mjs
COPY src ./src
RUN npm run build

FROM dependencies AS test
COPY . .
CMD ["npx", "vitest", "run", "--project", "e2e"]

FROM node:24.13.1-bookworm-slim AS production-dependencies
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY package.json ./package.json
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
CMD ["node", "dist/api/main.js"]

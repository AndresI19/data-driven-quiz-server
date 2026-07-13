# Multi-stage: build the Vite client (base baked in), then serve it + cards + print sheet.
#
# The shared @platform/ui package lives in portfolio-home, which is its source of truth. That repo is
# a git submodule at vendor/portfolio-home, so the package is INSIDE the build context and a plain
# `docker build .` works with no extra flags.
#
# .dockerignore keeps only vendor/portfolio-home/packages/ — the rest of the home page (its own src,
# its assets) is not needed to compile ~100 lines of shared CSS, and would only bloat the image.
#
# Clone with --recurse-submodules, or vendor/ is empty and `npm ci` will fail.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# URL prefix the app is mounted under behind a reverse proxy. Baked into the client at build time.
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
# The lockfile resolves @platform/ui to file:vendor/platform-ui, so the submodule has to be present
# before `npm ci` runs.
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG BASE_PATH=/
ENV NODE_ENV=production
ENV PORT=80
# Must match the base baked into the client build, so the server mounts its routes at the same prefix.
ENV BASE_PATH=$BASE_PATH
COPY package*.json ./
COPY vendor ./vendor
# The server runs via tsx (a devDependency), so keep dev deps even under NODE_ENV=production.
RUN npm ci --include=dev
COPY --from=build /app/dist ./dist
COPY src ./src
COPY cards ./cards
COPY tsconfig.json ./
EXPOSE 80
CMD ["npm", "start"]

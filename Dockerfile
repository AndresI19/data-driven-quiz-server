# Multi-stage: build the Vite client (base baked in), then serve it + cards + print sheet.
#
# The shared @platform/ui package is a git submodule at vendor/platform-ui, so it is INSIDE the build
# context — a plain `docker build .` works with no extra flags. (It used to be a sibling directory
# passed in as a named build context, which meant the image could not be built from a fresh clone.)
#
# Clone with --recurse-submodules, or the vendor/ directory is empty and `npm ci` will fail.
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

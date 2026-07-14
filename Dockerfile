# Multi-stage: build the Vite client and bundle the Express server into ONE self-contained file, then
# ship both — plus the card decks — on an apt-patched slim base with no npm and no node_modules.
#
# The server used to run via tsx (a devDependency) from src/, forcing the runtime image to carry every
# dev dependency. It is now esbuild-bundled into dist/server/index.mjs with everything inlined
# (Express, @platform/ui, the card loader), so the runtime needs only the node binary, the bundle, and
# the card YAML. Slim + `apt-get upgrade` (not distroless — distroless cannot patch its OS packages),
# then npm stripped, collapses the CVE surface to node + the OS.
#
# The shared @platform/ui package lives in portfolio-home, a git submodule at vendor/portfolio-home,
# so `docker build .` works with no flags. Clone with --recurse-submodules or vendor/ is empty.
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
# Vite builds the client; esbuild bundles the server into dist/server/index.mjs — the SAME depth below
# the app root as the original src/server/index.ts, so the server's `resolve(__dirname, '../..')` still
# lands on /app and finds both dist/client and cards. ESM keeps import.meta.url working; the
# createRequire banner lets the bundled CJS deps' require() calls resolve under ESM.
RUN npm run build \
    && npx esbuild src/server/index.ts --bundle --platform=node --format=esm \
       --banner:js='import{createRequire}from"module";const require=createRequire(import.meta.url);' \
       --outfile=dist/server/index.mjs

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG BASE_PATH=/
ENV NODE_ENV=production
ENV PORT=80

# Version, stamped by k8s/deploy.sh — an OCI label so the image is identifiable without running it,
# and a VERSION file so the server can serve it from <base>/version. Unset (a bare `docker build`)
# writes an empty file and the server reports "snapshot"; a dev build must not claim to be a release.
ARG VERSION
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.title="data-driven-quiz-server" \
      org.opencontainers.image.description="The flashcards quiz" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
RUN printf '%s' "${VERSION}" > /app/VERSION
# Must match the base baked into the client build, so the server mounts its routes at the same prefix.
ENV BASE_PATH=$BASE_PATH
# Patch the OS, then strip npm (the runtime only runs `node`): both are pure CVE surface here.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# The runtime: the self-contained server + client bundle, and the seed card decks (a PersistentVolume
# is mounted over /app/cards in the cluster).
COPY --from=build /app/dist ./dist
COPY cards ./cards
EXPOSE 80
CMD ["node", "dist/server/index.mjs"]

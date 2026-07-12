# Multi-stage: build the Vite client (base baked in), then serve it + cards + print sheet.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# URL prefix the app is mounted under behind the proxy. Baked into the client at build time.
ARG BASE_PATH=/cloud-developer-quiz/
ENV BASE_PATH=$BASE_PATH
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ARG BASE_PATH=/cloud-developer-quiz/
ENV NODE_ENV=production
ENV PORT=80
# Must match the base baked into the client build so the server mounts routes at the same prefix.
ENV BASE_PATH=$BASE_PATH
COPY package*.json ./
# The server runs via tsx (a devDependency), so keep dev deps even under NODE_ENV=production.
RUN npm ci --include=dev
COPY --from=build /app/dist ./dist
COPY src ./src
COPY cards ./cards
COPY tsconfig.json ./
EXPOSE 80
CMD ["npm", "start"]

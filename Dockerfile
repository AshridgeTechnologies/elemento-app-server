# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.11.0

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

WORKDIR /app

# Run the application as a non-root user.
# USER node

COPY src ./src
COPY package*.json tsconfig*.json ./
RUN npm install --include dev  # for types
RUN npm run build
ENTRYPOINT ["node", "lib/run.js"]

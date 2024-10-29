# syntax=docker/dockerfile:1

ARG NODE_VERSION=20.17.0

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

WORKDIR /app

# Run the application as a non-root user.
# USER node

COPY src ./src
COPY src package*.json tsconfig*.json ./
RUN ls -lr .
RUN npm install
RUN npm run build
ENTRYPOINT ["node", "lib/run.js"]

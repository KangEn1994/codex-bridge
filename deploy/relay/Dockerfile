FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "relay/entrypoint.mjs"]

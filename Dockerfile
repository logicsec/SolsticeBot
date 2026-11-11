FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js wowhead.js ./
USER node
CMD ["node", "index.js"]

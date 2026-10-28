FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]

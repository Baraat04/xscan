FROM node:24-alpine
# Chromium opens tender pages that build their content with JavaScript (SAM.gov and other modern portals).
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont ca-certificates
ENV CHROME_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The browser calls the API on the site's own address, through the reverse proxy.
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npx", "next", "start"]

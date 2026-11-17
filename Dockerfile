FROM node:22-alpine AS app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build
ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567
USER node
CMD ["node", "--import", "tsx", "server/index.ts"]

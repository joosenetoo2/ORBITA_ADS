# Multi-stage build: React + Vite -> Nginx Alpine
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

# Production server stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY 15-format-backend-host.sh /docker-entrypoint.d/15-format-backend-host.sh

RUN chmod +x /docker-entrypoint.d/15-format-backend-host.sh

ENV NGINX_ENVSUBST_FILTER=BACKEND_HOST

EXPOSE 80 7895

CMD ["nginx", "-g", "daemon off;"]


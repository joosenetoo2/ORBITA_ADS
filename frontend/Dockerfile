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

ENV BACKEND_HOST=backend:8000

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]


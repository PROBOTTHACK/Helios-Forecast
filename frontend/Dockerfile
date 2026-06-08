# --- Build Stage ---
FROM node:20-alpine AS build

WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install dependencies (incorporating legacy-peer-deps for React 19 compatibility)
RUN npm install --legacy-peer-deps

# Copy frontend source files
COPY . .

# Compile application
RUN npm run build

# --- Production Stage ---
FROM nginx:alpine

# Copy built distribution files to Nginx web directory
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx virtual host configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port 80
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]

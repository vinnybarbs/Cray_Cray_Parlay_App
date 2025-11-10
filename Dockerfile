# Dockerfile for running the Express + Vite built frontend together
# Uses Node 20 LTS (required for Vite 7 and modern dependencies)
FROM node:20-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install ALL dependencies (including dev) so we can build the frontend
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Copy entire source (needed for Vite build)
COPY . .

# Build frontend assets with Vite
RUN npm run build

# Clean up dev dependencies (optional, keeps image smaller)
# RUN npm ci --omit=dev --no-audit --no-fund

# Expose port used by server.js
ENV PORT 5001
EXPOSE 5001

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["npm", "run", "start"]

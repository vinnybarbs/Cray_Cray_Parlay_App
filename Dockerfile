# Minimal Dockerfile for running the Express + Vite built frontend together
# Uses Node 18 LTS
FROM node:18-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (package.json + package-lock.json if present)
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --no-audit --no-fund

# Copy source
COPY . .

# Build frontend assets (postinstall already runs build in package.json, but ensure it here)
RUN npm run build --if-present || true

# Expose port used by server.js
ENV PORT 5001
EXPOSE 5001

# Start the server
CMD ["npm", "run", "start"]

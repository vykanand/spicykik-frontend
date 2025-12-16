# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy all files
COPY . .

# Create a writable directory for config and data
RUN mkdir -p /app/data && \
    chmod -R 755 /app && \
    chmod -R 777 /app/data

# Set environment variables for config (optional, can be overridden)
ENV PRODUCTION_FOLDER=production
ENV ACTIVE_PROTOTYPE=

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
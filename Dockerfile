# Use Node.js as the base image
FROM node:20-bullseye-slim

# Install necessary compilers (g++, python3, java)
RUN apt-get update && apt-get install -y \
    g++ \
    gcc \
    make \
    python3 \
    default-jdk \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first (CACHE layer)
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "server/server.js"]

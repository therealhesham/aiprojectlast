# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the app source code
COPY . .

# Copy Google service account key into container
# Make sure you have your JSON file at ./credentials/sa.json relative to your project

# Set environment variable for Google credentials
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/sa.json

# Expose port
ENV PORT=4444

# Command to run the app
CMD ["node", "server.js"]

FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy bot source
COPY bot.js ./

# Start the bot
CMD ["node", "bot.js"]

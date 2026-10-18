FROM node:20-alpine

# yt-dlp (needs python3) + ffmpeg so Simmer can read subtitles and transcribe audio.
RUN apk add --no-cache python3 ca-certificates ffmpeg \
  && wget -q -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]

FROM epgstation-v2:ffmpeg7-full-vaapi-fixed

COPY source/api.d.ts /app/api.d.ts
COPY source/server-src/ /app/src/
COPY source/client-src/ /app/client/src/

RUN npm run build-server && \
    npm run build-client

# ============================================================
# Stage 1: Build FFmpeg 7.0.2
# ============================================================
FROM debian:11-slim AS ffmpeg-builder

ARG FFMPEG_VERSION=7.0.2
ARG FFMPEG_PREFIX=/opt/ffmpeg-${FFMPEG_VERSION}

ENV DEBIAN_FRONTEND=noninteractive

# Pin Debian repositories to a known-good snapshot so FFmpeg builds remain
# reproducible even when the regular Bullseye mirrors change.
RUN printf '%s\n' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260824T000000Z bullseye-security main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye-updates main' \
    > /etc/apt/sources.list

RUN apt-get -o Acquire::http::No-Cache=true -o Acquire::http::Pipeline-Depth=0 update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        yasm \
        nasm \
        curl \
        ca-certificates \
        xz-utils \
        pax-utils \
        libva-dev \
        libdrm-dev \
        libass-dev \
        libfreetype6-dev \
        libfontconfig1-dev \
        libmp3lame-dev \
        libopus-dev \
        libvorbis-dev \
        libtheora-dev \
        libvpx-dev \
        libx264-dev \
        libx265-dev \
        libaribb24-dev \
    && rm -rf /var/lib/apt/lists/*

COPY patches/ffmpeg-7.0.2-vaapi-dynamic-pool.patch \
     /tmp/ffmpeg-7.0.2-vaapi-dynamic-pool.patch

RUN mkdir -p /tmp/ffmpeg-build && \
    cd /tmp/ffmpeg-build && \
    curl -fsSL \
        "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
        | tar -xJ --strip-components=1 && \
    patch -p1 < /tmp/ffmpeg-7.0.2-vaapi-dynamic-pool.patch && \
    grep -n -C 4 "initial_pool_size" libavfilter/vaapi_vpp.c && \
    ./configure \
        --prefix="${FFMPEG_PREFIX}" \
        --enable-gpl \
        --enable-version3 \
        --enable-vaapi \
        --enable-libdrm \
        --enable-libass \
        --enable-libfreetype \
        --enable-libfontconfig \
        --enable-libmp3lame \
        --enable-libopus \
        --enable-libvorbis \
        --enable-libtheora \
        --enable-libvpx \
        --enable-libx264 \
        --enable-libx265 \
        --enable-libaribb24 \
        --disable-doc && \
    make -j"$(nproc)" && \
    make install

# Build TS timeline remux helper against this FFmpeg 7 installation.
COPY ts-repair/ts-timeline-remux.c /tmp/ts-timeline-remux.c
COPY ts-repair/timeline-map.c /tmp/timeline-map.c
COPY ts-repair/timeline-map.h /tmp/timeline-map.h
COPY ts-repair/audio-repair.c /tmp/audio-repair.c
COPY ts-repair/audio-writer.c /tmp/audio-writer.c
COPY ts-repair/audio-writer.h /tmp/audio-writer.h
COPY ts-repair/video-repair.c /tmp/video-repair.c
COPY ts-repair/ts-repair.sh /tmp/ts-repair.sh
COPY ts-repair/ts-health-check.c /tmp/ts-health-check.c

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra -I/tmp \
       /tmp/ts-timeline-remux.c \
       /tmp/timeline-map.c \
       -o "${FFMPEG_PREFIX}/bin/ts-timeline-remux.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil)

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra -I/tmp \
       /tmp/audio-repair.c \
       /tmp/audio-writer.c \
       /tmp/timeline-map.c \
       -o "${FFMPEG_PREFIX}/bin/audio-repair.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil) \
       -lm

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra \
       /tmp/video-repair.c \
       -o "${FFMPEG_PREFIX}/bin/video-repair.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil) \
       -lm

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra \
       /tmp/ts-health-check.c \
       -o "${FFMPEG_PREFIX}/bin/ts-health-check.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil)

# Collect runtime shared libraries
RUN mkdir -p "${FFMPEG_PREFIX}/lib/runtime" && \
    { \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffmpeg"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffprobe"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ts-timeline-remux.real"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/audio-repair.real"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/video-repair.real"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ts-health-check.real"; \
    } \
    | sort -u \
    | while read -r lib; do \
        case "${lib}" in \
            "${FFMPEG_PREFIX}"/*) \
                ;; \
            /*) \
                if [ -f "${lib}" ]; then \
                    cp -L "${lib}" "${FFMPEG_PREFIX}/lib/runtime/"; \
                fi \
                ;; \
        esac; \
    done

# Rename real binaries
RUN mv "${FFMPEG_PREFIX}/bin/ffmpeg" \
       "${FFMPEG_PREFIX}/bin/ffmpeg.real" && \
    mv "${FFMPEG_PREFIX}/bin/ffprobe" \
       "${FFMPEG_PREFIX}/bin/ffprobe.real"

# ffmpeg wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF="$(readlink -f "$0")"' \
    'SELF_DIR="$(dirname -- "$SELF")"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ffmpeg.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ffmpeg" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ffmpeg"

# ffprobe wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF="$(readlink -f "$0")"' \
    'SELF_DIR="$(dirname -- "$SELF")"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ffprobe.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ffprobe" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ffprobe"

# ts-timeline-remux wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ts-timeline-remux.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ts-timeline-remux" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ts-timeline-remux"

# audio-repair wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/audio-repair.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/audio-repair" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/audio-repair"

# video-repair wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/video-repair.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/video-repair" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/video-repair"

# TS Repair orchestrator
RUN cp /tmp/ts-repair.sh "${FFMPEG_PREFIX}/bin/ts-repair" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ts-repair"

# ts-health-check wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ts-health-check.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ts-health-check" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ts-health-check"

# Builder verification
RUN "${FFMPEG_PREFIX}/bin/ffmpeg" -version && \
    "${FFMPEG_PREFIX}/bin/ffprobe" -version && \
    output="$("${FFMPEG_PREFIX}/bin/ts-timeline-remux" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/audio-repair" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/video-repair" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/ts-repair" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/ts-health-check" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:'

# ============================================================
# Stage 2: EPGStation builder
# ============================================================
FROM node:16.13.1-bullseye-slim AS epgstation-builder

WORKDIR /app

USER root

ENV DOCKER=YES

RUN printf '%s\n' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260824T000000Z bullseye-security main' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye-updates main' \
    > /etc/apt/sources.list && \
    apt-get \
        -o Acquire::http::No-Cache=true \
        -o Acquire::http::Pipeline-Depth=0 \
        update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# Server build metadata.
COPY source/package.json /app/package.json
COPY source/package-lock.json /app/package-lock.json
COPY source/.npmrc /app/.npmrc
COPY source/.eslintrc.json /app/.eslintrc.json
COPY source/.prettierrc /app/.prettierrc
COPY source/gulpfile.js /app/gulpfile.js
COPY source/ormconfig.js /app/ormconfig.js
COPY source/api.d.ts /app/api.d.ts
COPY source/api.yml /app/api.yml

RUN npm ci

# Server source.
COPY source/server-src/ /app/src/

# Client build metadata.
RUN mkdir -p /app/client

COPY source/client-package.json /app/client/package.json
COPY source/client-package-lock.json /app/client/package-lock.json

COPY source/client-config/.browserslistrc /app/client/.browserslistrc
COPY source/client-config/.eslintignore /app/client/.eslintignore
COPY source/client-config/.eslintrc.js /app/client/.eslintrc.js
COPY source/client-config/.npmrc /app/client/.npmrc
COPY source/client-config/.prettierrc /app/client/.prettierrc
COPY source/client-config/postcss.config.js /app/client/postcss.config.js
COPY source/client-config/tsconfig.json /app/client/tsconfig.json
COPY source/client-config/vue.config.js /app/client/vue.config.js
COPY source/client-config/public/ /app/client/public/

# Compatibility-build only:
# Do not let unrelated existing ESLint/Prettier errors block the
# self-contained image construction test.
RUN node -e "const fs=require('fs'); const p='/app/client/vue.config.js'; let s=fs.readFileSync(p,'utf8'); s=s.replace('module.exports = {', 'module.exports = {\\n    lintOnSave: false,'); fs.writeFileSync(p,s);"

WORKDIR /app/client

RUN npm ci

COPY source/client-src/ /app/client/src/

WORKDIR /app

RUN npm run build-server && \
    npm run build-client

# ============================================================
# Stage 3: EPGStation runtime
# ============================================================
FROM node:16.13.1-bullseye-slim

WORKDIR /app

USER root

RUN printf '%s\n' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye main non-free' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20260824T000000Z bullseye-security main non-free' \
    'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20260824T000000Z bullseye-updates main non-free' \
    > /etc/apt/sources.list && \
    apt-get \
        -o Acquire::http::No-Cache=true \
        -o Acquire::http::Pipeline-Depth=0 \
        update && \
    apt-get install -y --no-install-recommends \
        i965-va-driver-shaders \
        intel-media-va-driver \
        libva-drm2 \
        libva2 \
    && rm -rf /var/lib/apt/lists/*

# EPGStation runtime.
COPY --from=epgstation-builder /app/package.json /app/package.json
COPY --from=epgstation-builder /app/package-lock.json /app/package-lock.json
COPY --from=epgstation-builder /app/node_modules /app/node_modules
COPY --from=epgstation-builder /app/dist /app/dist
COPY --from=epgstation-builder /app/client/dist /app/client/dist
COPY --from=epgstation-builder /app/api.yml /app/api.yml
COPY --from=epgstation-builder /app/api.d.ts /app/api.d.ts
COPY --from=epgstation-builder /app/ormconfig.js /app/ormconfig.js

# FFmpeg 7 and TS repair tools.
COPY --from=ffmpeg-builder \
    /opt/ffmpeg-7.0.2 \
    /opt/ffmpeg-7.0.2

RUN ln -sf /opt/ffmpeg-7.0.2/bin/ffmpeg /usr/local/bin/ffmpeg && \
    ln -sf /opt/ffmpeg-7.0.2/bin/ffprobe /usr/local/bin/ffprobe

# Verify FFmpeg 7 and TS repair tools.
# Verify both the installed path and the PATH/symlink path used by EPGStation.
RUN "/opt/ffmpeg-7.0.2/bin/ffmpeg" -version && \
    "/opt/ffmpeg-7.0.2/bin/ffprobe" -version && \
    ffmpeg -version && \
    ffprobe -version && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-timeline-remux 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/audio-repair 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/video-repair 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-repair 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-health-check 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:'

EXPOSE 8888

CMD ["npm", "start"]

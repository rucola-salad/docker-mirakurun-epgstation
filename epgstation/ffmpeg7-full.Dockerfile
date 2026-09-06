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
COPY ts-repair/ts-health-check.c /tmp/ts-health-check.c
COPY ts-repair/ts-video-timeline.c /tmp/ts-video-timeline.c

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra \
       /tmp/ts-timeline-remux.c \
       -o "${FFMPEG_PREFIX}/bin/ts-timeline-remux.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil)

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra \
       /tmp/ts-health-check.c \
       -o "${FFMPEG_PREFIX}/bin/ts-health-check.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil)

RUN PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
    cc -O2 -Wall -Wextra \
       /tmp/ts-video-timeline.c \
       -o "${FFMPEG_PREFIX}/bin/ts-video-timeline.real" \
       $(PKG_CONFIG_PATH="${FFMPEG_PREFIX}/lib/pkgconfig" \
         pkg-config --cflags --libs libavformat libavcodec libavutil)

# Collect runtime shared libraries
RUN mkdir -p "${FFMPEG_PREFIX}/lib/runtime" && \
    { \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffmpeg"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffprobe"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ts-timeline-remux.real"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ts-health-check.real"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ts-video-timeline.real"; \
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
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ffmpeg.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ffmpeg" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ffmpeg"

# ffprobe wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
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

# ts-health-check wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ts-health-check.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ts-health-check" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ts-health-check"

# ts-video-timeline wrapper
RUN printf '%s\n' \
    '#!/bin/sh' \
    'SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
    'PREFIX="$(dirname "$SELF_DIR")"' \
    'export LD_LIBRARY_PATH="$PREFIX/lib/runtime${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"' \
    'exec "$SELF_DIR/ts-video-timeline.real" "$@"' \
    > "${FFMPEG_PREFIX}/bin/ts-video-timeline" && \
    chmod 755 "${FFMPEG_PREFIX}/bin/ts-video-timeline"

# Builder verification
RUN "${FFMPEG_PREFIX}/bin/ffmpeg" -version && \
    "${FFMPEG_PREFIX}/bin/ffprobe" -version && \
    output="$("${FFMPEG_PREFIX}/bin/ts-timeline-remux" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/ts-health-check" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$("${FFMPEG_PREFIX}/bin/ts-video-timeline" 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:'

# ============================================================
# Stage 2: EPGStation
# ============================================================
FROM epgstation-v2:custom-test

USER root

COPY --from=ffmpeg-builder \
    /opt/ffmpeg-7.0.2 \
    /opt/ffmpeg-7.0.2

# Keep existing /usr/local/bin/ffmpeg 4.2.4 untouched
RUN "/opt/ffmpeg-7.0.2/bin/ffmpeg" -version && \
    "/opt/ffmpeg-7.0.2/bin/ffprobe" -version && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-timeline-remux 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-health-check 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:' && \
    output="$(/opt/ffmpeg-7.0.2/bin/ts-video-timeline 2>&1 || true)" && \
    printf '%s\n' "$output" && \
    printf '%s\n' "$output" | grep '^Usage:'

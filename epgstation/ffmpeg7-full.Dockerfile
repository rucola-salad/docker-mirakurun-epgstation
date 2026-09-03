# ============================================================
# Stage 1: Build FFmpeg 7.0.2
# ============================================================
FROM debian:11-slim AS ffmpeg-builder

ARG FFMPEG_VERSION=7.0.2
ARG FFMPEG_PREFIX=/opt/ffmpeg-${FFMPEG_VERSION}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
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

# Collect runtime shared libraries
RUN mkdir -p "${FFMPEG_PREFIX}/lib/runtime" && \
    { \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffmpeg"; \
        lddtree -l "${FFMPEG_PREFIX}/bin/ffprobe"; \
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

# Builder verification
RUN "${FFMPEG_PREFIX}/bin/ffmpeg" -version && \
    "${FFMPEG_PREFIX}/bin/ffprobe" -version

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
    "/opt/ffmpeg-7.0.2/bin/ffprobe" -version

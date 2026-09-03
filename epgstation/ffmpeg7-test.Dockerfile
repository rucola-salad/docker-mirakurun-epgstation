# ------------------------------------------------------------
# Stage 1: Debian 11 で FFmpeg 7.0.2 + VAAPI をビルド
# ------------------------------------------------------------
FROM debian:11-slim AS ffmpeg-builder

ARG FFMPEG_VERSION=7.0.2
ARG FFMPEG_PREFIX=/opt/ffmpeg-7.0.2

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
      yasm \
      nasm \
      curl \
      ca-certificates \
      xz-utils \
      libva-dev \
      libdrm-dev && \
    mkdir -p /tmp/ffmpeg-build && \
    cd /tmp/ffmpeg-build && \
    curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
      | tar -xJ --strip-components=1 && \
    ./configure \
      --prefix="${FFMPEG_PREFIX}" \
      --enable-vaapi \
      --disable-debug \
      --disable-doc && \
    make -j"$(nproc)" && \
    make install


# ------------------------------------------------------------
# Stage 2: 現在の EPGStation イメージへ FFmpeg 7 だけ追加
# ------------------------------------------------------------
FROM epgstation-v2:custom-test

USER root

COPY --from=ffmpeg-builder \
  /opt/ffmpeg-7.0.2 \
  /opt/ffmpeg-7.0.2

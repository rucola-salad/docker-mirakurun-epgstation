#!/bin/bash
set -eu

INPUT="${INPUT:-${1:-}}"
OUTPUT="${OUTPUT:-${2:-}}"

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
    echo "INPUT or OUTPUT is not specified." >&2
    exit 1
fi

FFMPEG="${FFMPEG:-/opt/ffmpeg-7.0.2/bin/ffmpeg}"
VAAPI_DEVICE="${VAAPI_DEVICE:-/dev/dri/renderD128}"

export LIBVA_DRIVER_NAME=i965

exec "$FFMPEG" \
    -y \
    -vaapi_device "$VAAPI_DEVICE" \
    -dual_mono_mode main \
    -i "$INPUT" \
    -map 0:v:0 \
    -map 0:a:0? \
    -sn \
    -dn \
    -vf "fieldmatch=order=tff,decimate,scale=1280:720:flags=bilinear,format=nv12,hwupload" \
    -c:v h264_vaapi \
    -qp 22 \
    -profile:v high \
    -c:a aac \
    -b:a 128k \
    -ar 48000 \
    -ac 2 \
    -movflags +faststart \
    "$OUTPUT"

#!/bin/bash
set -eu

INPUT="${INPUT:-${1:-}}"
OUTPUT="${OUTPUT:-${2:-}}"

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
    echo "INPUT or OUTPUT is not specified." >&2
    exit 1
fi

FFMPEG="${FFMPEG:-/app/config/ffmpeg-i965.sh}"
VAAPI_DEVICE="${VAAPI_DEVICE:-/dev/dri/renderD128}"

FFPROBE="${FFPROBE:-/opt/ffmpeg-7.0.2/bin/ffprobe}"

FIELD_ORDER="$(
    "$FFPROBE" \
        -v error \
        -select_streams v:0 \
        -show_entries stream=field_order \
        -of default=noprint_wrappers=1:nokey=1 \
        "$INPUT" |
    head -n 1
)"

case "$FIELD_ORDER" in
    progressive)
        VAAPI_FILTER="format=nv12,hwupload,scale_vaapi=w=1920:h=1080"
        ;;
    *)
        VAAPI_FILTER="format=nv12,hwupload,deinterlace_vaapi=rate=field,scale_vaapi=w=1920:h=1080"
        ;;
esac

echo "Input field order: ${FIELD_ORDER:-unknown}" >&2
echo "VAAPI filter: $VAAPI_FILTER" >&2


exec "$FFMPEG" \
    -y \
    -vaapi_device "$VAAPI_DEVICE" \
    -dual_mono_mode main \
    -i "$INPUT" \
    -map 0:v:0 \
    -map 0:a:0? \
    -sn \
    -dn \
    -vf "$VAAPI_FILTER" \
    -c:v h264_vaapi \
    -qp 22 \
    -profile:v high \
    -c:a aac \
    -b:a 128k \
    -ar 48000 \
    -ac 2 \
    -movflags +faststart \
    "$OUTPUT"

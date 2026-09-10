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
HELPER="/app/config/cm-encode-helper.js"

export LIBVA_DRIVER_NAME=i965

META_FILE=""

cleanup()
{
    if [ -n "$META_FILE" ] && [ -f "$META_FILE" ]; then
        rm -f "$META_FILE"
    fi
}

trap cleanup EXIT INT TERM

HELPER_JSON=""

if [ -n "${CM_TIMELINE:-}" ]; then
    HELPER_JSON="$(node "$HELPER")"
fi

if [ -n "$HELPER_JSON" ]; then
    META_FILE="$(mktemp /tmp/epgstation-chapters.XXXXXX.ffmeta)"

    node "$HELPER" \
        --metadata "$META_FILE"

    if [ ! -s "$META_FILE" ]; then
        rm -f "$META_FILE"
        META_FILE=""
    fi
fi

if [ "${CM_CUT:-0}" = "1" ]; then
    if [ -z "$HELPER_JSON" ]; then
        echo "CM_TIMELINE is required for CM cut." >&2
        exit 1
    fi

    CUT_FILTER="$(
        node "$HELPER" --filter
    )"

    if [ -z "$CUT_FILTER" ]; then
        echo "CM cut filter is empty." >&2
        exit 1
    fi

    FILTER_COMPLEX="${CUT_FILTER};[vcut]format=nv12,hwupload,deinterlace_vaapi=rate=field,scale_vaapi=w=1280:h=720[vout]"

    if [ -n "$META_FILE" ]; then
        "$FFMPEG" \
            -y \
            -vaapi_device "$VAAPI_DEVICE" \
            -dual_mono_mode main \
            -i "$INPUT" \
            -f ffmetadata -i "$META_FILE" \
            -filter_complex "$FILTER_COMPLEX" \
            -map '[vout]' \
            -map '[acut]' \
            -map_chapters 1 \
            -sn \
            -dn \
            -c:v h264_vaapi \
            -qp 24 \
            -profile:v high \
            -c:a aac \
            -b:a 128k \
            -ar 48000 \
            -ac 2 \
            -movflags +faststart \
            "$OUTPUT"
    else
        "$FFMPEG" \
            -y \
            -vaapi_device "$VAAPI_DEVICE" \
            -dual_mono_mode main \
            -i "$INPUT" \
            -filter_complex "$FILTER_COMPLEX" \
            -map '[vout]' \
            -map '[acut]' \
            -sn \
            -dn \
            -c:v h264_vaapi \
            -qp 24 \
            -profile:v high \
            -c:a aac \
            -b:a 128k \
            -ar 48000 \
            -ac 2 \
            -movflags +faststart \
            "$OUTPUT"
    fi

elif [ -n "$META_FILE" ]; then
    "$FFMPEG" \
        -y \
        -vaapi_device "$VAAPI_DEVICE" \
        -dual_mono_mode main \
        -i "$INPUT" \
        -f ffmetadata -i "$META_FILE" \
        -map 0:v:0 \
        -map 0:a:0? \
        -map_chapters 1 \
        -sn \
        -dn \
        -vf "format=nv12,hwupload,deinterlace_vaapi=rate=field,scale_vaapi=w=1280:h=720" \
        -c:v h264_vaapi \
        -qp 24 \
        -profile:v high \
        -c:a aac \
        -b:a 128k \
        -ar 48000 \
        -ac 2 \
        -movflags +faststart \
        "$OUTPUT"

else
    "$FFMPEG" \
        -y \
        -vaapi_device "$VAAPI_DEVICE" \
        -dual_mono_mode main \
        -i "$INPUT" \
        -map 0:v:0 \
        -map 0:a:0? \
        -sn \
        -dn \
        -vf "format=nv12,hwupload,deinterlace_vaapi=rate=field,scale_vaapi=w=1280:h=720" \
        -c:v h264_vaapi \
        -qp 24 \
        -profile:v high \
        -c:a aac \
        -b:a 128k \
        -ar 48000 \
        -ac 2 \
        -movflags +faststart \
        "$OUTPUT"
fi

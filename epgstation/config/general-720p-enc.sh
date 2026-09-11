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
HELPER="/app/config/cm-encode-helper.js"
SUBTITLE_HELPER="/app/config/cm-subtitle-helper.js"
SUBTITLE_FFMPEG="${SUBTITLE_FFMPEG:-/opt/ffmpeg-7.0.2/bin/ffmpeg}"

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
        VAAPI_FILTER="format=nv12,hwupload,scale_vaapi=w=1280:h=720"
        ;;
    *)
        VAAPI_FILTER="format=nv12,hwupload,deinterlace_vaapi=rate=field,scale_vaapi=w=1280:h=720"
        ;;
esac

echo "Input field order: ${FIELD_ORDER:-unknown}" >&2
echo "VAAPI filter: $VAAPI_FILTER" >&2

META_FILE=""
SUBTITLE_TEMP_FILES=()
CM_SUBTITLE_FILES=()
SUBTITLE_INPUT_ARGS=()
SUBTITLE_MAP_ARGS=()

cleanup()
{
    if [ -n "$META_FILE" ] && [ -f "$META_FILE" ]; then
        rm -f "$META_FILE"
    fi

    local subtitle_file

    for subtitle_file in "${SUBTITLE_TEMP_FILES[@]}"; do
        if [ -f "$subtitle_file" ]; then
            rm -f "$subtitle_file"
        fi
    done
}

trap cleanup EXIT INT TERM

prepare_cm_subtitles()
{
    local format_start
    local subtitle_count
    local subtitle_index
    local subtitle_first_abs
    local subtitle_offset
    local raw_file
    local cut_file

    CM_SUBTITLE_FILES=()

    format_start="$(
        "$FFPROBE" \
            -v error \
            -show_entries format=start_time \
            -of default=noprint_wrappers=1:nokey=1 \
            "$INPUT" 2>/dev/null |
        head -n 1
    )"

    if [ -z "$format_start" ] || [ "$format_start" = "N/A" ]; then
        format_start=0
    fi

    subtitle_count="$(
        "$FFPROBE" \
            -v error \
            -select_streams s \
            -show_entries stream=index \
            -of csv=p=0 \
            "$INPUT" 2>/dev/null |
        awk -F, '
            /^[0-9]+/ {
                seen[$1] = 1
            }
            END {
                print length(seen)
            }
        '
    )"

    echo "CM subtitle stream count: $subtitle_count" >&2

    for ((subtitle_index = 0;
          subtitle_index < subtitle_count;
          subtitle_index++)); do

        subtitle_first_abs="$(
            set +o pipefail
            "$FFPROBE" \
                -v error \
                -select_streams "s:${subtitle_index}" \
                -show_packets \
                -show_entries packet=pts_time \
                -of csv=p=0 \
                "$INPUT" 2>/dev/null |
            sed -n '1{s/,.*//;p;q}'
        )"

        if [ -z "$subtitle_first_abs" ]; then
            echo \
                "CM subtitle ${subtitle_index}: first PTS not found; skip." \
                >&2
            continue
        fi

        raw_file="$(
            mktemp \
                "/tmp/epgstation-cm-subtitle-${subtitle_index}.raw.XXXXXX.srt"
        )"

        cut_file="$(
            mktemp \
                "/tmp/epgstation-cm-subtitle-${subtitle_index}.cut.XXXXXX.srt"
        )"

        SUBTITLE_TEMP_FILES+=(
            "$raw_file"
            "$cut_file"
        )

        echo \
            "CM subtitle ${subtitle_index}: extracting ARIB/subtitle to SRT" \
            >&2

        "$SUBTITLE_FFMPEG" \
            -hide_banner \
            -loglevel warning \
            -y \
            -fix_sub_duration \
            -i "$INPUT" \
            -map "0:s:${subtitle_index}" \
            -vn \
            -an \
            -dn \
            -c:s srt \
            "$raw_file"

        subtitle_offset="$(
            awk \
                -v subtitle_first="$subtitle_first_abs" \
                -v format_start="$format_start" \
                -v video_start="$CM_VIDEO_START_TIME" \
                'BEGIN {
                    printf "%.9f",
                        (subtitle_first - format_start) - video_start
                }'
        )"

        echo \
            "CM subtitle ${subtitle_index}: offset=${subtitle_offset}s" \
            >&2

        node "$SUBTITLE_HELPER" \
            "$raw_file" \
            "$cut_file" \
            "$subtitle_offset"

        if [ -s "$cut_file" ]; then
            CM_SUBTITLE_FILES+=("$cut_file")
        else
            echo \
                "CM subtitle ${subtitle_index}: no visible captions in keepRanges." \
                >&2
        fi
    done
}

build_cm_subtitle_mux_args()
{
    local first_input_index="$1"
    local input_index="$first_input_index"
    local subtitle_file

    SUBTITLE_INPUT_ARGS=()
    SUBTITLE_MAP_ARGS=()

    for subtitle_file in "${CM_SUBTITLE_FILES[@]}"; do
        SUBTITLE_INPUT_ARGS+=(
            "-i"
            "$subtitle_file"
        )

        SUBTITLE_MAP_ARGS+=(
            "-map"
            "${input_index}:s:0"
        )

        input_index=$((input_index + 1))
    done
}

HELPER_JSON=""

if [ "${CM_CUT:-0}" = "1" ]; then
    CM_AUDIO_STREAM_COUNT="$(
        "$FFPROBE" \
            -v error \
            -select_streams a \
            -show_entries stream=index \
            -of csv=p=0 \
            "$INPUT" 2>/dev/null |
        awk -F, '
            /^[0-9]+/ {
                seen[$1] = 1
            }
            END {
                print length(seen)
            }
        '
    )"

    export CM_AUDIO_STREAM_COUNT

    AUDIO_MAP_ARGS=()
    for ((audio_index = 0; audio_index < CM_AUDIO_STREAM_COUNT; audio_index++)); do
        AUDIO_MAP_ARGS+=("-map" "[acut${audio_index}]")
    done

    echo "CM audio stream count: $CM_AUDIO_STREAM_COUNT" >&2

    CM_VIDEO_START_TIME="$(
        "$FFMPEG" \
            -hide_banner \
            -loglevel info \
            -i "$INPUT" \
            -map 0:v:0 \
            -vf showinfo \
            -frames:v 1 \
            -an \
            -f null - \
            2>&1 |
        sed -n \
            's/.*n:[[:space:]]*0[[:space:]].*pts_time:\([^ ]*\).*/\1/p' |
        head -n 1
    )"

    if [ -z "$CM_VIDEO_START_TIME" ]; then
        echo "Failed to determine first decoded video frame PTS." >&2
        exit 1
    fi

    export CM_VIDEO_START_TIME

    echo "CM video first frame PTS: $CM_VIDEO_START_TIME" >&2
fi

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

    prepare_cm_subtitles

    FILTER_COMPLEX="${CUT_FILTER};[vcut]${VAAPI_FILTER}[vout]"

    if [ -n "$META_FILE" ]; then
        build_cm_subtitle_mux_args 2

        "$FFMPEG" \
            -y \
            -vaapi_device "$VAAPI_DEVICE" \
            -dual_mono_mode main \
            -i "$INPUT" \
            -f ffmetadata -i "$META_FILE" \
            "${SUBTITLE_INPUT_ARGS[@]}" \
            -filter_complex "$FILTER_COMPLEX" \
            -map '[vout]' \
            "${AUDIO_MAP_ARGS[@]}" \
            "${SUBTITLE_MAP_ARGS[@]}" \
            -map_chapters 1 \
            -dn \
            -c:v h264_vaapi \
            -qp 24 \
            -profile:v high \
            -r 60000/1001 \
            -c:a aac \
            -b:a 128k \
            -ar 48000 \
            -ac 2 \
            -c:s mov_text \
            -movflags +faststart \
            "$OUTPUT"
    else
        build_cm_subtitle_mux_args 1

        "$FFMPEG" \
            -y \
            -vaapi_device "$VAAPI_DEVICE" \
            -dual_mono_mode main \
            -i "$INPUT" \
            "${SUBTITLE_INPUT_ARGS[@]}" \
            -filter_complex "$FILTER_COMPLEX" \
            -map '[vout]' \
            "${AUDIO_MAP_ARGS[@]}" \
            "${SUBTITLE_MAP_ARGS[@]}" \
            -dn \
            -c:v h264_vaapi \
            -qp 24 \
            -profile:v high \
            -r 60000/1001 \
            -c:a aac \
            -b:a 128k \
            -ar 48000 \
            -ac 2 \
            -c:s mov_text \
            -movflags +faststart \
            "$OUTPUT"
    fi

elif [ -n "$META_FILE" ]; then
    "$FFMPEG" \
        -y \
        -vaapi_device "$VAAPI_DEVICE" \
        -dual_mono_mode main \
        -fix_sub_duration \
        -i "$INPUT" \
        -f ffmetadata -i "$META_FILE" \
        -map 0:v:0 \
        -map 0:a? \
        -map 0:s? \
        -map_chapters 1 \
        -dn \
        -vf "$VAAPI_FILTER" \
        -c:v h264_vaapi \
        -qp 24 \
        -profile:v high \
        -c:a aac \
        -b:a 128k \
        -ar 48000 \
        -ac 2 \
        -c:s mov_text \
        -movflags +faststart \
        "$OUTPUT"

else
    "$FFMPEG" \
        -y \
        -vaapi_device "$VAAPI_DEVICE" \
        -dual_mono_mode main \
        -fix_sub_duration \
        -i "$INPUT" \
        -map 0:v:0 \
        -map 0:a? \
        -map 0:s? \
        -dn \
        -vf "$VAAPI_FILTER" \
        -c:v h264_vaapi \
        -qp 24 \
        -profile:v high \
        -c:a aac \
        -b:a 128k \
        -ar 48000 \
        -ac 2 \
        -c:s mov_text \
        -movflags +faststart \
        "$OUTPUT"
fi

#!/bin/bash

set -Eeuo pipefail

FFMPEG_BIN="${FFMPEG_BIN:-/opt/ffmpeg-7.0.2/bin/ffmpeg}"
FFPROBE_BIN="${FFPROBE_BIN:-/opt/ffmpeg-7.0.2/bin/ffprobe}"
VIDEO_REPAIR_BIN="${VIDEO_REPAIR_BIN:-/opt/ffmpeg-7.0.2/bin/video-repair}"
AUDIO_REPAIR_BIN="${AUDIO_REPAIR_BIN:-/opt/ffmpeg-7.0.2/bin/audio-repair}"
TIMELINE_REMUX_BIN="${TIMELINE_REMUX_BIN:-/opt/ffmpeg-7.0.2/bin/ts-timeline-remux}"

usage()
{
    echo "Usage: $0 input.ts output.ts work-dir" >&2
}

log()
{
    printf '%s %s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$*" >&2
}

fail()
{
    log "ERROR: $*"
    exit 1
}

check_command()
{
    [ -x "$1" ] || fail "not executable: $1"
}

free_kb()
{
    df -Pk "$1" | awk 'NR == 2 { print $4 }'
}

device_name()
{
    df -P "$1" | awk 'NR == 2 { print $1 }'
}

if [ "$#" -ne 3 ]; then
    usage
    exit 2
fi

INPUT="$1"
OUTPUT="$2"
WORK_DIR="$3"

[ -f "$INPUT" ] ||
    fail "input does not exist: $INPUT"

[ ! -e "$OUTPUT" ] ||
    fail "output already exists: $OUTPUT"

OUTPUT_DIR="$(dirname "$OUTPUT")"

[ -d "$OUTPUT_DIR" ] ||
    fail "output directory does not exist: $OUTPUT_DIR"

[ ! -e "$WORK_DIR" ] ||
    fail "work directory already exists: $WORK_DIR"

check_command "$FFMPEG_BIN"
check_command "$FFPROBE_BIN"
check_command "$VIDEO_REPAIR_BIN"
check_command "$AUDIO_REPAIR_BIN"
check_command "$TIMELINE_REMUX_BIN"

#
# Capacity guard.
#
# TS Repair temporarily needs:
#
#   repaired MPEG-2 video
#   timeline map
#   repaired raw audio
#   repaired A/V TS
#   final repaired TS
#
# Never begin a repair when free space is marginal.
#
INPUT_BYTES="$(stat -c '%s' "$INPUT")"
INPUT_KB=$(( (INPUT_BYTES + 1023) / 1024 ))

WORK_PARENT="$(dirname "$WORK_DIR")"

[ -d "$WORK_PARENT" ] ||
    fail "work parent does not exist: $WORK_PARENT"

WORK_DEVICE="$(device_name "$WORK_PARENT")"
OUTPUT_DEVICE="$(device_name "$OUTPUT_DIR")"

WORK_FREE_KB="$(free_kb "$WORK_PARENT")"
OUTPUT_FREE_KB="$(free_kb "$OUTPUT_DIR")"

MIN_20G_KB=$((20 * 1024 * 1024))
MIN_10G_KB=$((10 * 1024 * 1024))

#
# Conservative estimates.
#
WORK_REQUIRED_KB=$((INPUT_KB * 5))
OUTPUT_REQUIRED_KB=$((INPUT_KB * 3))

if [ "$WORK_REQUIRED_KB" -lt "$MIN_20G_KB" ]; then
    WORK_REQUIRED_KB="$MIN_20G_KB"
fi

if [ "$OUTPUT_REQUIRED_KB" -lt "$MIN_10G_KB" ]; then
    OUTPUT_REQUIRED_KB="$MIN_10G_KB"
fi

if [ "$WORK_DEVICE" = "$OUTPUT_DEVICE" ]; then
    REQUIRED_KB=$((WORK_REQUIRED_KB + OUTPUT_REQUIRED_KB))

    [ "$WORK_FREE_KB" -ge "$REQUIRED_KB" ] ||
        fail "insufficient free space on shared work/output filesystem: free=${WORK_FREE_KB}KB required=${REQUIRED_KB}KB"
else
    [ "$WORK_FREE_KB" -ge "$WORK_REQUIRED_KB" ] ||
        fail "insufficient work free space: free=${WORK_FREE_KB}KB required=${WORK_REQUIRED_KB}KB"

    [ "$OUTPUT_FREE_KB" -ge "$OUTPUT_REQUIRED_KB" ] ||
        fail "insufficient output free space: free=${OUTPUT_FREE_KB}KB required=${OUTPUT_REQUIRED_KB}KB"
fi

log "capacity check passed"
log "input=${INPUT}"
log "output=${OUTPUT}"
log "work=${WORK_DIR}"
log "work_free_kb=${WORK_FREE_KB}"
log "output_free_kb=${OUTPUT_FREE_KB}"

mkdir "$WORK_DIR"

VIDEO="$WORK_DIR/repaired-video.m2v"
MAP="$WORK_DIR/video.map"
AUDIO_DIR="$WORK_DIR/audio"
AV_TS="$WORK_DIR/repaired-av.ts"
OUTPUT_PART="${OUTPUT}.ts-repair-part"

[ ! -e "$OUTPUT_PART" ] ||
    fail "transaction output already exists: $OUTPUT_PART"

mkdir "$AUDIO_DIR"

#
# Determine source audio layout before repair.
#
mapfile -t AUDIO_INFO < <(
    "$FFPROBE_BIN" \
        -v error \
        -select_streams a \
        -show_entries stream=index,sample_rate,channels \
        -of csv=p=0 \
        "$INPUT"
)

[ "${#AUDIO_INFO[@]}" -gt 0 ] ||
    fail "no audio streams found"

SUBTITLE_COUNT="$(
    "$FFPROBE_BIN" \
        -v error \
        -select_streams s \
        -show_entries stream=index \
        -of csv=p=0 \
        "$INPUT" |
    awk 'NF { n++ } END { print n + 0 }'
)"

log "audio_streams=${#AUDIO_INFO[@]} subtitles=${SUBTITLE_COUNT}"

#
# 1. Video repair
#
log "video repair start"

"$VIDEO_REPAIR_BIN" \
    "$INPUT" \
    "$VIDEO" \
    "$MAP" \
    2>&1 |
tee "$WORK_DIR/video-repair.log"

log "video repair finished"

[ -s "$VIDEO" ] ||
    fail "video repair produced no video"

[ -s "$MAP" ] ||
    fail "video repair produced no timeline map"

#
# 2. Audio repair
#
log "audio repair start"

"$AUDIO_REPAIR_BIN" \
    "$INPUT" \
    "$MAP" \
    "$AUDIO_DIR" \
    2>&1 |
tee "$WORK_DIR/audio-repair.log"

log "audio repair finished"

#
# 3. Build repaired A/V TS.
#
# Each original audio stream is kept as an independent output stream.
# Mono and stereo are supported explicitly.  Unknown multichannel
# layouts are rejected rather than silently producing a wrong layout.
#
FFMPEG_ARGS=(
    -hide_banner
    -y
    -f mpegvideo
    -i "$VIDEO"
)

FILTERS=()
MAP_ARGS=(
    -map 0:v:0
)

AUDIO_OUTPUT_INDEX=0
INPUT_INDEX=1

for INFO in "${AUDIO_INFO[@]}"; do
    IFS=',' read -r STREAM_INDEX SAMPLE_RATE CHANNELS <<< "$INFO"

    [ -n "$STREAM_INDEX" ] ||
        fail "invalid audio stream information: $INFO"

    [ -n "$SAMPLE_RATE" ] ||
        fail "missing sample rate for stream=$STREAM_INDEX"

    [ -n "$CHANNELS" ] ||
        fail "missing channel count for stream=$STREAM_INDEX"

    case "$CHANNELS" in
        1)
            AUDIO_FILE="$AUDIO_DIR/audio-${STREAM_INDEX}-ch-0.f32p"

            [ -s "$AUDIO_FILE" ] ||
                fail "missing repaired audio: $AUDIO_FILE"

            FFMPEG_ARGS+=(
                -f f32le
                -ar "$SAMPLE_RATE"
                -ac 1
                -i "$AUDIO_FILE"
            )

            MAP_ARGS+=(
                -map "${INPUT_INDEX}:a:0"
            )

            INPUT_INDEX=$((INPUT_INDEX + 1))
            ;;

        2)
            LEFT="$AUDIO_DIR/audio-${STREAM_INDEX}-ch-0.f32p"
            RIGHT="$AUDIO_DIR/audio-${STREAM_INDEX}-ch-1.f32p"

            [ -s "$LEFT" ] ||
                fail "missing repaired audio: $LEFT"

            [ -s "$RIGHT" ] ||
                fail "missing repaired audio: $RIGHT"

            LEFT_INPUT="$INPUT_INDEX"

            FFMPEG_ARGS+=(
                -f f32le
                -ar "$SAMPLE_RATE"
                -ac 1
                -i "$LEFT"
            )

            INPUT_INDEX=$((INPUT_INDEX + 1))
            RIGHT_INPUT="$INPUT_INDEX"

            FFMPEG_ARGS+=(
                -f f32le
                -ar "$SAMPLE_RATE"
                -ac 1
                -i "$RIGHT"
            )

            INPUT_INDEX=$((INPUT_INDEX + 1))

            LABEL="repaired_a${AUDIO_OUTPUT_INDEX}"

            FILTERS+=(
                "[${LEFT_INPUT}:a][${RIGHT_INPUT}:a]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[${LABEL}]"
            )

            MAP_ARGS+=(
                -map "[${LABEL}]"
            )
            ;;

        *)
            fail "unsupported repaired audio channel count: stream=${STREAM_INDEX} channels=${CHANNELS}"
            ;;
    esac

    AUDIO_OUTPUT_INDEX=$((AUDIO_OUTPUT_INDEX + 1))
done

if [ "${#FILTERS[@]}" -gt 0 ]; then
    FILTER_COMPLEX="$(IFS=';'; echo "${FILTERS[*]}")"

    FFMPEG_ARGS+=(
        -filter_complex "$FILTER_COMPLEX"
    )
fi

FFMPEG_ARGS+=(
    "${MAP_ARGS[@]}"
    -c:v copy
    -c:a aac
    -b:a 192k
)

#
# When there are no subtitles, the A/V mux itself can be the
# transactional final output.  Avoid creating another multi-GB copy.
#
if [ "$SUBTITLE_COUNT" -eq 0 ]; then
    MUX_OUTPUT="$OUTPUT_PART"
else
    MUX_OUTPUT="$AV_TS"
fi

FFMPEG_ARGS+=(
    -f mpegts
    "$MUX_OUTPUT"
)

log "A/V mux start"

"$FFMPEG_BIN" \
    "${FFMPEG_ARGS[@]}" \
    2>&1 |
tee "$WORK_DIR/av-mux.log"

log "A/V mux finished"

[ -s "$MUX_OUTPUT" ] ||
    fail "A/V mux produced no output"

#
# 4. Subtitle repair.
#
if [ "$SUBTITLE_COUNT" -gt 0 ]; then
    log "subtitle repair/remux start"

    "$TIMELINE_REMUX_BIN" \
        --media "$AV_TS" \
        --source "$INPUT" \
        --map "$MAP" \
        --output "$OUTPUT_PART" \
        2>&1 |
    tee "$WORK_DIR/subtitle-remux.log"

    log "subtitle repair/remux finished"

    [ -s "$OUTPUT_PART" ] ||
        fail "subtitle remux produced no output"
else
    log "no subtitle stream; subtitle remux skipped"
fi

#
# Transaction commit.
#
# OUTPUT was checked not to exist before the job.  Only a completely
# successful repair becomes the visible final output.
#
mv "$OUTPUT_PART" "$OUTPUT"

log "TS repair completed: $OUTPUT"
log "work files retained: $WORK_DIR"

exit 0

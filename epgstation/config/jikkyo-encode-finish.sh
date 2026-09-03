#!/bin/bash
set -eu

LOG="/app/logs/jikkyo-encode-finish.log"

{
    echo "========================================"
    echo "$(date '+%Y-%m-%d %H:%M:%S') start"
    echo "RECORDEDID=${RECORDEDID:-}"
    echo "VIDEOFILEID=${VIDEOFILEID:-}"
    echo "OUTPUTPATH=${OUTPUTPATH:-}"
    echo "MODE=${MODE:-}"
    echo "CHANNELNAME=${CHANNELNAME:-}"
} >> "$LOG"

if [ -z "${OUTPUTPATH:-}" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') OUTPUTPATH is empty" >> "$LOG"
    exit 0
fi

case "$OUTPUTPATH" in
    *-anime.mp4)
        SOURCE_XML="${OUTPUTPATH%-anime.mp4}.xml"
        ;;
    *-720p60.mp4)
        SOURCE_XML="${OUTPUTPATH%-720p60.mp4}.xml"
        ;;
    *-1080p60.mp4)
        SOURCE_XML="${OUTPUTPATH%-1080p60.mp4}.xml"
        ;;
    *.mp4)
        SOURCE_XML="${OUTPUTPATH%.mp4}.xml"
        ;;
    *)
        echo "$(date '+%Y-%m-%d %H:%M:%S') unsupported output: $OUTPUTPATH" >> "$LOG"
        exit 0
        ;;
esac

DEST_XML="${OUTPUTPATH%.*}.xml"

if [ "$SOURCE_XML" = "$DEST_XML" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') source and destination are same: $DEST_XML" >> "$LOG"
    exit 0
fi

if [ -e "$DEST_XML" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') skip existing: $DEST_XML" >> "$LOG"
    exit 0
fi

if [ ! -f "$SOURCE_XML" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') source xml not found: $SOURCE_XML" >> "$LOG"
    exit 0
fi

cp "$SOURCE_XML" "$DEST_XML"

COUNT="$(grep -c '<chat ' "$DEST_XML" || true)"

echo "$(date '+%Y-%m-%d %H:%M:%S') created: $DEST_XML comments=$COUNT" >> "$LOG"

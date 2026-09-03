#!/bin/bash

set -u

LOG=/app/logs/recording-finish.log
CM_ANALYZER_URL="${CM_ANALYZER_URL:-http://cm-analyzer:8080/analyze}"

log()
{
    printf '%s %s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$*" >> "$LOG"
}

json_escape()
{
    node -e '
const s = process.argv[1] || "";
process.stdout.write(JSON.stringify(s));
' "$1"
}

RECORDED_ID="${RECORDEDID:-}"
REC_PATH="${RECPATH:-}"
CHANNEL_NAME="${CHANNELNAME:-}"
TITLE="${NAME:-}"

log "recording finish start recordedId=${RECORDED_ID} recPath=${REC_PATH}"

#
# 既存の実況コメント取得
#
if [ -x /app/config/jikkyo-fetch.sh ]; then
    log "jikkyo-fetch start recordedId=${RECORDED_ID}"
    /app/config/jikkyo-fetch.sh
    log "jikkyo-fetch finished recordedId=${RECORDED_ID}"
else
    log "jikkyo-fetch.sh not executable"
fi

#
# CM解析要求
#
if [ -z "$RECORDED_ID" ] || [ -z "$REC_PATH" ]; then
    log "cm-analyzer skipped: RECORDEDID or RECPATH is empty"
    exit 0
fi

RECORDED_ID_JSON=$(json_escape "$RECORDED_ID")
REC_PATH_JSON=$(json_escape "$REC_PATH")
CHANNEL_NAME_JSON=$(json_escape "$CHANNEL_NAME")
TITLE_JSON=$(json_escape "$TITLE")

BODY=$(cat <<JSON
{
  "recordedId": ${RECORDED_ID_JSON},
  "recPath": ${REC_PATH_JSON},
  "channelName": ${CHANNEL_NAME_JSON},
  "title": ${TITLE_JSON}
}
JSON
)

node - "$CM_ANALYZER_URL" "$BODY" >> "$LOG" 2>&1 <<'NODE' &
const http = require('http');

const url = new URL(process.argv[2]);
const body = process.argv[3];

const req = http.request({
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    },
}, res => {
    let data = '';

    res.on('data', chunk => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(
            new Date().toISOString(),
            'cm-analyzer response',
            'status=' + res.statusCode,
            data
        );
    });
});

req.on('error', err => {
    console.error(
        new Date().toISOString(),
        'cm-analyzer request error',
        err
    );
});

req.end(body);
NODE

log "cm-analyzer request started recordedId=${RECORDED_ID}"

exit 0

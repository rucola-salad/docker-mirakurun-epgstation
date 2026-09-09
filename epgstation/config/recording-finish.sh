#!/bin/bash

set -u

LOG=/app/logs/recording-finish.log

log()
{
    printf '%s %s\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" \
        "$*" >> "$LOG"
}

#
# CM解析について
#
# 録画直後の自動エンコードとの実行順を保証するため、
# CM Analyzer への解析要求と完了待ちは EPGStation 側の
# waitForRecordingChapterAnalysis() で解析完了を確認してから
# その録画の自動エンコードを投入する。
#
# この recording-finish.sh では実況コメント取得のみを行う。
#

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

exit 0

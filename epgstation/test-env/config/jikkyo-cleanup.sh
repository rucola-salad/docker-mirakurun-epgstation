#!/bin/bash
set -eu

ROOT="${1:-/app/recorded}"
MODE="${2:-check}"

CACHE_DIR="${JIKKYO_CACHE_DIR:-/app/data/jikkyo-cache}"
EPGSTATION="${EPGSTATION_URL:-http://127.0.0.1:8888}"

if [ ! -d "$ROOT" ]; then
    echo "directory not found: $ROOT" >&2
    exit 1
fi

#
# 録画フォルダ内の孤立XML
#
find "$ROOT" \
  -type f \
  -name '*.xml' \
  ! -name '*.jikkyo.tmp.xml' \
  -print0 |
while IFS= read -r -d '' XML; do
    BASE="${XML%.xml}"

    HAS_MEDIA=0

    #
    # 同じ basename の実ファイルが1つでも存在すれば、
    # 実況XMLは孤立していないものとして残す。
    #
    # 拡張子は固定しない。
    # XML自身および実況XML一時ファイルは対象外。
    #
    while IFS= read -r -d '' MEDIA; do
        #
        # basename が完全一致する sidecar 群だけを見る。
        # ファイル名中の [, ], ?, * などを glob として
        # 解釈させないため、find -name では絞り込まない。
        #
        case "$MEDIA" in
            "$BASE".*)
                ;;
            *)
                continue
                ;;
        esac

        case "$MEDIA" in
            *.xml|*.jikkyo.tmp.xml)
                continue
                ;;
        esac

        HAS_MEDIA=1
        break
    done < <(
        find "$(dirname "$BASE")" \
          -maxdepth 1 \
          -type f \
          -print0
    )

    if [ "$HAS_MEDIA" -eq 1 ]; then
        continue
    fi

    echo "[ORPHAN] $XML"

    if [ "$MODE" = "--delete" ]; then
        rm -- "$XML"
        echo "[DELETE] $XML"
    fi
done

#
# jikkyo-cache の孤立キャッシュ
#
if [ -d "$CACHE_DIR" ]; then
    /usr/local/bin/node - "$CACHE_DIR" "$EPGSTATION" "$MODE" <<'NODE'
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const cacheDir = process.argv[2];
const epgstation = process.argv[3];
const mode = process.argv[4];

function checkRecorded(recordedId) {
    return new Promise((resolve, reject) => {
        const url =
            `${epgstation}/api/recorded/${recordedId}` +
            '?isHalfWidth=false';

        const client = url.startsWith('https:') ? https : http;

        const req = client.get(url, res => {
            res.resume();

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve('exists');
                    return;
                }

                if (res.statusCode === 404) {
                    resolve('missing');
                    return;
                }

                reject(
                    new Error(
                        `HTTP ${res.statusCode} recordedId=${recordedId}`
                    )
                );
            });
        });

        req.on('error', reject);
    });
}

(async () => {
    const entries = fs.readdirSync(cacheDir);

    const ids = new Set();

    for (const name of entries) {
        let match = name.match(/^(\d+)\.xml$/);

        if (!match) {
            match = name.match(/^(\d+)\.timing\.json$/);
        }

        if (match) {
            ids.add(match[1]);
        }
    }

    const sortedIds = Array.from(ids)
        .sort((a, b) => Number(a) - Number(b));

    for (const recordedId of sortedIds) {
        let state;

        try {
            state = await checkRecorded(recordedId);
        } catch (e) {
            console.error(
                `[CACHE-CHECK-ERROR] recordedId=${recordedId}: ${e.message}`
            );
            continue;
        }

        if (state !== 'missing') {
            continue;
        }

        const targets = [
            path.join(cacheDir, `${recordedId}.xml`),
            path.join(cacheDir, `${recordedId}.timing.json`),
        ];

        for (const target of targets) {
            if (!fs.existsSync(target)) {
                continue;
            }

            console.log(`[CACHE-ORPHAN] ${target}`);

            if (mode === '--delete') {
                fs.unlinkSync(target);
                console.log(`[CACHE-DELETE] ${target}`);
            }
        }
    }
})().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});
NODE
fi

exit 0

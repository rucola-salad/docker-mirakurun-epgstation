#!/bin/bash
set -eu

PAGE_SIZE="${1:-100}"
MAX_COUNT="${2:-0}"

exec /usr/local/bin/node - "$PAGE_SIZE" "$MAX_COUNT" <<'NODE'
'use strict';

const http = require('http');
const { spawnSync } = require('child_process');

const pageSize = Number(process.argv[2] || 100);
const maxCount = Number(process.argv[3] || 0);
const base = 'http://127.0.0.1:8888';

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = '';

            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

(async () => {
    let offset = 0;
    let total = null;
    let processed = 0;
    let errors = 0;

    while (total === null || offset < total) {
        const url =
            `${base}/api/recorded` +
            `?offset=${offset}` +
            `&limit=${pageSize}` +
            `&isHalfWidth=false`;

        const data = await get(url);

        if (!Array.isArray(data.records)) {
            throw new Error('records is not an array');
        }

        if (total === null) {
            total = Number(data.total || 0);
            console.log(`TOTAL=${total}`);
        }

        if (data.records.length === 0) {
            break;
        }

        console.log(
            `PAGE offset=${offset} count=${data.records.length}`
        );

        for (const item of data.records) {
            if (maxCount > 0 && processed >= maxCount) {
                console.log(`MAX_COUNT reached: ${maxCount}`);
                break;
            }

            if (!item.id) {
                continue;
            }

            console.log('========================================');
            console.log(`RECORDEDID=${item.id}`);
            console.log(`NAME=${item.name || ''}`);

            const result = spawnSync(
                '/bin/bash',
                ['/app/config/jikkyo-fetch.sh'],
                {
                    env: {
                        ...process.env,
                        RECORDEDID: String(item.id),
                        JIKKYO_DELAY: '0',
                    },
                    stdio: 'inherit',
                }
            );

            processed++;

            if (result.status !== 0) {
                errors++;
                console.log(`[ERROR] recordedId=${item.id}`);
            }
        }

        if (maxCount > 0 && processed >= maxCount) {
            break;
        }

        offset += data.records.length;
    }

    console.log('========================================');
    console.log(`COMPLETE processed=${processed} errors=${errors}`);
})().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});
NODE

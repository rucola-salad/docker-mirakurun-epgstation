#!/bin/bash
set -eu

RECORDED_ID="${1:-${RECORDEDID:-}}"

if [ -z "$RECORDED_ID" ]; then
    echo "RECORDEDID is not specified." >&2
    exit 1
fi

# Automatic hook execution can be disabled from Extension Settings.
# Manual execution intentionally bypasses this check.
if [ "${JIKKYO_AUTO:-0}" = "1" ]; then
    SETTINGS_FILE="/app/data/extension-settings.json"

    if [ -f "$SETTINGS_FILE" ] &&
       grep -Eq '"autoGenerateJikkyoXml"[[:space:]]*:[[:space:]]*false' "$SETTINGS_FILE"; then
        echo "$(date '+%Y/%-m/%-d %H:%M:%S') SKIP auto jikkyo XML generation: disabled by extension settings"
        exit 0
    fi
fi

exec /usr/local/bin/node - "$RECORDED_ID" <<'NODE'
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const recordedId = process.argv[2];

const EPGSTATION = process.env.EPGSTATION_URL || 'http://127.0.0.1:8888';
const RECORDED_ROOT = process.env.RECORDED_ROOT || '/app/recorded';
const TIMING_DIR = '/app/data/jikkyo-cache';
const LOG = '/app/logs/jikkyo-fetch.log';

const outputPath = process.env.OUTPUTPATH || null;
const delay = Number(process.env.JIKKYO_DELAY || '0');

function log(message) {
    const now = new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour12: false,
    });

    const line = `${now} ${message}\n`;
    fs.appendFileSync(LOG, line, 'utf8');
    console.log(message);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function get(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;

        client.get(url, res => {
            if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                get(next).then(resolve, reject);
                return;
            }

            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${url}\n${data}`));
                    return;
                }
                resolve(data);
            });
        }).on('error', reject);
    });
}

async function getJson(url) {
    return JSON.parse(await get(url));
}

function findFile(root, filename) {
    const stack = [root];
    const matches = [];

    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;

        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                stack.push(full);
                continue;
            }

            if (entry.isFile() && entry.name === filename) {
                matches.push(full);
                if (matches.length > 1) {
                    return matches;
                }
            }
        }
    }

    return matches;
}

function resolveVideoFile(preferredDir, filename) {
    if (preferredDir) {
        const sameDir = path.join(preferredDir, filename);
        if (fs.existsSync(sameDir)) {
            return sameDir;
        }
    }

    const matches = findFile(RECORDED_ROOT, filename);

    if (matches.length === 1) {
        return matches[0];
    }

    if (matches.length > 1) {
        log(`WARN duplicate filename: ${filename}`);
    }

    return null;
}

function getJikkyoId(channel) {
    if (channel.channelType === 'GR') {
        const map = {
            1: 'jk1',   // NHK総合
            2: 'jk2',   // NHK Eテレ
            3: 'jk12',  // チバテレ
            4: 'jk4',   // 日テレ
            5: 'jk5',   // テレ朝
            6: 'jk6',   // TBS
            7: 'jk7',   // テレ東
            8: 'jk8',   // フジ
            9: 'jk9',   // TOKYO MX
        };
        return map[channel.remoteControlKeyId] || null;
    }

    if (channel.channelType === 'BS') {
        const map = {
            101: 'jk101', // NHK BS
            141: 'jk141', // BS日テレ
            151: 'jk151', // BS朝日
            161: 'jk161', // BS-TBS
            171: 'jk171', // BSテレ東
            181: 'jk181', // BSフジ
            191: 'jk191', // WOWOWプライム
            192: 'jk192', // WOWOWライブ
            193: 'jk193', // WOWOWシネマ
            200: 'jk200', // BS10
            201: 'jk201', // BS10プレミアム
            211: 'jk211', // BS11
            222: 'jk222', // BS12
            236: 'jk236', // BSアニマックス
            252: 'jk252', // WOWOWプラス
            265: 'jk265', // BSよしもと
        };
        return map[channel.serviceId] || null;
    }

    if (channel.channelType === 'CS') {
        const map = {
            333: 'jk333', // AT-X
        };
        return map[channel.serviceId] || null;
    }

    return null;
}

function xmlPathForVideo(videoPath) {
    return videoPath.replace(/\.[^.]+$/, '.xml');
}

function timingPath() {
    return path.join(TIMING_DIR, `${recordedId}.timing.json`);
}

function saveTiming(timing) {
    fs.mkdirSync(TIMING_DIR, { recursive: true });

    const dest = timingPath();
    const tmp = `${dest}.tmp-${process.pid}`;

    fs.writeFileSync(
        tmp,
        JSON.stringify(
            {
                recordedId: Number(recordedId),
                duration: timing.duration ?? null,
                actualEnd: timing.actualEnd ?? null,
                baseTime: timing.baseTime,
                fetchStart: timing.fetchStart,
                fetchEnd: timing.fetchEnd,
                source: timing.source || 'unknown',
            },
            null,
            2
        ) + '\n',
        'utf8'
    );

    fs.renameSync(tmp, dest);
    log(`SAVE TIMING: ${dest}`);
}

function loadTiming() {
    const source = timingPath();

    if (!fs.existsSync(source)) {
        return null;
    }

    try {
        const timing = JSON.parse(fs.readFileSync(source, 'utf8'));

        if (
            !Number.isFinite(Number(timing.baseTime)) ||
            !Number.isFinite(Number(timing.fetchStart)) ||
            !Number.isFinite(Number(timing.fetchEnd))
        ) {
            log(`WARN invalid timing: ${source}`);
            return null;
        }

        return {
            duration:
                timing.duration === null || typeof timing.duration === 'undefined'
                    ? null
                    : Number(timing.duration),
            actualEnd:
                timing.actualEnd === null || typeof timing.actualEnd === 'undefined'
                    ? null
                    : Number(timing.actualEnd),
            baseTime: Number(timing.baseTime),
            fetchStart: Number(timing.fetchStart),
            fetchEnd: Number(timing.fetchEnd),
            source: timing.source || 'timing-json',
        };
    } catch (e) {
        log(`WARN timing read failed: ${source}: ${e.message}`);
        return null;
    }
}

function recoverTimingFromLog() {
    if (!fs.existsSync(LOG)) {
        log(`WARN log file not found: ${LOG}`);
        return null;
    }

    /*
     * recordedIdごとの実行ブロックを後ろから探し、
     * 最後にbaseTime等を取得できたものを使う。
     *
     * XMLそのものはキャッシュせず、ここでは再取得に必要な
     * timing情報だけを復旧する。
     */
    const blocks = fs.readFileSync(LOG, 'utf8')
        .split('========================================');

    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        const idMatch = block.match(/START recordedId=(\d+)/);

        if (!idMatch || idMatch[1] !== String(recordedId)) {
            continue;
        }

        const baseMatch = block.match(/baseTime=([0-9.]+)/);
        const startMatch = block.match(/fetchStart=(\d+)/);
        const endMatch = block.match(/fetchEnd=(\d+)/);

        if (!baseMatch || !startMatch || !endMatch) {
            continue;
        }

        const timing = {
            duration: null,
            actualEnd: null,
            baseTime: Number(baseMatch[1]),
            fetchStart: Number(startMatch[1]),
            fetchEnd: Number(endMatch[1]),
            source: 'log',
        };

        if (
            Number.isFinite(timing.baseTime) &&
            Number.isFinite(timing.fetchStart) &&
            Number.isFinite(timing.fetchEnd)
        ) {
            log(`RECOVER baseTime=${timing.baseTime}`);
            log(`RECOVER fetchStart=${timing.fetchStart}`);
            log(`RECOVER fetchEnd=${timing.fetchEnd}`);
            saveTiming(timing);
            return timing;
        }
    }

    log(`WARN past timing not found in log recordedId=${recordedId}`);
    return null;
}

function timingFromProgram(recorded) {
    const startAt = Number(recorded.startAt) / 1000;
    const endAt = Number(recorded.endAt) / 1000;

    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return null;
    }

    return {
        duration: endAt - startAt,
        actualEnd: endAt,
        baseTime: startAt,
        fetchStart: Math.floor(startAt - 10),
        fetchEnd: Math.ceil(endAt + 10),
        source: 'program-startAt',
    };
}

function timingFromTs(tsPath) {
    const durationText = execFileSync(
        '/opt/ffmpeg-7.0.2/bin/ffprobe',
        [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            tsPath,
        ],
        { encoding: 'utf8' }
    ).trim();

    const duration = Number(durationText);

    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`invalid duration: ${durationText}`);
    }

    const stat = fs.statSync(tsPath);
    const actualEnd = stat.mtimeMs / 1000;
    const baseTime = actualEnd - duration;

    return {
        duration,
        actualEnd,
        baseTime,
        fetchStart: Math.floor(baseTime - 10),
        fetchEnd: Math.ceil(actualEnd + 10),
        source: 'ts',
    };
}

function convertXml(text, baseTime) {
    let count = 0;

    const converted = text.replace(
        /<chat\b[^>]*>[\s\S]*?<\/chat>/g,
        chat => {
            const dateMatch = chat.match(/\bdate="(\d+)"/);

            if (!dateMatch) {
                return chat;
            }

            const usecMatch = chat.match(/\bdate_usec="(\d+)"/);
            let t = Number(dateMatch[1]);

            if (usecMatch) {
                t += Number(usecMatch[1]) / 1000000;
            }

            const vpos = Math.round((t - baseTime) * 100);

            if (vpos < 0) {
                return '';
            }

            count++;

            if (/\bvpos="-?\d+"/.test(chat)) {
                return chat.replace(/\bvpos="-?\d+"/, `vpos="${vpos}"`);
            }

            return chat.replace('<chat ', `<chat vpos="${vpos}" `);
        }
    );

    return { text: converted, count };
}

function countXmlComments(text) {
    return (text.match(/<chat\b/g) || []).length;
}

async function fetchComments(jkId, timing) {
    log(`baseTime=${timing.baseTime}`);
    log(`fetchStart=${timing.fetchStart}`);
    log(`fetchEnd=${timing.fetchEnd}`);

    const url =
        `https://jikkyo.tsukumijima.net/api/kakolog/${jkId}` +
        `?starttime=${timing.fetchStart}` +
        `&endtime=${timing.fetchEnd}` +
        `&format=xml`;

    const originalXml = await get(url);
    return convertXml(originalXml, timing.baseTime);
}

function writeXml(destXml, converted) {
    let existingCount = 0;
    const existed = fs.existsSync(destXml);

    if (existed) {
        try {
            existingCount = countXmlComments(fs.readFileSync(destXml, 'utf8'));
        } catch (e) {
            log(`WARN XML read failed: ${destXml}: ${e.message}`);
        }
    }

    /*
     * NX-Jikkyo側の一時的な未反映で0件が返っても、
     * 既存の非0件XMLを破壊しない。
     *
     * 新規取得が非0件なら既存XMLの有無に関係なく更新する。
     */
    if (converted.count === 0 && existingCount > 0) {
        log(`KEEP XML: ${destXml} existingComments=${existingCount} newComments=0`);
        return 'preserved';
    }

    const tmp = `${destXml}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, converted.text, 'utf8');
    fs.renameSync(tmp, destXml);

    log(`${existed ? 'UPDATE' : 'CREATE'} XML: ${destXml} comments=${converted.count}`);
    return 'updated';
}

(async () => {
    log('========================================');
    log(`START recordedId=${recordedId}`);

    /*
     * EPGStation 録画済み番組情報
     */
    const recorded = await getJson(
        `${EPGSTATION}/api/recorded/${recordedId}?isHalfWidth=false`
    );

    /*
     * EPGStation チャンネル情報
     */
    const channels = await getJson(
        `${EPGSTATION}/api/channels?isHalfWidth=false`
    );

    const channel = channels.find(
        item => Number(item.id) === Number(recorded.channelId)
    );

    if (!channel) {
        throw new Error(`channel not found: channelId=${recorded.channelId}`);
    }

    log(`PROGRAM ${recorded.name}`);
    log(`CHANNEL ${channel.name}`);
    log(`channelId=${channel.id}`);
    log(`startAt=${recorded.startAt}`);
    log(`endAt=${recorded.endAt}`);

    const jkId = getJikkyoId(channel);

    if (!jkId) {
        log(
            `SKIP unsupported channel: ${channel.name}` +
            ` type=${channel.channelType}` +
            ` remote=${channel.remoteControlKeyId}`
        );
        return;
    }

    log(`JIKKYO ${jkId}`);

    /*
     * 録画済み番組に紐づくTSを探す。
     *
     * recordingFinishCommand では RECPATH が最も確実なので優先する。
     * 手動実行やencodingFinishCommandでは、videoFilesに登録された
     * TSファイル名から実ファイルを検索する。
     */
    const tsInfo = (recorded.videoFiles || []).find(item => item.type === 'ts');
    let tsPath = null;

    if (process.env.RECPATH && fs.existsSync(process.env.RECPATH)) {
        tsPath = process.env.RECPATH;
    } else if (tsInfo) {
        const matches = findFile(RECORDED_ROOT, tsInfo.filename);

        if (matches.length > 1) {
            throw new Error(`multiple TS files found: ${tsInfo.filename}`);
        }

        if (matches.length === 1) {
            tsPath = matches[0];
        } else {
            log(`WARN physical TS file not found: ${tsInfo.filename}`);
        }
    } else {
        log('TS video file not found in recorded information');
    }

    /*
     * コメント位置補正に使う録画時刻情報を決定する。
     *
     * 実TSが存在する場合は、TSのdurationとmtimeから実録画時刻を
     * 再計算してtiming.jsonへ保存する。
     *
     * 元TSが削除済みの場合は、保存済みtiming.json、
     * 過去ログ、EPG上の番組時刻の順でフォールバックする。
     */
    let timing;

    if (tsPath) {
        log(`TS ${tsPath}`);

        /*
         * TSが削除される前に録画時刻情報を確保する。
         * コメント取得のWAITより先に実行することが重要。
         */
        timing = timingFromTs(tsPath);
        saveTiming(timing);
    } else {
        timing = loadTiming();

        if (timing) {
            log(`USE TIMING: ${timingPath()} source=${timing.source}`);
        } else {
            log('TRY recover timing from past log');
            timing = recoverTimingFromLog();
        }

        if (!timing) {
            timing = timingFromProgram(recorded);

            if (!timing) {
                throw new Error(`timing could not be determined recordedId=${recordedId}`);
            }

            log(`WARN use program startAt fallback recordedId=${recordedId}`);
            saveTiming(timing);
        }
    }

    /*
     * 自動取得ではNX-Jikkyo側への反映待ちのため遅延する。
     * timing情報は上で先に確保済みなので、WAIT中に元TSが
     * 削除されても再取得に必要な時刻情報は失われない。
     */
    if (delay > 0) {
        log(`WAIT ${delay} seconds`);
        await sleep(delay * 1000);
    }

    /*
     * 既存XMLの有無に関係なく、毎回NX-Jikkyoから再取得する。
     * recordedId単位のXMLキャッシュは使用しない。
     */
    const converted = await fetchComments(jkId, timing);
    log(`FETCH XML comments=${converted.count}`);

    /*
     * 同じ録画に紐づく実在動画すべてを更新対象にする。
     * TS、encodingFinishCommandのOUTPUTPATH、
     * recorded.videoFilesに登録された既存動画を重複排除して扱う。
     */
    const targets = new Map();
    const preferredDir = tsPath ? path.dirname(tsPath) : null;

    if (tsPath) {
        targets.set(xmlPathForVideo(tsPath), tsPath);
    }

    if (outputPath) {
        if (fs.existsSync(outputPath)) {
            log(`OUTPUT ${outputPath}`);
            targets.set(xmlPathForVideo(outputPath), outputPath);
        } else {
            log(`WARN OUTPUTPATH not found: ${outputPath}`);
        }
    }

    for (const video of recorded.videoFiles || []) {
        const videoPath = resolveVideoFile(preferredDir, video.filename);

        if (!videoPath) {
            log(`WARN video file not found: ${video.filename}`);
            continue;
        }

        targets.set(xmlPathForVideo(videoPath), videoPath);
    }

    if (targets.size === 0) {
        throw new Error(`no video target found recordedId=${recordedId}`);
    }

    let updated = 0;
    let preserved = 0;

    for (const [destXml] of targets) {
        const result = writeXml(destXml, converted);
        if (result === 'updated') {
            updated++;
        } else {
            preserved++;
        }
    }

    log(
        `JIKKYO RESULT comments=${converted.count}` +
        ` updated=${updated}` +
        ` preserved=${preserved}`
    );
    log(`COMPLETE recordedId=${recordedId}`);
})().catch(err => {
    log(`ERROR ${err.stack || err.message}`);
    process.exit(1);
});
NODE

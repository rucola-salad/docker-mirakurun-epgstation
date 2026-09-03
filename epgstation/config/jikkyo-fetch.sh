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
const CACHE_DIR = '/app/data/jikkyo-cache';
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
                    reject(
                        new Error(
                            `HTTP ${res.statusCode}: ${url}\n${data}`
                        )
                    );
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

function resolveVideoFile(tsDir, filename) {
    const sameDir = path.join(tsDir, filename);

    if (fs.existsSync(sameDir)) {
        return sameDir;
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

function cacheXmlPath() {
    return path.join(CACHE_DIR, `${recordedId}.xml`);
}

function cacheTimingPath() {
    return path.join(CACHE_DIR, `${recordedId}.timing.json`);
}

function saveTiming(timing) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const timingPath = cacheTimingPath();
    const tmpPath = `${timingPath}.tmp-${process.pid}`;

    fs.writeFileSync(
        tmpPath,
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

    fs.renameSync(tmpPath, timingPath);

    log(`SAVE TIMING: ${timingPath}`);
}

function loadTiming() {
    const timingPath = cacheTimingPath();

    if (!fs.existsSync(timingPath)) {
        return null;
    }

    try {
        const timing = JSON.parse(
            fs.readFileSync(timingPath, 'utf8')
        );

        if (
            !Number.isFinite(Number(timing.baseTime)) ||
            !Number.isFinite(Number(timing.fetchStart)) ||
            !Number.isFinite(Number(timing.fetchEnd))
        ) {
            log(`WARN invalid timing cache: ${timingPath}`);
            return null;
        }

        return {
            duration:
                timing.duration === null ||
                typeof timing.duration === 'undefined'
                    ? null
                    : Number(timing.duration),
            actualEnd:
                timing.actualEnd === null ||
                typeof timing.actualEnd === 'undefined'
                    ? null
                    : Number(timing.actualEnd),
            baseTime: Number(timing.baseTime),
            fetchStart: Number(timing.fetchStart),
            fetchEnd: Number(timing.fetchEnd),
            source: timing.source || 'cache',
        };
    } catch (e) {
        log(`WARN timing cache read failed: ${timingPath}: ${e.message}`);
        return null;
    }
}

async function createCacheFromTiming(jkId, timing, label) {
    log(`${label} baseTime=${timing.baseTime}`);
    log(`${label} fetchStart=${timing.fetchStart}`);
    log(`${label} fetchEnd=${timing.fetchEnd}`);

    const url =
        `https://jikkyo.tsukumijima.net/api/kakolog/${jkId}` +
        `?starttime=${timing.fetchStart}` +
        `&endtime=${timing.fetchEnd}` +
        `&format=xml`;

    const originalXml = await get(url);
    const converted = convertXml(
        originalXml,
        timing.baseTime
    );

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const cacheXml = cacheXmlPath();

    if (!fs.existsSync(cacheXml)) {
        try {
            fs.writeFileSync(
                cacheXml,
                converted.text,
                {
                    encoding: 'utf8',
                    flag: 'wx',
                }
            );

            log(
                `${label} CACHE XML: ${cacheXml}` +
                ` comments=${converted.count}`
            );
        } catch (e) {
            if (e.code !== 'EEXIST') {
                throw e;
            }

            log(`SKIP CACHE exists: ${cacheXml}`);
        }
    }

    return fs.existsSync(cacheXml)
        ? cacheXml
        : null;
}

function saveCacheIfMissing(sourceXml) {
    if (!fs.existsSync(sourceXml)) {
        return;
    }

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const cacheXml = cacheXmlPath();

    if (fs.existsSync(cacheXml)) {
        log(`SKIP CACHE exists: ${cacheXml}`);
        return;
    }

    try {
        fs.copyFileSync(
            sourceXml,
            cacheXml,
            fs.constants.COPYFILE_EXCL
        );

        log(`CREATE CACHE XML: ${cacheXml}`);
    } catch (e) {
        if (e.code === 'EEXIST') {
            log(`SKIP CACHE exists: ${cacheXml}`);
            return;
        }

        throw e;
    }
}

async function recoverCacheFromLog(jkId) {
    if (!fs.existsSync(LOG)) {
        log(`WARN log file not found: ${LOG}`);
        return null;
    }

    const text = fs.readFileSync(LOG, 'utf8');

    /*
     * recordedIdごとの実行ブロックを後ろから探し、
     * 最後に成功してbaseTime等を取得できたものを使う。
     */
    const blocks = text.split('========================================');

    let timing = null;

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

        timing = {
            baseTime: Number(baseMatch[1]),
            fetchStart: Number(startMatch[1]),
            fetchEnd: Number(endMatch[1])
        };

        break;
    }

    if (!timing) {
        log(`WARN past timing not found in log recordedId=${recordedId}`);
        return null;
    }

    if (
        !Number.isFinite(timing.baseTime) ||
        !Number.isFinite(timing.fetchStart) ||
        !Number.isFinite(timing.fetchEnd)
    ) {
        log(`WARN invalid past timing recordedId=${recordedId}`);
        return null;
    }

    log(`RECOVER baseTime=${timing.baseTime}`);
    log(`RECOVER fetchStart=${timing.fetchStart}`);
    log(`RECOVER fetchEnd=${timing.fetchEnd}`);

    const url =
        `https://jikkyo.tsukumijima.net/api/kakolog/${jkId}` +
        `?starttime=${timing.fetchStart}` +
        `&endtime=${timing.fetchEnd}` +
        `&format=xml`;

    const originalXml = await get(url);
    const converted = convertXml(originalXml, timing.baseTime);

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const cacheXml = cacheXmlPath();

    if (!fs.existsSync(cacheXml)) {
        try {
            fs.writeFileSync(
                cacheXml,
                converted.text,
                {
                    encoding: 'utf8',
                    flag: 'wx'
                }
            );

            log(
                `RECOVER CACHE XML: ${cacheXml} comments=${converted.count}`
            );
        } catch (e) {
            if (e.code !== 'EEXIST') {
                throw e;
            }

            log(`SKIP CACHE exists: ${cacheXml}`);
        }
    }

    return fs.existsSync(cacheXml)
        ? cacheXml
        : null;
}

function copyXmlToRecordedVideos(sourceXml, recorded) {
    for (const video of recorded.videoFiles || []) {
        const matches = findFile(
            RECORDED_ROOT,
            video.filename
        );

        if (matches.length === 0) {
            log(`WARN video file not found: ${video.filename}`);
            continue;
        }

        if (matches.length > 1) {
            log(`WARN duplicate filename: ${video.filename}`);
            continue;
        }

        copyXmlIfMissing(
            sourceXml,
            matches[0]
        );
    }
}

function copyXmlIfMissing(sourceXml, videoPath) {
    const destXml = xmlPathForVideo(videoPath);

    if (destXml === sourceXml) {
        return;
    }

    if (fs.existsSync(destXml)) {
        log(`SKIP XML exists: ${destXml}`);
        return;
    }

    try {
        fs.copyFileSync(
            sourceXml,
            destXml,
            fs.constants.COPYFILE_EXCL
        );

        log(`CREATE XML: ${destXml}`);
    } catch (e) {
        if (e.code === 'EEXIST') {
            log(`SKIP XML exists: ${destXml}`);
            return;
        }

        throw e;
    }
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
                return chat.replace(
                    /\bvpos="-?\d+"/,
                    `vpos="${vpos}"`
                );
            }

            return chat.replace(
                '<chat ',
                `<chat vpos="${vpos}" `
            );
        }
    );

    return {
        text: converted,
        count,
    };
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
        throw new Error(
            `channel not found: channelId=${recorded.channelId}`
        );
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
     * 録画済み番組に紐づくTSを探す
     */
    const tsInfo = recorded.videoFiles.find(
        item => item.type === 'ts'
    );

    /*
     * エンコード後に元TSが削除されている場合。
     *
     * recordingFinishCommand 等で保存しておいた
     * recordedId 単位のXMLキャッシュがあれば、
     * encodingFinishCommand の OUTPUTPATH に直接補完する。
     */
    if (!tsInfo) {
        let cacheXml = cacheXmlPath();

        log('TS video file not found in recorded information');

        /*
         * XMLキャッシュが無ければ、まず timing.json を使う。
         */
        if (!fs.existsSync(cacheXml)) {
            log(`CACHE XML not found: ${cacheXml}`);

            const timing = loadTiming();

            if (timing) {
                log(`USE TIMING: ${cacheTimingPath()}`);

                cacheXml = await createCacheFromTiming(
                    jkId,
                    timing,
                    'TIMING'
                );
            }
        }

        /*
         * timing.json も無ければ、過去ログから復旧する。
         */
        if (!cacheXml || !fs.existsSync(cacheXml)) {
            log('TRY recover XML from past log');

            cacheXml = await recoverCacheFromLog(jkId);
        }

        /*
         * それでも復旧できない過去録画は、番組開始時刻を
         * 最終フォールバックとして使用する。
         *
         * 録画マージンを反映できないため数秒程度ずれる可能性はある。
         */
        if (!cacheXml || !fs.existsSync(cacheXml)) {
            const startAt = Number(recorded.startAt) / 1000;
            const endAt = Number(recorded.endAt) / 1000;

            if (
                Number.isFinite(startAt) &&
                Number.isFinite(endAt) &&
                endAt > startAt
            ) {
                const timing = {
                    duration: endAt - startAt,
                    actualEnd: endAt,
                    baseTime: startAt,
                    fetchStart: Math.floor(startAt - 10),
                    fetchEnd: Math.ceil(endAt + 10),
                    source: 'program-startAt',
                };

                log(
                    'WARN use program startAt fallback ' +
                    `recordedId=${recordedId}`
                );

                saveTiming(timing);

                cacheXml = await createCacheFromTiming(
                    jkId,
                    timing,
                    'FALLBACK'
                );
            }
        }

        if (!cacheXml || !fs.existsSync(cacheXml)) {
            log(`WARN XML could not be recovered recordedId=${recordedId}`);
            return;
        }

        log(`USE CACHE XML: ${cacheXml}`);

        /*
         * encodingFinishCommand ならOUTPUTPATHへ直接コピー。
         */
        if (outputPath) {
            if (fs.existsSync(outputPath)) {
                log(`OUTPUT ${outputPath}`);

                copyXmlIfMissing(
                    cacheXml,
                    outputPath
                );
            } else {
                log(`WARN OUTPUTPATH not found: ${outputPath}`);
            }
        }

        /*
         * 手動実行や過去データ復旧にも対応するため、
         * recorded.videoFiles に登録されている既存動画にもコピー。
         */
        copyXmlToRecordedVideos(
            cacheXml,
            recorded
        );

        log(`COMPLETE recordedId=${recordedId}`);
        return;
    }

    let tsPath = null;

    /*
     * recordingFinishCommand の場合は RECPATH が最も確実。
     */
    if (
        process.env.RECPATH &&
        fs.existsSync(process.env.RECPATH)
    ) {
        tsPath = process.env.RECPATH;
    }

    /*
     * 既存録画処理の場合はvideoFilesのfilenameから探す。
     */
    if (!tsPath) {
        const matches = findFile(
            RECORDED_ROOT,
            tsInfo.filename
        );

        if (matches.length === 0) {
            throw new Error(
                `TS file not found: ${tsInfo.filename}`
            );
        }

        if (matches.length > 1) {
            throw new Error(
                `multiple TS files found: ${tsInfo.filename}`
            );
        }

        tsPath = matches[0];
    }

    const tsDir = path.dirname(tsPath);
    const sourceXml = xmlPathForVideo(tsPath);

    log(`TS ${tsPath}`);

    /*
     * TSが削除される前に録画時刻情報を確保する。
     * コメント取得のWAITより先に実行することが重要。
     */
    const durationText = execFileSync(
        '/opt/ffmpeg-7.0.2/bin/ffprobe',
        [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            tsPath,
        ],
        {
            encoding: 'utf8',
        }
    ).trim();

    const duration = Number(durationText);

    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(
            `invalid duration: ${durationText}`
        );
    }

    /*
     * TSの実際のファイル終了時刻から実録画開始を逆算。
     */
    const stat = fs.statSync(tsPath);

    const actualEnd = stat.mtimeMs / 1000;
    const baseTime = actualEnd - duration;

    const fetchStart = Math.floor(baseTime - 10);
    const fetchEnd = Math.ceil(actualEnd + 10);

    log(`duration=${duration}`);
    log(`baseTime=${baseTime}`);
    log(`fetchStart=${fetchStart}`);
    log(`fetchEnd=${fetchEnd}`);

    saveTiming({
        duration,
        actualEnd,
        baseTime,
        fetchStart,
        fetchEnd,
        source: 'ts',
    });

    /*
     * 元TS用XMLが無い場合だけNX-Jikkyoから取得。
     */
    if (!fs.existsSync(sourceXml)) {
        if (delay > 0) {
            log(`WAIT ${delay} seconds`);
            await sleep(delay * 1000);
        }

        const url =
            `https://jikkyo.tsukumijima.net/api/kakolog/${jkId}` +
            `?starttime=${fetchStart}` +
            `&endtime=${fetchEnd}` +
            `&format=xml`;

        const originalXml = await get(url);

        const converted = convertXml(
            originalXml,
            baseTime
        );

        /*
         * flag=wx により既存XMLは上書きしない。
         */
        try {
            fs.writeFileSync(
                sourceXml,
                converted.text,
                {
                    encoding: 'utf8',
                    flag: 'wx',
                }
            );

            log(
                `CREATE XML: ${sourceXml}` +
                ` comments=${converted.count}`
            );
        } catch (e) {
            if (e.code !== 'EEXIST') {
                throw e;
            }

            log(`SKIP XML exists: ${sourceXml}`);
        }
    } else {
        log(`SKIP XML exists: ${sourceXml}`);
    }

    /*
     * TS XMLが存在すれば、EPGStationに登録されている
     * 各エンコード結果にも同名XMLを補完する。
     */
    if (!fs.existsSync(sourceXml)) {
        throw new Error(
            `source XML was not created: ${sourceXml}`
        );
    }

    /*
     * 元TSが削除された後でもエンコード結果へXMLを
     * 引き継げるよう、recordedId単位で保存する。
     */
    saveCacheIfMissing(sourceXml);

    /*
     * encodingFinishCommand から渡されたOUTPUTPATHにも
     * 明示的にXMLを補完する。
     */
    if (
        outputPath &&
        fs.existsSync(outputPath)
    ) {
        log(`OUTPUT ${outputPath}`);

        copyXmlIfMissing(
            sourceXml,
            outputPath
        );
    }

    for (const video of recorded.videoFiles) {
        const videoPath = resolveVideoFile(
            tsDir,
            video.filename
        );

        if (!videoPath) {
            log(`WARN video file not found: ${video.filename}`);
            continue;
        }

        copyXmlIfMissing(
            sourceXml,
            videoPath
        );
    }

    log(`COMPLETE recordedId=${recordedId}`);
})().catch(err => {
    log(`ERROR ${err.stack || err.message}`);
    process.exit(1);
});
NODE

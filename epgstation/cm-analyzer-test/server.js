'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8080);

const RECORDED_ROOT = process.env.RECORDED_ROOT || '/recorded';
const DATA_ROOT = process.env.DATA_ROOT || '/data';

const JLSE_ROOT =
    '/tmp/JoinLogoScpTrialSetLinux/modules/join_logo_scp_trial';

const JLSE_RESULT_ROOT =
    path.join(JLSE_ROOT, 'result');

const LOGO_ROOT =
    path.join(DATA_ROOT, 'logos');

const GENLOGO_COMMAND =
    process.env.GENLOGO_COMMAND ||
    '/usr/local/bin/genlogo';

const FFMPEG_COMMAND =
    process.env.FFMPEG_COMMAND ||
    'ffmpeg';

const FFPROBE_COMMAND =
    process.env.FFPROBE_COMMAND ||
    'ffprobe';

const EPGSTATION_URL =
    process.env.EPGSTATION_URL || 'http://epgstation-custom-test:8888';
const MIRAKURUN_URL =
    process.env.MIRAKURUN_URL || 'http://mirakurun:40772';
const LOGO_COLLECT_ENABLED =
    String(process.env.LOGO_COLLECT_ENABLED || 'false').toLowerCase() === 'true';

// Runtime state. This is intentionally not persisted.
// CM Analyzer restart always resets this value from LOGO_COLLECT_ENABLED.
let logoCollectorEnabled = LOGO_COLLECT_ENABLED;
const LOGO_COLLECT_TMP_ROOT =
    process.env.LOGO_COLLECT_TMP_ROOT || '/logo-collector-tmp';
const LOGO_COLLECT_INTERVAL_MINUTES =
    Number(process.env.LOGO_COLLECT_INTERVAL_MINUTES || 60);
const LOGO_COLLECT_SAMPLE_SECONDS =
    Number(process.env.LOGO_COLLECT_SAMPLE_SECONDS || 600);
const LOGO_COLLECT_STATE_PATH =
    path.join(DATA_ROOT, 'logo-collector-state.json');
const LOGO_COLLECT_PRIORITY = 0;
const LOGO_COLLECT_BACKOFF_FAILURES = 6;
const LOGO_COLLECT_SUSPEND_FAILURES = 24;
const LOGO_COLLECT_BACKOFF_MS = 6 * 60 * 60 * 1000;
const LOGO_COLLECT_SUSPEND_MS = 7 * 24 * 60 * 60 * 1000;

const parseChannel =
    require(path.join(JLSE_ROOT, 'src/channel')).parse;

let running = false;
let currentJob = null;
const jobQueue = [];

function enqueueAnalysis(job) {
    jobQueue.push(job);

    log(
        'analysis queued',
        `recordedId=${job.recordedId}`,
        `queueLength=${jobQueue.length}`
    );

    processNextAnalysis();
}

function processNextAnalysis() {
    if (running || jobQueue.length === 0) {
        return;
    }

    const job = jobQueue.shift();

    runAnalysis(job)
        .catch(err => {
            log(
                'unexpected analysis error',
                err
            );
        })
        .finally(() => {
            processNextAnalysis();
        });
}

function log(...args) {
    console.log(
        new Date().toISOString(),
        ...args
    );
}

function sendJson(res, statusCode, body) {
    const data = JSON.stringify(body, null, 2);

    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data),
    });

    res.end(data);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 1024 * 1024) {
                reject(new Error('request too large'));
                req.destroy();
            }
        });

        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch (err) {
                reject(err);
            }
        });

        req.on('error', reject);
    });
}

function convertRecordedPath(recPath) {
    const prefix = '/app/recorded';

    if (!recPath.startsWith(prefix)) {
        throw new Error(
            `unsupported recPath: ${recPath}`
        );
    }

    const relative = recPath.substring(prefix.length);

    return path.join(
        RECORDED_ROOT,
        relative
    );
}

function safeName(value) {
    return String(value || '')
        .replace(/[\/\\]/g, '_')
        .replace(/[\x00-\x1f]/g, '_');
}

function copyDirectory(src, dst) {
    fs.mkdirSync(dst, { recursive: true });

    for (const entry of fs.readdirSync(src, {
        withFileTypes: true,
    })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);

        if (entry.isDirectory()) {
            copyDirectory(srcPath, dstPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

let currentAnalysisChild = null;
const canceledRecordedIds = new Set();

function terminateAnalysisChild(child) {
    if (
        child === null ||
        child.exitCode !== null ||
        child.signalCode !== null
    ) {
        return;
    }

    /*
     * JLSE は内部で複数プロセスを起動するため、
     * Linux ではプロセスグループ全体へ SIGTERM を送る。
     */
    try {
        if (child.pid) {
            process.kill(-child.pid, 'SIGTERM');
            return;
        }
    } catch (_) {
        // process group kill に失敗した場合は直接 kill へフォールバック
    }

    try {
        child.kill('SIGTERM');
    } catch (_) {
        // already exited
    }
}

function spawnAndWait(
    command,
    args,
    options = {},
    recordedId = null
) {
    return new Promise((resolve, reject) => {
        const childOptions =
            recordedId === null
                ? options
                : {
                    ...options,
                    detached: true,
                };

        const child = spawn(
            command,
            args,
            childOptions
        );

        if (recordedId !== null) {
            currentAnalysisChild = child;

            if (canceledRecordedIds.has(String(recordedId))) {
                terminateAnalysisChild(child);
            }
        }

        child.once('error', err => {
            if (
                recordedId !== null &&
                currentAnalysisChild === child
            ) {
                currentAnalysisChild = null;
            }

            reject(err);
        });

        child.once('exit', (code, signal) => {
            if (
                recordedId !== null &&
                currentAnalysisChild === child
            ) {
                currentAnalysisChild = null;
            }

            if (
                recordedId !== null &&
                canceledRecordedIds.has(String(recordedId))
            ) {
                reject(
                    new Error(
                        `analysis canceled: recordedId=${recordedId}`
                    )
                );
                return;
            }

            if (code === 0) {
                resolve();
                return;
            }

            reject(
                new Error(
                    `${command} failed: ` +
                    `exit=${code} signal=${signal || ''}`
                )
            );
        });
    });
}


function spawnAndCapture(
    command,
    args,
    options = {},
    recordedId = null
) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            command,
            args,
            {
                ...options,
                stdio: [
                    'ignore',
                    'pipe',
                    'pipe',
                ],
                detached: recordedId !== null,
            }
        );

        if (recordedId !== null) {
            currentAnalysisChild = child;

            if (
                canceledRecordedIds.has(
                    String(recordedId)
                )
            ) {
                terminateAnalysisChild(child);
            }
        }

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });

        child.stderr.on('data', chunk => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });

        child.once('error', err => {
            if (
                recordedId !== null &&
                currentAnalysisChild === child
            ) {
                currentAnalysisChild = null;
            }

            reject(err);
        });

        child.once('exit', (code, signal) => {
            if (
                recordedId !== null &&
                currentAnalysisChild === child
            ) {
                currentAnalysisChild = null;
            }

            if (
                recordedId !== null &&
                canceledRecordedIds.has(
                    String(recordedId)
                )
            ) {
                reject(
                    new Error(
                        `analysis canceled: recordedId=${recordedId}`
                    )
                );
                return;
            }

            if (code === 0) {
                resolve({
                    stdout,
                    stderr,
                });
                return;
            }

            reject(
                new Error(
                    `${command} failed: ` +
                    `exit=${code} signal=${signal || ''}`
                )
            );
        });
    });
}

async function getVideoMetadata(
    inputPath,
    recordedId = null
) {
    const result =
        await spawnAndCapture(
            FFPROBE_COMMAND,
            [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=avg_frame_rate,duration',
                '-of',
                'json',
                inputPath,
            ],
            {},
            recordedId
        );

    let probe;

    try {
        probe =
            JSON.parse(result.stdout);
    } catch (err) {
        throw new Error(
            `invalid ffprobe json: ${result.stdout.trim()}`
        );
    }

    const stream =
        probe &&
        Array.isArray(probe.streams) &&
        probe.streams.length > 0
            ? probe.streams[0]
            : null;

    if (!stream) {
        throw new Error(
            'video stream not found'
        );
    }

    const frameRateText =
        String(stream.avg_frame_rate || '');

    const parts =
        frameRateText.split('/');

    let frameRate;

    if (parts.length === 2) {
        const numerator =
            Number(parts[0]);
        const denominator =
            Number(parts[1]);

        frameRate =
            denominator !== 0
                ? numerator / denominator
                : 0;
    } else {
        frameRate =
            Number(frameRateText);
    }

    if (
        !Number.isFinite(frameRate) ||
        frameRate <= 0
    ) {
        throw new Error(
            `invalid video frame rate: ${frameRateText}`
        );
    }

    const duration =
        Number(stream.duration);

    if (
        !Number.isFinite(duration) ||
        duration <= 0
    ) {
        throw new Error(
            `invalid video duration: ${stream.duration}`
        );
    }

    return {
        frameRate,
        duration,
    };
}


async function getVideoFrameRate(
    inputPath,
    recordedId = null
) {
    const result =
        await spawnAndCapture(
            FFPROBE_COMMAND,
            [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=avg_frame_rate',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                inputPath,
            ],
            {},
            recordedId
        );

    const values =
        result.stdout
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(value => value.length > 0);

    for (const value of values) {
        const parts =
            value.split('/');

        let fps;

        if (parts.length === 2) {
            const numerator =
                Number(parts[0]);
            const denominator =
                Number(parts[1]);

            fps =
                denominator !== 0
                    ? numerator / denominator
                    : 0;
        } else {
            fps =
                Number(value);
        }

        if (
            Number.isFinite(fps) &&
            fps > 0
        ) {
            return fps;
        }
    }

    throw new Error(
        `invalid video frame rate: ${result.stdout.trim()}`
    );
}


function collectMatches(text, regex) {
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        matches.push(match);
    }

    return matches;
}

function parseLogoQuality(stderr) {
    const roiMatches = collectMatches(
        stderr,
        /auto-roi candidate score=([0-9.]+)/g
    );

    const acceptedMatches = collectMatches(
        stderr,
        /^accepted frames:\s*(\d+)\s*$/gm
    );

    const evaluatorMatches = collectMatches(
        stderr,
        /logo evaluator mask:\s*(\d+) pixels, blackScore=([0-9.]+)/g
    );

    if (
        roiMatches.length === 0 ||
        acceptedMatches.length === 0 ||
        evaluatorMatches.length === 0
    ) {
        throw new Error(
            'genlogo quality metrics not found'
        );
    }

    const roiScore = Number(
        roiMatches[roiMatches.length - 1][1]
    );

    const acceptedFrames = Number(
        acceptedMatches[acceptedMatches.length - 1][1]
    );

    const evaluator =
        evaluatorMatches[evaluatorMatches.length - 1];

    const maskPixels =
        Number(evaluator[1]);

    const blackScore =
        Number(evaluator[2]);

    const blackRatio =
        maskPixels > 0
            ? blackScore / maskPixels
            : 0;

    /*
     * 比較用 0～100 点。
     *
     * ROI        40点
     * accepted   30点
     * blackRatio 30点
     */
    const roiPart =
        Math.min(
            Math.max(roiScore / 450, 0),
            1
        ) * 40;

    const framePart =
        Math.min(
            Math.max(acceptedFrames / 60, 0),
            1
        ) * 30;

    const blackPart =
        Math.min(
            Math.max(
                (blackRatio - 0.90) / 0.10,
                0
            ),
            1
        ) * 30;

    return {
        roiScore,
        acceptedFrames,
        maskPixels,
        blackScore,
        blackRatio,
        qualityScore:
            roiPart +
            framePart +
            blackPart,
    };
}

function readLogoQuality(metaPath) {
    try {
        const value = JSON.parse(
            fs.readFileSync(
                metaPath,
                'utf8'
            )
        );

        if (
            typeof value.qualityScore !==
            'number'
        ) {
            return null;
        }

        return value;
    } catch (err) {
        return null;
    }
}

const LOGO_ANALYSIS_MIN_QUALITY = 70;

function isHighQualityLogo(quality) {
    return (
        quality &&
        quality.qualityScore >= 90
    );
}

function isLogoUsableForAnalysis(quality) {
    /*
     * metaのない既存LGDは従来互換のため利用する。
     * 品質評価済みLGDは70点以上だけCM解析に利用する。
     */
    return (
        quality === null ||
        (
            typeof quality.qualityScore === 'number' &&
            quality.qualityScore >=
                LOGO_ANALYSIS_MIN_QUALITY
        )
    );
}

function isUsableFile(filePath) {
    try {
        const stat = fs.statSync(filePath);

        return (
            stat.isFile() &&
            stat.size > 0
        );
    } catch (err) {
        return false;
    }
}

function validateStationId(stationId) {
    if (!stationId) {
        throw new Error(
            'station short name is empty'
        );
    }

    if (!/^[A-Za-z0-9_-]+$/.test(stationId)) {
        throw new Error(
            `invalid station id: ${stationId}`
        );
    }
}

async function prepareLogoForStation(
    workInput,
    channelName,
    stationId,
    recordedId = null,
    throwOnGenerationFailure = false
) {
    stationId = String(stationId);
    validateStationId(stationId);

    fs.mkdirSync(
        LOGO_ROOT,
        { recursive: true }
    );

    const logoPath =
        path.join(
            LOGO_ROOT,
            `${stationId}.lgd`
        );

    const metaPath =
        path.join(
            LOGO_ROOT,
            `${stationId}.lgd.meta.json`
        );

    const existingLogo =
        isUsableFile(logoPath);

    const existingQuality =
        readLogoQuality(metaPath);

    /*
     * 既に十分高品質ならgenlogoを実行しない。
     */
    if (
        existingLogo &&
        isHighQualityLogo(existingQuality)
    ) {
        if (
            channelName &&
            (
                typeof existingQuality.channelName !== 'string' ||
                existingQuality.channelName.length === 0
            )
        ) {
            existingQuality.channelName =
                String(channelName);

            fs.writeFileSync(
                metaPath,
                JSON.stringify(
                    existingQuality,
                    null,
                    2
                ) + '\n',
                'utf8'
            );
        }

        log(
            'logo cache hit high quality',
            `station=${stationId}`,
            `quality=${existingQuality.qualityScore.toFixed(2)}`,
            `path=${logoPath}`
        );

        return {
            stationId,
            logoPath,
            logoGenerated: false,
        };
    }

    /*
     * 正式LGDへ直接書かず、一時候補として生成する。
     */
    const candidateLogoPath =
        path.join(
            '/tmp',
            `genlogo-${stationId}-${process.pid}-${Date.now()}.lgd`
        );

    log(
        'logo generation start',
        `station=${stationId}`,
        existingQuality
            ? `currentQuality=${existingQuality.qualityScore.toFixed(2)}`
            : 'currentQuality=unknown',
        `input=${workInput}`
    );

    try {
        const result =
            await spawnAndCapture(
                GENLOGO_COMMAND,
                [
                    '-i',
                    workInput,
                    '-o',
                    candidateLogoPath,
                    '--auto-roi',
                    '--name',
                    stationId,
                ],
                {},
                recordedId === null
                    ? null
                    : String(recordedId)
            );

        if (!isUsableFile(candidateLogoPath)) {
            throw new Error(
                `generated logo is invalid: ${candidateLogoPath}`
            );
        }

        const candidateQuality =
            parseLogoQuality(
                result.stderr
            );

        candidateQuality.stationId =
            stationId;

        candidateQuality.channelName =
            String(channelName || '');

        candidateQuality.generatedAt =
            new Date().toISOString();

        log(
            'logo candidate quality',
            `station=${stationId}`,
            `quality=${candidateQuality.qualityScore.toFixed(2)}`,
            `roi=${candidateQuality.roiScore}`,
            `accepted=${candidateQuality.acceptedFrames}`,
            `blackRatio=${candidateQuality.blackRatio.toFixed(4)}`
        );

        let promote = false;
        let reason = '';

        if (!existingLogo) {
            promote = true;
            reason = 'no-existing-logo';
        } else if (!existingQuality) {
            /*
             * 品質情報のない旧LGDは保守的に扱う。
             * 新候補が十分高品質な場合だけ更新する。
             */
            promote =
                isHighQualityLogo(
                    candidateQuality
                );

            reason =
                promote
                    ? 'legacy-logo-high-quality-candidate'
                    : 'legacy-logo-kept';
        } else if (
            candidateQuality.qualityScore >
            existingQuality.qualityScore
        ) {
            promote = true;
            reason = 'better-quality';
        } else {
            reason = 'existing-quality-better';
        }

        if (promote) {
            /*
             * copyFileSyncなので既存LGDは候補が
             * 正常生成・品質評価された後にだけ更新される。
             */
            fs.copyFileSync(
                candidateLogoPath,
                logoPath
            );

            fs.writeFileSync(
                metaPath,
                JSON.stringify(
                    candidateQuality,
                    null,
                    2
                ) + '\n',
                'utf8'
            );

            log(
                'logo promoted',
                `station=${stationId}`,
                `quality=${candidateQuality.qualityScore.toFixed(2)}`,
                `reason=${reason}`,
                `path=${logoPath}`
            );
        } else {
            log(
                'logo candidate not promoted',
                `station=${stationId}`,
                `quality=${candidateQuality.qualityScore.toFixed(2)}`,
                `reason=${reason}`
            );
        }
    } catch (err) {
        /*
         * 新候補生成失敗時も、
         * 既存LGDがあればそれを維持する。
         */
        if (existingLogo && !throwOnGenerationFailure) {
            if (
                isLogoUsableForAnalysis(
                    existingQuality
                )
            ) {
                log(
                    'logo generation failed; using existing logo',
                    `station=${stationId}`,
                    existingQuality
                        ? `quality=${existingQuality.qualityScore.toFixed(2)}`
                        : 'quality=unknown',
                    err
                );

                return {
                    stationId,
                    logoPath,
                    logoGenerated: false,
                };
            }

            log(
                'logo generation failed; existing logo quality too low for analysis',
                `station=${stationId}`,
                `quality=${existingQuality.qualityScore.toFixed(2)}`,
                `minimum=${LOGO_ANALYSIS_MIN_QUALITY}`,
                err
            );

            throw new Error(
                `usable station logo is unavailable: ${logoPath} ` +
                `(quality=${existingQuality.qualityScore.toFixed(2)}, ` +
                `minimum=${LOGO_ANALYSIS_MIN_QUALITY})`
            );
        }

        throw err;
    }

    if (!isUsableFile(logoPath)) {
        throw new Error(
            `usable station logo is unavailable: ${logoPath}`
        );
    }

    const finalQuality =
        readLogoQuality(metaPath);

    if (!isLogoUsableForAnalysis(finalQuality)) {
        log(
            'station logo quality too low for analysis',
            `station=${stationId}`,
            `quality=${finalQuality.qualityScore.toFixed(2)}`,
            `minimum=${LOGO_ANALYSIS_MIN_QUALITY}`,
            `path=${logoPath}`
        );

        throw new Error(
            `usable station logo is unavailable: ${logoPath} ` +
            `(quality=${finalQuality.qualityScore.toFixed(2)}, ` +
            `minimum=${LOGO_ANALYSIS_MIN_QUALITY})`
        );
    }

    log(
        'logo preparation finished',
        `station=${stationId}`,
        finalQuality
            ? `quality=${finalQuality.qualityScore.toFixed(2)}`
            : 'quality=unknown',
        `path=${logoPath}`
    );

    return {
        stationId,
        logoPath,
        logoGenerated: true,
    };
}


async function prepareLogo(
    workInput,
    channelName,
    recordedId
) {
    const channel = parseChannel(workInput);

    if (!channel || !channel.short) {
        throw new Error(
            `channel not recognized: ${path.basename(workInput)}`
        );
    }

    return prepareLogoForStation(
        workInput,
        channelName,
        String(channel.short),
        recordedId
    );
}


function parseTime(value) {
    const match =
        /^(\d+):(\d{2}):(\d{2})\.(\d{3})$/.exec(
            value
        );

    if (!match) {
        throw new Error(
            `invalid chapter time: ${value}`
        );
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);

    return (
        hours * 3600 +
        minutes * 60 +
        seconds +
        milliseconds / 1000
    );
}

function parseChapters(filePath) {
    const text =
        fs.readFileSync(filePath, 'utf8');

    const lines =
        text.split(/\r?\n/);

    const chapters = [];
    const byNumber = new Map();

    for (const line of lines) {
        let match =
            /^CHAPTER(\d+)=(.+)$/.exec(line);

        if (match) {
            const number =
                Number(match[1]);

            const chapter = {
                number,
                time:
                    parseTime(
                        match[2].trim()
                    ),
                timeText:
                    match[2].trim(),
                name: '',
            };

            byNumber.set(
                number,
                chapter
            );

            chapters.push(chapter);
            continue;
        }

        match =
            /^CHAPTER(\d+)NAME=(.*)$/.exec(line);

        if (match) {
            const number =
                Number(match[1]);

            const chapter =
                byNumber.get(number);

            if (chapter) {
                chapter.name =
                    match[2].trim();
            }
        }
    }

    chapters.sort(
        (a, b) => a.number - b.number
    );

    return chapters;
}

function parseJlscp(filePath) {
    const text =
        fs.readFileSync(filePath, 'utf8');

    const segments = [];
    const cmRanges = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line) {
            continue;
        }

        const match =
            /^(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+:(\S+)$/
                .exec(line);

        if (!match) {
            continue;
        }

        const segment = {
            startFrame: Number(match[1]),
            endFrame: Number(match[2]),
            duration: Number(match[3]),
            diff: Number(match[4]),
            logoDuration: Number(match[5]),
            type: match[6],
        };

        segments.push(segment);

        if (segment.type === 'CM') {
            cmRanges.push({
                startFrame:
                    segment.startFrame,
                endFrame:
                    segment.endFrame,
            });
        }
    }

    return {
        segments,
        cmRanges,
    };
}


function buildPlaybackCmRanges(chapters, videoFps) {
    const ranges = [];

    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];

        if (chapter.name !== 'XCM') {
            continue;
        }

        let endChapter = null;

        for (let j = i + 1; j < chapters.length; j++) {
            const candidate = chapters[j];

            // A10Sec / B60Sec / C90Sec などは
            // CM後の付随区間としてスキップを継続する
            if (/\d+Sec$/.test(candidate.name)) {
                continue;
            }

            endChapter = candidate;
            break;
        }

        if (!endChapter) {
            continue;
        }

        ranges.push({
            startFrame:
                Math.round(
                    chapter.time * videoFps
                ),
            endFrame:
                Math.max(
                    Math.round(
                        endChapter.time * videoFps
                    ) - 1,
                    0
                ),
            startTime:
                chapter.time,
            endTime:
                endChapter.time,
        });
    }

    return ranges;
}


function parseKeepRanges(filePath) {
    const text =
        fs.readFileSync(filePath, 'utf8');

    const ranges = [];

    const regex =
        /Trim\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;

    let match;

    while (
        (match = regex.exec(text)) !== null
    ) {
        ranges.push({
            startFrame: Number(match[1]),
            endFrame: Number(match[2]),
        });
    }

    if (ranges.length === 0) {
        throw new Error(
            `no Trim ranges found: ${filePath}`
        );
    }

    return ranges;
}

function buildCutRanges(
    keepRanges,
    cmRanges,
    totalFrames,
    videoFps
) {
    const ranges = [];

    if (
        !Array.isArray(keepRanges) ||
        keepRanges.length === 0
    ) {
        return ranges;
    }

    const sortedKeepRanges =
        [...keepRanges].sort(
            (a, b) =>
                a.startFrame - b.startFrame
        );

    const addRange =
        (startFrame, endFrame, kind) => {
            if (endFrame < startFrame) {
                return;
            }

            ranges.push({
                startFrame,
                endFrame,
                startTime:
                    startFrame / videoFps,
                endTime:
                    (endFrame + 1) / videoFps,
                kind,
            });
        };

    const classifyInternalRange =
        (startFrame, endFrame) => {
            const overlapsCm =
                cmRanges.some(range =>
                    range.startFrame <= endFrame &&
                    range.endFrame >= startFrame
                );

            return overlapsCm
                ? 'cm'
                : 'other';
        };

    const first =
        sortedKeepRanges[0];

    if (first.startFrame > 0) {
        addRange(
            0,
            first.startFrame - 1,
            'head'
        );
    }

    for (
        let i = 0;
        i < sortedKeepRanges.length - 1;
        i++
    ) {
        const current =
            sortedKeepRanges[i];
        const next =
            sortedKeepRanges[i + 1];

        const startFrame =
            current.endFrame + 1;
        const endFrame =
            next.startFrame - 1;

        if (endFrame >= startFrame) {
            addRange(
                startFrame,
                endFrame,
                classifyInternalRange(
                    startFrame,
                    endFrame
                )
            );
        }
    }

    const last =
        sortedKeepRanges[
            sortedKeepRanges.length - 1
        ];

    if (
        Number.isInteger(totalFrames) &&
        totalFrames > 0 &&
        last.endFrame < totalFrames - 1
    ) {
        addRange(
            last.endFrame + 1,
            totalFrames - 1,
            'tail'
        );
    }

    return ranges;
}


function buildAnalysis(outputRoot, metadata) {
    const chapterPath =
        path.join(
            outputRoot,
            'obs_chapter_org.chapter.txt'
        );

    const jlscpPath =
        path.join(
            outputRoot,
            'obs_jlscp.txt'
        );

    const cutPath =
        path.join(
            outputRoot,
            'obs_cut.avs'
        );

    for (const required of [
        chapterPath,
        jlscpPath,
        cutPath,
    ]) {
        if (!isUsableFile(required)) {
            throw new Error(
                `analysis file not found or empty: ${required}`
            );
        }
    }

    const chapters =
        parseChapters(chapterPath);

    const {
        segments,
        cmRanges,
    } = parseJlscp(jlscpPath);

    const keepRanges =
        parseKeepRanges(cutPath);

    const playbackCmRanges =
        buildPlaybackCmRanges(
            chapters,
            metadata.videoFps
        );

    const totalFrames =
        Number.isFinite(metadata.videoDuration)
            ? Math.round(
                metadata.videoDuration *
                metadata.videoFps
            )
            : null;

    const cutRanges =
        buildCutRanges(
            keepRanges,
            playbackCmRanges,
            totalFrames,
            metadata.videoFps
        );

    const firstKeepRange =
        keepRanges[0];

    const lastKeepRange =
        keepRanges[
            keepRanges.length - 1
        ];

    const playbackStart =
        firstKeepRange.startFrame /
        metadata.videoFps;

    const playbackEnd =
        (
            lastKeepRange.endFrame + 1
        ) /
        metadata.videoFps;

    return {
        version: 2,
        recordedId:
            metadata.recordedId,
        stationId:
            metadata.stationId,
        source: {
            epgstationPath:
                metadata.epgstationPath,
            sourcePath:
                metadata.sourcePath,
        },
        analyzedAt:
            metadata.analyzedAt,
        timeline: {
            frameRate:
                metadata.videoFps,

            /*
             * chapters:
             *   Head-seek chapter positions for the original
             *   uncut recording timeline.
             *
             * cmRanges:
             *   Explicit :CM segments only.
             *   Used for playback auto-skip.
             *
             * keepRanges:
             *   Exact Trim() ranges from obs_cut.avs.
             *   Used for physical CM-cut encoding and for
             *   retiming chapters/comments after cutting.
             */
            chapters,
            cmRanges:
                playbackCmRanges,
            keepRanges,
            cutRanges,
            playbackStart,
            playbackEnd,
        },
        jlse: {
            segments,
        },
    };
}

async function prepareJlseInput(
    workInput,
    recordedId
) {
    if (
        path.extname(workInput).toLowerCase() === '.ts'
    ) {
        return {
            inputPath: workInput,
            temporary: false,
        };
    }

    const remuxDir =
        path.join(
            LOGO_COLLECT_TMP_ROOT,
            'jlse-remux',
            String(recordedId)
        );

    fs.mkdirSync(
        remuxDir,
        { recursive: true }
    );

    const jlseInput =
        path.join(
            remuxDir,
            `${path.basename(
                workInput,
                path.extname(workInput)
            )}.ts`
        );

    for (const cleanupPath of [
        jlseInput,
        `${jlseInput}.lwi`,
    ]) {
        if (fs.existsSync(cleanupPath)) {
            fs.unlinkSync(cleanupPath);
        }
    }

    log(
        'non-ts input; remuxing for jlse',
        `recordedId=${recordedId}`,
        `source=${workInput}`,
        `output=${jlseInput}`
    );

    try {
        await spawnAndWait(
            FFMPEG_COMMAND,
            [
                '-hide_banner',
                '-loglevel',
                'warning',
                '-y',
                '-i',
                workInput,
                '-map',
                '0:v:0',
                '-map',
                '0:a:0?',
                '-c',
                'copy',
                '-muxdelay',
                '0',
                '-f',
                'mpegts',
                jlseInput,
            ],
            {
                stdio: [
                    'ignore',
                    'inherit',
                    'inherit',
                ],
            },
            String(recordedId)
        );

        if (!isUsableFile(jlseInput)) {
            throw new Error(
                `temporary jlse ts is invalid: ${jlseInput}`
            );
        }
    } catch (err) {
        for (const cleanupPath of [
            jlseInput,
            `${jlseInput}.lwi`,
        ]) {
            if (!fs.existsSync(cleanupPath)) {
                continue;
            }

            try {
                fs.unlinkSync(cleanupPath);
            } catch (cleanupErr) {
                log(
                    'temporary jlse file cleanup failed',
                    `recordedId=${recordedId}`,
                    `path=${cleanupPath}`,
                    cleanupErr
                );
            }
        }

        throw err;
    }

    log(
        'non-ts remux finished',
        `recordedId=${recordedId}`,
        `input=${jlseInput}`
    );

    return {
        inputPath: jlseInput,
        temporary: true,
    };
}


async function runAnalysis(job) {
    running = true;
    currentJob = job;

    const sourcePath = job.sourcePath;

    /*
     * LWLibavAudioSource / VideoSource creates .lwi beside the input.
     * Therefore JLSE must not use the read-only recording directly.
     */
    const workDir =
        path.join(
            '/work',
            String(job.recordedId)
        );

    fs.mkdirSync(
        workDir,
        { recursive: true }
    );

    const channelName =
        safeName(
            job.channelName || 'unknown'
        );

    const sourceBase =
        safeName(
            path.basename(sourcePath)
        );

    const workInput =
        path.join(
            workDir,
            `${channelName}_${sourceBase}`
        );

    let jlseInputInfo = null;

    try {
        if (fs.existsSync(workInput)) {
            fs.unlinkSync(workInput);
        }

        fs.symlinkSync(
            sourcePath,
            workInput
        );

        let logo;
        let noLogo = false;

        try {
            logo =
                await prepareLogo(
                    workInput,
                    job.channelName,
                    String(job.recordedId)
                );
        } catch (err) {
            const message =
                err && err.message
                    ? String(err.message)
                    : String(err);

            if (
                !message.startsWith(
                    'usable station logo is unavailable:'
                )
            ) {
                throw err;
            }

            const channel =
                parseChannel(workInput);

            if (!channel || !channel.short) {
                throw err;
            }

            noLogo = true;
            logo = {
                stationId: String(channel.short),
                logoPath: null,
                logoGenerated: false,
            };

            log(
                'station logo unavailable; using no-logo analysis',
                `station=${logo.stationId}`,
                `recordedId=${job.recordedId}`
            );
        }

        currentJob = {
            ...job,
            stationId:
                logo.stationId,
        };

        log(
            'analysis start',
            JSON.stringify({
                recordedId:
                    job.recordedId,
                input:
                    workInput,
                channelName:
                    job.channelName,
                stationId:
                    logo.stationId,
                title:
                    job.title,
            })
        );

        jlseInputInfo =
            await prepareJlseInput(
                workInput,
                String(job.recordedId)
            );

        const resultName =
            path.basename(
                jlseInputInfo.inputPath,
                path.extname(
                    jlseInputInfo.inputPath
                )
            );

        const jlseArgs = [
            '-i',
            jlseInputInfo.inputPath,
        ];

        if (noLogo) {
            jlseArgs.push('--nologo');
        }

        log(
            'jlse start',
            `recordedId=${job.recordedId}`,
            `input=${jlseInputInfo.inputPath}`,
            `noLogo=${noLogo}`
        );

        await spawnAndWait(
            '/usr/local/bin/jlse',
            jlseArgs,
            {
                cwd: JLSE_ROOT,
                stdio: [
                    'ignore',
                    'inherit',
                    'inherit',
                ],
            },
            String(job.recordedId)
        );

        if (
            canceledRecordedIds.has(
                String(job.recordedId)
            )
        ) {
            throw new Error(
                `analysis canceled: recordedId=${job.recordedId}`
            );
        }

        log(
            'analysis finished',
            `recordedId=${job.recordedId}`,
            'exit=0'
        );

        const sourceResult =
            path.join(
                JLSE_RESULT_ROOT,
                resultName
            );

        const outputRoot =
            path.join(
                DATA_ROOT,
                String(job.recordedId)
            );

        if (!fs.existsSync(sourceResult)) {
            throw new Error(
                `result directory not found: ${sourceResult}`
            );
        }

        copyDirectory(
            sourceResult,
            outputRoot
        );

        const videoMetadata =
            await getVideoMetadata(
                workInput,
                String(job.recordedId)
            );

        const videoFps =
            videoMetadata.frameRate;

        const videoDuration =
            videoMetadata.duration;

        log(
            'video metadata',
            `recordedId=${job.recordedId}`,
            `fps=${videoFps}`,
            `duration=${videoDuration}`
        );

        const metadata = {
            recordedId:
                job.recordedId,
            title:
                job.title,
            channelName:
                job.channelName,
            stationId:
                logo.stationId,
            logoPath:
                logo.logoPath,
            logoGenerated:
                logo.logoGenerated,
            epgstationPath:
                job.recPath,
            sourcePath:
                job.sourcePath,
            analyzedAt:
                new Date().toISOString(),
            videoFps,
            videoDuration,
        };

        const analysis =
            buildAnalysis(
                outputRoot,
                metadata
            );

        fs.writeFileSync(
            path.join(
                outputRoot,
                'metadata.json'
            ),
            JSON.stringify(
                metadata,
                null,
                2
            ) + '\n',
            'utf8'
        );

        fs.writeFileSync(
            path.join(
                outputRoot,
                'analysis.json'
            ),
            JSON.stringify(
                analysis,
                null,
                2
            ) + '\n',
            'utf8'
        );

        log(
            'result copied',
            outputRoot
        );

        log(
            'analysis metadata written',
            JSON.stringify({
                chapters:
                    analysis.timeline
                        .chapters.length,
                cmRanges:
                    analysis.timeline
                        .cmRanges.length,
                keepRanges:
                    analysis.timeline
                        .keepRanges.length,
            })
        );
    } catch (err) {
        log(
            'analysis failed',
            err
        );
    } finally {
        if (
            jlseInputInfo !== null &&
            jlseInputInfo.temporary
        ) {
            for (const cleanupPath of [
                jlseInputInfo.inputPath,
                `${jlseInputInfo.inputPath}.lwi`,
            ]) {
                if (!fs.existsSync(cleanupPath)) {
                    continue;
                }

                try {
                    fs.unlinkSync(cleanupPath);

                    log(
                        'temporary jlse file deleted',
                        `recordedId=${job.recordedId}`,
                        `path=${cleanupPath}`
                    );
                } catch (err) {
                    log(
                        'temporary jlse file delete failed',
                        `recordedId=${job.recordedId}`,
                        `path=${cleanupPath}`,
                        err
                    );
                }
            }
        }

        canceledRecordedIds.delete(
            String(job.recordedId)
        );
        currentAnalysisChild = null;
        running = false;
        currentJob = null;
    }
}



function collectorHttpGetBuffer(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            const chunks = [];
            res.on('data', c => chunks.push(Buffer.from(c)));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`GET ${url} failed: HTTP ${res.statusCode}`));
                    return;
                }
                resolve(body);
            });
        });
        req.setTimeout(10000, () => req.destroy(new Error(`GET ${url} timed out`)));
        req.on('error', reject);
    });
}

async function loadEpgstationChannels() {
    const body = await collectorHttpGetBuffer(
        `${EPGSTATION_URL}/api/channels?isHalfWidth=false`
    );
    const value = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(value)) {
        throw new Error('EPGStation channels response is not an array');
    }
    return value;
}

async function loadEpgstationBroadcastingSchedules() {
    const body = await collectorHttpGetBuffer(
        `${EPGSTATION_URL}/api/schedules/broadcasting?isHalfWidth=false`
    );
    const value = JSON.parse(body.toString('utf8'));
    if (!Array.isArray(value)) {
        throw new Error('EPGStation broadcasting response is not an array');
    }
    return value;
}

function buildCollectorProgramIndex(schedules) {
    const index = new Map();

    for (const schedule of schedules) {
        const channelId = Number(schedule && schedule.channel && schedule.channel.id);
        const program = Array.isArray(schedule && schedule.programs)
            ? schedule.programs[0]
            : null;

        if (!Number.isFinite(channelId) || !program) {
            continue;
        }

        index.set(channelId, program);
    }

    return index;
}

function isCollectorAnimeProgram(program) {
    return [program && program.genre1, program && program.genre2, program && program.genre3]
        .some(genre => Number(genre) === 7);
}

function normalizeCollectorChannelName(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function loadCollectorChannelMappings() {
    const csvPath = path.join(JLSE_ROOT, 'setting/ChList.csv');
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1);
    const mappings = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const columns = line.split(',');
        if (columns.length < 3) continue;
        const stationId = String(columns[2] || '').trim();
        if (!stationId) continue;
        validateStationId(stationId);
        for (const raw of [columns[0], columns[1]]) {
            const name = String(raw || '').trim();
            if (!name) continue;
            mappings.push({
                name,
                normalized: normalizeCollectorChannelName(name),
                stationId,
            });
        }
    }

    // Current names for legacy ChList entries.
    for (const [name, stationId] of [
        ['NHK BS', 'BS1'],
        ['BSテレ東', 'BSJ'],
    ]) {
        mappings.push({
            name,
            normalized: normalizeCollectorChannelName(name),
            stationId,
        });
    }
    return mappings;
}

function resolveCollectorStation(channelName, mappings) {
    const normalized = normalizeCollectorChannelName(channelName);
    if (!normalized) return null;

    for (const mapping of mappings) {
        if (mapping.normalized === normalized) return mapping.stationId;
    }

    let best = null;
    for (const mapping of mappings) {
        if (mapping.normalized.length < 3) continue;
        if (
            normalized.includes(mapping.normalized) ||
            mapping.normalized.includes(normalized)
        ) {
            if (!best || mapping.normalized.length > best.normalized.length) {
                best = mapping;
            }
        }
    }
    return best ? best.stationId : null;
}

function readCollectorState() {
    try {
        const value = JSON.parse(fs.readFileSync(LOGO_COLLECT_STATE_PATH, 'utf8'));
        if (value && typeof value === 'object' &&
            value.stations && typeof value.stations === 'object') {
            return value;
        }
    } catch (_) {}
    return {
        version: 1,
        stations: {},
        unsupported: {},
    };
}

function writeCollectorState(state) {
    if (!state.unsupported || typeof state.unsupported !== 'object') {
        state.unsupported = {};
    }

    fs.mkdirSync(DATA_ROOT, { recursive: true });
    const tmp = `${LOGO_COLLECT_STATE_PATH}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, LOGO_COLLECT_STATE_PATH);
}

function collectorLogoStatus(stationId) {
    const logoPath = path.join(LOGO_ROOT, `${stationId}.lgd`);
    const metaPath = path.join(LOGO_ROOT, `${stationId}.lgd.meta.json`);
    const hasLogo = isUsableFile(logoPath);
    const quality = readLogoQuality(metaPath);
    if (hasLogo && isHighQualityLogo(quality)) {
        return { status: 'good', qualityScore: quality.qualityScore };
    }
    if (hasLogo) {
        return { status: 'improving', qualityScore: quality ? quality.qualityScore : null };
    }
    return { status: 'missing', qualityScore: null };
}

function updateUnsupportedCollectorState(channels, state) {
    const mappings = loadCollectorChannelMappings();
    const unsupported = {};

    for (const channel of channels) {
        const stationId =
            resolveCollectorStation(channel.name, mappings);

        if (stationId) {
            continue;
        }

        const serviceId = Number(channel.id);
        if (!Number.isFinite(serviceId)) {
            continue;
        }

        const key = String(channel.id);

        unsupported[key] = {
            serviceId: key,
            channelName: String(channel.name || ''),
            channelType: String(channel.channelType || ''),
            physicalChannel: String(channel.channel || ''),
            status: 'unsupported',
            qualityScore: null,
        };
    }

    state.unsupported = unsupported;
}

function buildCollectorStations(channels) {
    const mappings = loadCollectorChannelMappings();
    const stations = new Map();
    for (const channel of channels) {
        const stationId = resolveCollectorStation(channel.name, mappings);
        if (!stationId || stations.has(stationId)) continue;
        const serviceId = Number(channel.id);
        if (!Number.isFinite(serviceId)) continue;
        stations.set(stationId, {
            stationId,
            channelName: String(channel.name || ''),
            serviceId: String(channel.id),
            channelType: String(channel.channelType || ''),
            physicalChannel: String(channel.channel || ''),
        });
    }
    return [...stations.values()];
}

function collectorDelayMs(failures) {
    if (failures >= LOGO_COLLECT_SUSPEND_FAILURES) return LOGO_COLLECT_SUSPEND_MS;
    if (failures >= LOGO_COLLECT_BACKOFF_FAILURES) return LOGO_COLLECT_BACKOFF_MS;
    return LOGO_COLLECT_INTERVAL_MINUTES * 60 * 1000;
}

function collectorStateName(logoStatus, failures) {
    if (logoStatus === 'good') return 'good';
    if (failures >= LOGO_COLLECT_SUSPEND_FAILURES) return 'suspended';
    if (failures >= LOGO_COLLECT_BACKOFF_FAILURES) return 'backoff';
    return logoStatus;
}

function pruneCollectorStationState(stations, state) {
    if (!state.stations || typeof state.stations !== 'object') {
        state.stations = {};
        return;
    }

    const currentStationIds =
        new Set(
            stations.map(
                station => station.stationId
            )
        );

    for (const stationId of Object.keys(state.stations)) {
        if (!currentStationIds.has(stationId)) {
            delete state.stations[stationId];
        }
    }
}

function selectCollectorTarget(stations, state, worker, programIndex) {
    const now = Date.now();
    const candidates = [];
    for (const station of stations) {
        const matchesWorker =
            worker === 'GR'
                ? station.channelType === 'GR'
                : (station.channelType === 'BS' || station.channelType === 'CS');

        if (!matchesWorker) {
            continue;
        }
        const program = programIndex.get(Number(station.serviceId));
        const programEndAt = Number(program && program.endAt);
        const remainingMs = Number.isFinite(programEndAt)
            ? programEndAt - now
            : 0;
        const minimumRemainingMs =
            (LOGO_COLLECT_SAMPLE_SECONDS + 60) * 1000;

        // Avoid sampling across a program boundary. A stable single-program
        // sample is preferable for logo generation.
        if (!program || remainingMs < minimumRemainingMs) {
            continue;
        }

        const animeReady = isCollectorAnimeProgram(program);

        const logo = collectorLogoStatus(station.stationId);
        const prev = state.stations[station.stationId] || {};
        const failures = Number(prev.consecutiveDetectionFailures || 0);
        const status = collectorStateName(logo.status, failures);
        state.stations[station.stationId] = {
            ...prev,
            ...station,
            status,
            logoStatus: logo.status,
            qualityScore: logo.qualityScore,
        };
        const next = Date.parse(prev.nextCollectAt || '');
        const due = !Number.isFinite(next) || next <= now;
        if (status !== 'good' && due) {
            candidates.push({
                ...station,
                logoStatus: logo.status,
                qualityScore: logo.qualityScore,
                failures,
                animeReady,
                programName: program.name || '',
                programEndAt,
                lastCollectAt: prev.lastCollectAt || '',
            });
        }
    }
    candidates.sort((a, b) => {
        const statusPriority = value =>
            value === 'missing' ? 0 : 1;

        const channelPriority = value => {
            if (value === 'GR') return 0;
            if (value === 'BS') return 1;
            if (value === 'CS') return 2;
            return 3;
        };

        const as = statusPriority(a.logoStatus);
        const bs = statusPriority(b.logoStatus);
        if (as !== bs) return as - bs;

        if (a.animeReady !== b.animeReady) {
            return a.animeReady ? -1 : 1;
        }

        const ac = channelPriority(a.channelType);
        const bc = channelPriority(b.channelType);
        if (ac !== bc) return ac - bc;

        const aq = a.qualityScore == null ? -1 : a.qualityScore;
        const bq = b.qualityScore == null ? -1 : b.qualityScore;
        if (aq !== bq) return aq - bq;

        return a.lastCollectAt.localeCompare(b.lastCollectAt);
    });
    return candidates[0] || null;
}

function sampleLiveService(station, outputPath) {
    return new Promise((resolve, reject) => {
        const url = `${MIRAKURUN_URL}/api/services/${encodeURIComponent(station.serviceId)}/stream`;
        const file = fs.createWriteStream(outputPath, { flags: 'wx' });
        let req = null;
        let res = null;
        let settled = false;
        let bytes = 0;
        let timer = null;

        const finish = (kind, err = null) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (req) req.destroy();
            if (res) res.destroy();
            file.end(() => err ? reject(err) : resolve({ kind, bytes }));
        };

        file.on('error', err => finish('transport-failure', err));

        req = http.get(url, {
            headers: { 'X-Mirakurun-Priority': String(LOGO_COLLECT_PRIORITY) },
        }, response => {
            res = response;
            if (res.statusCode < 200 || res.statusCode >= 300) {
                finish('transport-failure',
                    new Error(`Mirakurun stream HTTP ${res.statusCode}`));
                return;
            }
            res.on('data', chunk => {
                bytes += chunk.length;
                if (!file.write(chunk)) {
                    res.pause();
                    file.once('drain', () => res.resume());
                }
            });
            res.on('end', () => finish('preempted'));
            res.on('aborted', () => finish('preempted'));
            res.on('error', () => finish('preempted'));
        });

        req.on('error', err => {
            if (!settled) finish('transport-failure', err);
        });

        timer = setTimeout(
            () => finish('complete'),
            LOGO_COLLECT_SAMPLE_SECONDS * 1000
        );
    });
}

async function getCollectorSampleDuration(filePath) {
    const result = await spawnAndCapture(
        FFPROBE_COMMAND,
        ['-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', filePath]
    );
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`invalid collector sample duration: ${result.stdout.trim()}`);
    }
    return duration;
}

function updateCollectorState(state, station, detectionResult, detail) {
    const now = new Date();
    const prev = state.stations[station.stationId] || {};
    const oldFailures = Number(prev.consecutiveDetectionFailures || 0);
    let failures = oldFailures;

    if (detectionResult === true) failures = 0;
    if (detectionResult === false) failures = oldFailures + 1;

    const logo = collectorLogoStatus(station.stationId);
    const delay = logo.status === 'good'
        ? null
        : (detectionResult === null
            ? LOGO_COLLECT_INTERVAL_MINUTES * 60 * 1000
            : collectorDelayMs(failures));

    state.stations[station.stationId] = {
        ...prev,
        ...station,
        lastCollectAt: now.toISOString(),
        nextCollectAt: delay === null ? null
            : new Date(now.getTime() + delay).toISOString(),
        consecutiveDetectionFailures: failures,
        status: collectorStateName(logo.status, failures),
        logoStatus: logo.status,
        qualityScore: logo.qualityScore,
        lastResult: detail,
    };
}

function updateLatestCollectorStationState(
    station,
    detectionResult,
    detail
) {
    /*
     * GR / BSCS workers can run concurrently.
     * Re-read the latest state immediately before updating one station
     * so one worker cannot overwrite the other worker's completed result.
     */
    const latestState = readCollectorState();

    updateCollectorState(
        latestState,
        station,
        detectionResult,
        detail
    );

    writeCollectorState(latestState);
}

const logoCollectorRunning = {
    GR: false,
    BSCS: false,
};

const logoCollectorWorkerStatus = {
    GR: {
        phase: 'idle',
        stationId: null,
        channelName: null,
        programName: null,
    },
    BSCS: {
        phase: 'idle',
        stationId: null,
        channelName: null,
        programName: null,
    },
};

function setLogoCollectorWorkerStatus(worker, phase, target = null) {
    if (!Object.prototype.hasOwnProperty.call(
        logoCollectorWorkerStatus,
        worker
    )) {
        return;
    }

    logoCollectorWorkerStatus[worker] = {
        phase,
        stationId:
            target && typeof target.stationId !== 'undefined'
                ? String(target.stationId)
                : null,
        channelName:
            target && target.channelName
                ? String(target.channelName)
                : null,
        programName:
            target && target.programName
                ? String(target.programName)
                : null,
    };
}

function getLogoCollectorRuntimeStatus() {
    const workerStatus = worker => ({
        running: logoCollectorRunning[worker],
        phase: logoCollectorWorkerStatus[worker].phase,
        stationId: logoCollectorWorkerStatus[worker].stationId,
        channelName: logoCollectorWorkerStatus[worker].channelName,
        programName: logoCollectorWorkerStatus[worker].programName,
    });

    return {
        enabled: logoCollectorEnabled,
        startupEnabled: LOGO_COLLECT_ENABLED,
        workers: {
            GR: workerStatus('GR'),
            BSCS: workerStatus('BSCS'),
        },
    };
}

async function runLogoCollectorOnce(worker) {
    if (
        !logoCollectorEnabled ||
        !Object.prototype.hasOwnProperty.call(logoCollectorRunning, worker) ||
        logoCollectorRunning[worker]
    ) return;

    // Normal CM analysis always wins CPU/I/O scheduling.
    if (running || jobQueue.length > 0) return;

    logoCollectorRunning[worker] = true;
    setLogoCollectorWorkerStatus(worker, 'selecting');
    let samplePath = null;

    try {
        fs.mkdirSync(LOGO_COLLECT_TMP_ROOT, { recursive: true });
        const [channels, broadcastingSchedules] = await Promise.all([
            loadEpgstationChannels(),
            loadEpgstationBroadcastingSchedules(),
        ]);
        const state = readCollectorState();
        const programIndex =
            buildCollectorProgramIndex(broadcastingSchedules);

        updateUnsupportedCollectorState(
            channels,
            state
        );

        const stations = buildCollectorStations(channels);

        pruneCollectorStationState(
            stations,
            state
        );

        const target = selectCollectorTarget(
            stations,
            state,
            worker,
            programIndex
        );
        writeCollectorState(state);
        if (!target) return;

        samplePath = path.join(
            LOGO_COLLECT_TMP_ROOT,
            `logo-${target.stationId}-${process.pid}-${Date.now()}.ts`
        );

        log('logo collector sample start',
            `worker=${worker}`,
            `station=${target.stationId}`,
            `channel=${target.channelName}`,
            `serviceId=${target.serviceId}`,
            `program=${target.programName}`,
            `anime=${target.animeReady}`,
            `priority=${LOGO_COLLECT_PRIORITY}`,
            `seconds=${LOGO_COLLECT_SAMPLE_SECONDS}`);

        let sample;
        setLogoCollectorWorkerStatus(worker, 'sampling', target);
        try {
            sample = await sampleLiveService(target, samplePath);
        } catch (err) {
            log('logo collector sample failed', `station=${target.stationId}`, err);
            updateLatestCollectorStationState(
                target,
                null,
                'stream-failure'
            );
            return;
        }

        if (sample.kind !== 'complete' || !isUsableFile(samplePath)) {
            log('logo collector sample interrupted',
                `station=${target.stationId}`, `kind=${sample.kind}`, `bytes=${sample.bytes}`);
            updateLatestCollectorStationState(
                target,
                null,
                'preempted'
            );
            return;
        }

        let duration;
        setLogoCollectorWorkerStatus(worker, 'probing', target);
        try {
            duration = await getCollectorSampleDuration(samplePath);
        } catch (err) {
            log('logo collector sample probe failed', `station=${target.stationId}`, err);
            updateLatestCollectorStationState(
                target,
                null,
                'incomplete-sample'
            );
            return;
        }

        const minimumDuration = Math.max(
            LOGO_COLLECT_SAMPLE_SECONDS - 10,
            LOGO_COLLECT_SAMPLE_SECONDS * 0.95
        );
        if (duration < minimumDuration) {
            log('logo collector sample too short',
                `station=${target.stationId}`,
                `duration=${duration.toFixed(3)}`,
                `required=${minimumDuration.toFixed(3)}`);
            updateLatestCollectorStationState(
                target,
                null,
                'incomplete-sample'
            );
            return;
        }

        setLogoCollectorWorkerStatus(worker, 'analyzing', target);
        try {
            await prepareLogoForStation(
                samplePath, target.channelName, target.stationId, null, true
            );
            updateLatestCollectorStationState(
                target,
                true,
                'logo-evaluated'
            );
        } catch (err) {
            log('logo collector detection failed', `station=${target.stationId}`, err);
            updateLatestCollectorStationState(
                target,
                false,
                'logo-detection-failed'
            );
        }
    } catch (err) {
        log('logo collector cycle failed', err);
    } finally {
        if (samplePath && fs.existsSync(samplePath)) {
            try {
                fs.unlinkSync(samplePath);
                log('logo collector sample deleted', samplePath);
            } catch (err) {
                log('logo collector sample delete failed', samplePath, err);
            }
        }
        logoCollectorRunning[worker] = false;
        setLogoCollectorWorkerStatus(worker, 'idle');
    }
}

function cleanupLogoCollectorTempFiles() {
    fs.mkdirSync(LOGO_COLLECT_TMP_ROOT, { recursive: true });

    for (const name of fs.readdirSync(LOGO_COLLECT_TMP_ROOT)) {
        if (!/^logo-[A-Za-z0-9_-]+-\d+-\d+\.ts$/.test(name)) {
            continue;
        }

        const filePath = path.join(LOGO_COLLECT_TMP_ROOT, name);

        try {
            fs.unlinkSync(filePath);
            log('logo collector stale sample deleted', filePath);
        } catch (err) {
            log('logo collector stale sample delete failed', filePath, err);
        }
    }
}

function runLogoCollectorWorkers() {
    if (!logoCollectorEnabled) {
        return;
    }

    runLogoCollectorOnce('GR');
    runLogoCollectorOnce('BSCS');
}

function scheduleLogoCollector() {
    cleanupLogoCollectorTempFiles();

    log('logo collector scheduler started',
        `startupEnabled=${LOGO_COLLECT_ENABLED}`,
        `epgstation=${EPGSTATION_URL}`,
        `mirakurun=${MIRAKURUN_URL}`,
        `tmp=${LOGO_COLLECT_TMP_ROOT}`,
        `sampleSeconds=${LOGO_COLLECT_SAMPLE_SECONDS}`,
        `intervalMinutes=${LOGO_COLLECT_INTERVAL_MINUTES}`,
        `priority=${LOGO_COLLECT_PRIORITY}`);

    setTimeout(runLogoCollectorWorkers, 5000);
    setInterval(runLogoCollectorWorkers, 60 * 1000);
}


function createLogoPreviewPng(
    logoPath
) {
    return new Promise(
        (resolve, reject) => {
            const spawn =
                require('child_process').spawn;

            const genlogo =
                spawn(
                    GENLOGO_COMMAND,
                    [
                        '--preview',
                        logoPath,
                        '-o',
                        '-',
                    ],
                    {
                        stdio: [
                            'ignore',
                            'pipe',
                            'pipe',
                        ],
                    }
                );

            const ffmpeg =
                spawn(
                    FFMPEG_COMMAND,
                    [
                        '-hide_banner',
                        '-loglevel',
                        'error',
                        '-f',
                        'image2pipe',
                        '-vcodec',
                        'pgm',
                        '-i',
                        'pipe:0',
                        '-frames:v',
                        '1',
                        '-f',
                        'image2pipe',
                        '-vcodec',
                        'png',
                        'pipe:1',
                    ],
                    {
                        stdio: [
                            'pipe',
                            'pipe',
                            'pipe',
                        ],
                    }
                );

            const pngChunks = [];
            const genlogoErrors = [];
            const ffmpegErrors = [];

            let genlogoExit = null;
            let ffmpegExit = null;
            let settled = false;

            const fail = err => {
                if (settled) {
                    return;
                }

                settled = true;

                try {
                    genlogo.kill();
                } catch (_) {
                    // ignore
                }

                try {
                    ffmpeg.kill();
                } catch (_) {
                    // ignore
                }

                reject(err);
            };

            const finish = () => {
                if (
                    settled ||
                    genlogoExit === null ||
                    ffmpegExit === null
                ) {
                    return;
                }

                if (genlogoExit !== 0) {
                    fail(
                        new Error(
                            'genlogo preview failed: ' +
                            Buffer.concat(
                                genlogoErrors
                            ).toString('utf8')
                        )
                    );
                    return;
                }

                if (ffmpegExit !== 0) {
                    fail(
                        new Error(
                            'ffmpeg preview failed: ' +
                            Buffer.concat(
                                ffmpegErrors
                            ).toString('utf8')
                        )
                    );
                    return;
                }

                const png =
                    Buffer.concat(
                        pngChunks
                    );

                if (png.length === 0) {
                    fail(
                        new Error(
                            'preview png is empty'
                        )
                    );
                    return;
                }

                settled = true;
                resolve(png);
            };

            genlogo.stdout.pipe(
                ffmpeg.stdin
            );

            genlogo.stderr.on(
                'data',
                chunk => {
                    genlogoErrors.push(
                        Buffer.from(chunk)
                    );
                }
            );

            ffmpeg.stdout.on(
                'data',
                chunk => {
                    pngChunks.push(
                        Buffer.from(chunk)
                    );
                }
            );

            ffmpeg.stderr.on(
                'data',
                chunk => {
                    ffmpegErrors.push(
                        Buffer.from(chunk)
                    );
                }
            );

            genlogo.on(
                'error',
                fail
            );

            ffmpeg.on(
                'error',
                fail
            );

            genlogo.on(
                'close',
                code => {
                    genlogoExit = code;
                    finish();
                }
            );

            ffmpeg.on(
                'close',
                code => {
                    ffmpegExit = code;
                    finish();
                }
            );
        }
    );
}


async function loadAnalysisForPlayback(
    recordedId
) {
    const analysisPath =
        path.join(
            DATA_ROOT,
            String(recordedId),
            'analysis.json'
        );

    if (!isUsableFile(analysisPath)) {
        return null;
    }

    const analysis =
        JSON.parse(
            fs.readFileSync(
                analysisPath,
                'utf8'
            )
        );

    if (
        !analysis.timeline ||
        !Array.isArray(
            analysis.timeline.cmRanges
        )
    ) {
        throw new Error(
            'invalid analysis timeline'
        );
    }

    let frameRate =
        Number(
            analysis.timeline.frameRate
        );

    if (
        !Number.isFinite(frameRate) ||
        frameRate <= 0
    ) {
        const sourcePath =
            analysis.source &&
            typeof analysis.source.sourcePath ===
                'string'
                ? analysis.source.sourcePath
                : null;

        if (
            sourcePath &&
            fs.existsSync(sourcePath)
        ) {
            try {
                frameRate =
                    await getVideoFrameRate(
                        sourcePath
                    );
            } catch (err) {
                log(
                    'legacy analysis fps lookup failed',
                    `recordedId=${recordedId}`,
                    err
                );
            }
        }
    }

    if (
        Number.isFinite(frameRate) &&
        frameRate > 0
    ) {
        analysis.timeline.frameRate =
            frameRate;

        if (
            Array.isArray(
                analysis.timeline.chapters
            )
        ) {
            analysis.timeline.cmRanges =
                buildPlaybackCmRanges(
                    analysis.timeline.chapters,
                    frameRate
                );
        } else {
            analysis.timeline.cmRanges =
                analysis.timeline.cmRanges.map(
                    range => ({
                        ...range,
                        startTime:
                            Number(
                                range.startFrame
                            ) / frameRate,
                        endTime:
                            (
                                Number(
                                    range.endFrame
                                ) + 1
                            ) / frameRate,
                    })
                );
        }

        /*
         * Backward compatibility for analyses created before
         * playbackStart / playbackEnd were stored.
         *
         * keepRanges are exact inclusive Trim() ranges, so:
         *   playbackStart = first kept frame
         *   playbackEnd   = first frame after the last kept frame
         *
         * This does not modify analysis.json on disk.
         */
        if (
            Array.isArray(
                analysis.timeline.keepRanges
            ) &&
            analysis.timeline.keepRanges.length > 0
        ) {
            const firstKeepRange =
                analysis.timeline.keepRanges[0];

            const lastKeepRange =
                analysis.timeline.keepRanges[
                    analysis.timeline.keepRanges.length - 1
                ];

            if (
                typeof analysis.timeline.playbackStart !== 'number' ||
                !Number.isFinite(
                    analysis.timeline.playbackStart
                )
            ) {
                analysis.timeline.playbackStart =
                    Number(
                        firstKeepRange.startFrame
                    ) / frameRate;
            }

            if (
                typeof analysis.timeline.playbackEnd !== 'number' ||
                !Number.isFinite(
                    analysis.timeline.playbackEnd
                )
            ) {
                analysis.timeline.playbackEnd =
                    (
                        Number(
                            lastKeepRange.endFrame
                        ) + 1
                    ) / frameRate;
            }
        }
    }

    return analysis;
}


function listLogos() {
    const resultByKey = new Map();
    const state = readCollectorState();

    /*
     * Collector対象局を先に登録する。
     * LGD未生成のmissing/backoff/suspendedも一覧へ出す。
     */
    for (const [stationId, item] of Object.entries(state.stations || {})) {
        if (!/^[A-Za-z0-9_-]+$/.test(stationId)) {
            continue;
        }

        const logoPath =
            path.join(
                LOGO_ROOT,
                `${stationId}.lgd`
            );

        const metaPath =
            path.join(
                LOGO_ROOT,
                `${stationId}.lgd.meta.json`
            );

        const hasLogo =
            isUsableFile(logoPath);

        const quality =
            hasLogo
                ? readLogoQuality(metaPath)
                : null;

        const logo =
            collectorLogoStatus(stationId);

        const failures =
            Number(
                item.consecutiveDetectionFailures || 0
            );

        const status =
            collectorStateName(
                logo.status,
                failures
            );

        resultByKey.set(
            `station:${stationId}`,
            {
                stationId,
                serviceId:
                    item.serviceId != null
                        ? String(item.serviceId)
                        : null,
                channelName:
                    typeof item.channelName === 'string' &&
                    item.channelName.length > 0
                        ? item.channelName
                        : quality &&
                          typeof quality.channelName === 'string' &&
                          quality.channelName.length > 0
                            ? quality.channelName
                            : null,
                channelType:
                    typeof item.channelType === 'string' &&
                    item.channelType.length > 0
                        ? item.channelType
                        : null,
                physicalChannel:
                    typeof item.physicalChannel === 'string' &&
                    item.physicalChannel.length > 0
                        ? item.physicalChannel
                        : null,
                hasLogo,
                qualityScore:
                    logo.qualityScore,
                generatedAt:
                    quality &&
                    typeof quality.generatedAt === 'string'
                        ? quality.generatedAt
                        : null,
                hasMeta:
                    quality !== null,
                status,
                lastCollectAt:
                    typeof item.lastCollectAt === 'string' &&
                    item.lastCollectAt.length > 0
                        ? item.lastCollectAt
                        : null,
                nextCollectAt:
                    typeof item.nextCollectAt === 'string' &&
                    item.nextCollectAt.length > 0
                        ? item.nextCollectAt
                        : null,
                consecutiveDetectionFailures:
                    failures,
                lastResult:
                    typeof item.lastResult === 'string' &&
                    item.lastResult.length > 0
                        ? item.lastResult
                        : null,
            }
        );
    }

    /*
     * Collector stateにまだ存在しないlegacy LGDも残す。
     * これにより従来の /logos との互換性を維持する。
     */
    if (fs.existsSync(LOGO_ROOT)) {
        for (const name of fs.readdirSync(LOGO_ROOT)) {
            if (!name.endsWith('.lgd')) {
                continue;
            }

            const stationId =
                name.substring(
                    0,
                    name.length - '.lgd'.length
                );

            if (!/^[A-Za-z0-9_-]+$/.test(stationId)) {
                continue;
            }

            const key =
                `station:${stationId}`;

            if (resultByKey.has(key)) {
                continue;
            }

            const logoPath =
                path.join(
                    LOGO_ROOT,
                    name
                );

            if (!isUsableFile(logoPath)) {
                continue;
            }

            const metaPath =
                path.join(
                    LOGO_ROOT,
                    `${stationId}.lgd.meta.json`
                );

            const quality =
                readLogoQuality(metaPath);

            resultByKey.set(
                key,
                {
                    stationId,
                    serviceId: null,
                    channelName:
                        quality &&
                        typeof quality.channelName === 'string' &&
                        quality.channelName.length > 0
                            ? quality.channelName
                            : null,
                    channelType: null,
                    physicalChannel: null,
                    hasLogo: true,
                    qualityScore:
                        quality
                            ? quality.qualityScore
                            : null,
                    generatedAt:
                        quality &&
                        typeof quality.generatedAt === 'string'
                            ? quality.generatedAt
                            : null,
                    hasMeta:
                        quality !== null,
                    status:
                        quality === null
                            ? 'unknown'
                            : isHighQualityLogo(quality)
                                ? 'good'
                                : 'improving',
                    lastCollectAt: null,
                    nextCollectAt: null,
                    consecutiveDetectionFailures: 0,
                    lastResult: null,
                }
            );
        }
    }

    /*
     * EPGStationには存在するがChListで解決できないサービス。
     * stationIdを捏造せずserviceIdを識別子として返す。
     */
    for (const [serviceId, item] of Object.entries(state.unsupported || {})) {
        resultByKey.set(
            `service:${serviceId}`,
            {
                stationId: null,
                serviceId: String(serviceId),
                channelName:
                    typeof item.channelName === 'string' &&
                    item.channelName.length > 0
                        ? item.channelName
                        : null,
                channelType:
                    typeof item.channelType === 'string' &&
                    item.channelType.length > 0
                        ? item.channelType
                        : null,
                physicalChannel:
                    typeof item.physicalChannel === 'string' &&
                    item.physicalChannel.length > 0
                        ? item.physicalChannel
                        : null,
                hasLogo: false,
                qualityScore: null,
                generatedAt: null,
                hasMeta: false,
                status: 'unsupported',
                lastCollectAt: null,
                nextCollectAt: null,
                consecutiveDetectionFailures: 0,
                lastResult: null,
            }
        );
    }

    const result =
        [...resultByKey.values()];

    const channelPriority = value => {
        if (value === 'GR') return 0;
        if (value === 'BS') return 1;
        if (value === 'CS') return 2;
        return 3;
    };

    result.sort((a, b) => {
        const ac =
            channelPriority(a.channelType);
        const bc =
            channelPriority(b.channelType);

        if (ac !== bc) {
            return ac - bc;
        }

        const an =
            a.channelName ||
            a.stationId ||
            a.serviceId ||
            '';

        const bn =
            b.channelName ||
            b.stationId ||
            b.serviceId ||
            '';

        return an.localeCompare(
            bn,
            'ja'
        );
    });

    return result;
}

const server = http.createServer(
    async (req, res) => {
        const analysisMatch =
            req.method === 'GET'
                ? req.url.match(
                    /^\/analysis\/(\d+)$/
                )
                : null;

        if (analysisMatch) {
            const recordedId =
                analysisMatch[1];

            try {
                const analysis =
                    await loadAnalysisForPlayback(
                        recordedId
                    );

                if (analysis === null) {
                    sendJson(
                        res,
                        404,
                        {
                            error:
                                'analysis not found',
                        }
                    );
                    return;
                }

                sendJson(
                    res,
                    200,
                    analysis
                );
            } catch (err) {
                log(
                    'analysis read failed',
                    `recordedId=${recordedId}`,
                    err
                );

                sendJson(
                    res,
                    500,
                    {
                        error:
                            'failed to read analysis',
                    }
                );
            }

            return;
        }

        const logoDeleteMatch =
            req.method === 'DELETE'
                ? req.url.match(
                    /^\/logos\/([A-Za-z0-9_-]+)$/
                )
                : null;

        const logoPreviewMatch =
            req.method === 'GET'
                ? req.url.match(
                    /^\/logos\/([A-Za-z0-9_-]+)\/preview$/
                )
                : null;

        if (logoDeleteMatch) {
            const stationId =
                logoDeleteMatch[1];

            const logoPath =
                path.join(
                    LOGO_ROOT,
                    `${stationId}.lgd`
                );

            const metaPath =
                path.join(
                    LOGO_ROOT,
                    `${stationId}.lgd.meta.json`
                );

            if (!isUsableFile(logoPath)) {
                sendJson(
                    res,
                    404,
                    {
                        error:
                            'logo not found',
                    }
                );
                return;
            }

            try {
                /*
                 * metaを先に削除する。
                 * LGD削除に失敗しても、残ったLGDは
                 * legacy（未評価）ロゴとして安全に扱える。
                 */
                if (fs.existsSync(metaPath)) {
                    fs.unlinkSync(metaPath);
                }

                fs.unlinkSync(logoPath);

                /*
                 * 削除直後からCollectorの再取得対象に戻す。
                 * 次回cycleを待たず /logos の表示もmissingへ同期する。
                 */
                const collectorState =
                    readCollectorState();

                if (
                    collectorState.stations &&
                    collectorState.stations[stationId]
                ) {
                    const item =
                        collectorState.stations[stationId];

                    collectorState.stations[stationId] = {
                        ...item,
                        status: 'missing',
                        logoStatus: 'missing',
                        qualityScore: null,
                        nextCollectAt: null,
                        consecutiveDetectionFailures: 0,
                        lastResult: 'logo-deleted',
                    };

                    writeCollectorState(
                        collectorState
                    );
                }

                log(
                    'logo deleted',
                    stationId
                );

                sendJson(
                    res,
                    200,
                    {
                        deleted: true,
                        stationId,
                    }
                );
            } catch (err) {
                log(
                    'logo delete failed',
                    stationId,
                    err
                );

                sendJson(
                    res,
                    500,
                    {
                        error:
                            'failed to delete logo',
                    }
                );
            }

            return;
        }

        if (logoPreviewMatch) {
            const stationId =
                logoPreviewMatch[1];

            const logoPath =
                path.join(
                    LOGO_ROOT,
                    `${stationId}.lgd`
                );

            if (!isUsableFile(logoPath)) {
                sendJson(
                    res,
                    404,
                    {
                        error:
                            'logo not found',
                    }
                );
                return;
            }

            try {
                const png =
                    await createLogoPreviewPng(
                        logoPath
                    );

                res.writeHead(
                    200,
                    {
                        'Content-Type':
                            'image/png',
                        'Content-Length':
                            png.length,
                        'Cache-Control':
                            'no-store',
                    }
                );

                res.end(png);
            } catch (err) {
                log(
                    'logo preview failed',
                    stationId,
                    err
                );

                sendJson(
                    res,
                    500,
                    {
                        error:
                            'failed to create logo preview',
                    }
                );
            }

            return;
        }

        if (
            req.method === 'GET' &&
            req.url === '/logos'
        ) {
            try {
                sendJson(
                    res,
                    200,
                    {
                        logos:
                            listLogos(),
                    }
                );
            } catch (err) {
                log(
                    'logo list failed',
                    err
                );

                sendJson(
                    res,
                    500,
                    {
                        error:
                            'failed to list logos',
                    }
                );
            }

            return;
        }

        if (
            req.method === 'GET' &&
            req.url === '/logo-collector/status'
        ) {
            sendJson(
                res,
                200,
                getLogoCollectorRuntimeStatus()
            );
            return;
        }

        if (
            req.method === 'POST' &&
            req.url === '/logo-collector/start'
        ) {
            logoCollectorEnabled = true;

            log(
                'logo collector runtime enabled'
            );

            /*
             * 次の60秒周期を待たずに開始判定する。
             * 通常CM解析中なら runLogoCollectorOnce 側で安全に待機する。
             */
            setTimeout(
                runLogoCollectorWorkers,
                0
            );

            sendJson(
                res,
                200,
                getLogoCollectorRuntimeStatus()
            );
            return;
        }

        if (
            req.method === 'POST' &&
            req.url === '/logo-collector/stop'
        ) {
            logoCollectorEnabled = false;

            /*
             * 実行中workerは強制終了しない。
             * 現在の処理完了後、新規worker起動を停止する。
             */
            log(
                'logo collector runtime disabled'
            );

            sendJson(
                res,
                200,
                getLogoCollectorRuntimeStatus()
            );
            return;
        }

        if (
            req.method === 'GET' &&
            req.url === '/health'
        ) {
            sendJson(res, 200, {
                status: 'ok',
                running,
                currentJob,
                queueLength: jobQueue.length,
                queuedJobs: jobQueue.map(job => ({
                    recordedId: job.recordedId,
                    recPath: job.recPath,
                })),
            });
            return;
        }

        if (
            req.method === 'POST' &&
            req.url === '/cancel'
        ) {
            let body;

            try {
                body = await readJson(req);
            } catch (err) {
                sendJson(res, 400, {
                    error: 'invalid json',
                });
                return;
            }

            if (
                typeof body.recordedId ===
                'undefined'
            ) {
                sendJson(res, 400, {
                    error: 'recordedId is required',
                });
                return;
            }

            const recordedId =
                String(body.recordedId);

            let queued = false;
            let active = false;

            /*
             * queued job は解析開始前に除去。
             */
            for (
                let i = jobQueue.length - 1;
                i >= 0;
                i--
            ) {
                if (
                    String(
                        jobQueue[i].recordedId
                    ) === recordedId
                ) {
                    jobQueue.splice(i, 1);
                    queued = true;
                }
            }

            /*
             * 実行中なら canceled を記録して、
             * JLSE プロセスグループを停止する。
             *
             * prepareLogo 中など child 起動前でも
             * canceledRecordedIds を残すため、
             * JLSE 起動時点で即停止される。
             */
            if (
                currentJob !== null &&
                String(
                    currentJob.recordedId
                ) === recordedId
            ) {
                active = true;
                canceledRecordedIds.add(
                    recordedId
                );

                terminateAnalysisChild(
                    currentAnalysisChild
                );
            }

            log(
                'analysis cancel requested',
                `recordedId=${recordedId}`,
                `queued=${queued}`,
                `active=${active}`
            );

            sendJson(res, 200, {
                status:
                    queued || active
                        ? 'canceling'
                        : 'not-found',
                recordedId,
                queued,
                running: active,
            });

            return;
        }

        if (
            req.method === 'POST' &&
            req.url === '/analyze'
        ) {
            let body;

            try {
                body =
                    await readJson(req);
            } catch (err) {
                sendJson(res, 400, {
                    error: 'invalid json',
                });
                return;
            }

            if (
                typeof body.recordedId ===
                    'undefined' ||
                !body.recPath
            ) {
                sendJson(res, 400, {
                    error:
                        'recordedId and recPath are required',
                });
                return;
            }

            let sourcePath;

            try {
                sourcePath =
                    convertRecordedPath(
                        body.recPath
                    );
            } catch (err) {
                sendJson(res, 400, {
                    error: err.message,
                });
                return;
            }

            if (!fs.existsSync(sourcePath)) {
                sendJson(res, 404, {
                    error:
                        'recording file not found',
                    sourcePath,
                });
                return;
            }

            const job = {
                recordedId:
                    String(body.recordedId),
                recPath:
                    String(body.recPath),
                sourcePath,
                channelName:
                    String(
                        body.channelName || ''
                    ),
                title:
                    String(body.title || ''),
            };

            enqueueAnalysis(job);

            sendJson(res, 202, {
                accepted: true,
                recordedId:
                    job.recordedId,
                running,
                queueLength:
                    jobQueue.length,
            });

            return;
        }

        sendJson(res, 404, {
            error: 'not found',
        });
    }
);

server.listen(
    PORT,
    '0.0.0.0',
    () => {
        log(
            `cm-analyzer listening on ${PORT}`
        );

        scheduleLogoCollector();
    }
);

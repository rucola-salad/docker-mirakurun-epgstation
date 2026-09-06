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

function spawnAndWait(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            command,
            args,
            options
        );

        child.once('error', reject);

        child.once('exit', (code, signal) => {
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


function spawnAndCapture(command, args, options = {}) {
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
            }
        );

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

        child.once('error', reject);

        child.once('exit', (code, signal) => {
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

async function getVideoFrameRate(inputPath) {
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
            ]
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

function isHighQualityLogo(quality) {
    return (
        quality &&
        quality.qualityScore >= 90
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

async function prepareLogo(
    workInput,
    channelName
) {
    const channel = parseChannel(workInput);

    if (!channel || !channel.short) {
        throw new Error(
            `channel not recognized: ${path.basename(workInput)}`
        );
    }

    const stationId =
        String(channel.short);

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
                ]
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
        if (existingLogo) {
            log(
                'logo generation failed; using existing logo',
                `station=${stationId}`,
                err
            );

            return {
                stationId,
                logoPath,
                logoGenerated: false,
            };
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
        },
        jlse: {
            segments,
        },
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

    try {
        if (fs.existsSync(workInput)) {
            fs.unlinkSync(workInput);
        }

        fs.symlinkSync(
            sourcePath,
            workInput
        );

        const logo =
            await prepareLogo(
                workInput,
                job.channelName
            );

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

        await spawnAndWait(
            '/usr/local/bin/jlse',
            [
                '-i',
                workInput,
            ],
            {
                cwd: JLSE_ROOT,
                stdio: [
                    'ignore',
                    'inherit',
                    'inherit',
                ],
            }
        );

        log(
            'analysis finished',
            `recordedId=${job.recordedId}`,
            'exit=0'
        );

        const resultName =
            path.basename(
                workInput,
                path.extname(workInput)
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

        const videoFps =
            await getVideoFrameRate(
                workInput
            );

        log(
            'video frame rate',
            `recordedId=${job.recordedId}`,
            `fps=${videoFps}`
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
        running = false;
        currentJob = null;
    }
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
    }

    return analysis;
}


function listLogos() {
    if (!fs.existsSync(LOGO_ROOT)) {
        return [];
    }

    const result = [];

    for (const name of fs.readdirSync(LOGO_ROOT)) {
        if (!name.endsWith('.lgd')) {
            continue;
        }

        const stationId =
            name.substring(
                0,
                name.length - '.lgd'.length
            );

        if (
            !/^[A-Za-z0-9_-]+$/.test(
                stationId
            )
        ) {
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

        result.push({
            stationId,
            channelName:
                quality &&
                typeof quality.channelName === 'string' &&
                quality.channelName.length > 0
                    ? quality.channelName
                    : null,
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
        });
    }

    result.sort(
        (a, b) =>
            a.stationId.localeCompare(
                b.stationId
            )
    );

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
    }
);

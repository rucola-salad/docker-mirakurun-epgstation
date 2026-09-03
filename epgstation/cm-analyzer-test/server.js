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
    '/usr/local/bin/genlogo';

const parseChannel =
    require(path.join(JLSE_ROOT, 'src/channel')).parse;

let running = false;
let currentJob = null;

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

    if (/[/\\\x00]/.test(stationId)) {
        throw new Error(
            `invalid station id: ${stationId}`
        );
    }
}

async function prepareLogo(workInput) {
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

    if (isUsableFile(logoPath)) {
        log(
            'logo cache hit',
            `station=${stationId}`,
            `path=${logoPath}`
        );

        return {
            stationId,
            logoPath,
            logoGenerated: false,
        };
    }

    const tempLogoPath =
        path.join(
            LOGO_ROOT,
            `.${stationId}.${process.pid}.${Date.now()}.tmp.lgd`
        );

    log(
        'logo generation start',
        `station=${stationId}`,
        `input=${workInput}`
    );

    try {
        await spawnAndWait(
            GENLOGO_COMMAND,
            [
                '-i',
                workInput,
                '-o',
                tempLogoPath,
                '--auto-roi',
                '--name',
                stationId,
            ],
            {
                stdio: [
                    'ignore',
                    'inherit',
                    'inherit',
                ],
            }
        );

        if (!isUsableFile(tempLogoPath)) {
            throw new Error(
                `generated logo is invalid: ${tempLogoPath}`
            );
        }

        fs.renameSync(
            tempLogoPath,
            logoPath
        );
    } catch (err) {
        /*
         * tempLogoPath is created only by this process.
         * Do not touch an existing station logo on failure.
         */
        if (fs.existsSync(tempLogoPath)) {
            try {
                fs.unlinkSync(tempLogoPath);
            } catch (cleanupErr) {
                log(
                    'temporary logo cleanup failed',
                    cleanupErr
                );
            }
        }

        throw err;
    }

    log(
        'logo generation finished',
        `station=${stationId}`,
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

    return {
        version: 1,
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
            cmRanges,
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
            await prepareLogo(workInput);

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

const server = http.createServer(
    async (req, res) => {
        if (
            req.method === 'GET' &&
            req.url === '/health'
        ) {
            sendJson(res, 200, {
                status: 'ok',
                running,
                currentJob,
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

            if (running) {
                sendJson(res, 409, {
                    error:
                        'analysis already running',
                    currentJob,
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

            sendJson(res, 202, {
                accepted: true,
                recordedId:
                    job.recordedId,
            });

            setImmediate(() => {
                runAnalysis(job);
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

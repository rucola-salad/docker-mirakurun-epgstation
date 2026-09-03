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

function runAnalysis(job) {
    running = true;
    currentJob = job;

    const sourcePath = job.sourcePath;

    /*
     * LWLibavAudioSource / VideoSource creates .lwi beside the input.
     * Therefore JLSE must not use the read-only recording directly.
     */
    const workDir = path.join(
        '/work',
        String(job.recordedId)
    );

    fs.mkdirSync(workDir, {
        recursive: true,
    });

    const channelName =
        safeName(job.channelName || 'unknown');

    const sourceBase =
        safeName(path.basename(sourcePath));

    const workInput = path.join(
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
    } catch (err) {
        log(
            'failed to prepare work input',
            err
        );

        running = false;
        currentJob = null;
        return;
    }

    log(
        'analysis start',
        JSON.stringify({
            recordedId: job.recordedId,
            input: workInput,
            channelName: job.channelName,
            title: job.title,
        })
    );

    const child = spawn(
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

    child.on('error', err => {
        log(
            'analysis spawn error',
            err
        );

        running = false;
        currentJob = null;
    });

    child.on('exit', code => {
        log(
            'analysis finished',
            `recordedId=${job.recordedId}`,
            `exit=${code}`
        );

        if (code === 0) {
            try {
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
                    recordedId: job.recordedId,
                    title: job.title,
                    channelName: job.channelName,
                    epgstationPath: job.recPath,
                    sourcePath: job.sourcePath,
                    analyzedAt:
                        new Date().toISOString(),
                };

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

                log(
                    'result copied',
                    outputRoot
                );
            } catch (err) {
                log(
                    'result copy failed',
                    err
                );
            }
        }

        running = false;
        currentJob = null;
    });
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
                body = await readJson(req);
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

            /*
             * Start after sending the HTTP response.
             * EPGStation does not need to wait for JLSE.
             */
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

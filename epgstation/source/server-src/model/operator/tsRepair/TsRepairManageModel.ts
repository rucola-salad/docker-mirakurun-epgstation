import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IVideoUtil from '../../api/video/IVideoUtil';
import IRecordedManageModel from '../recorded/IRecordedManageModel';
import ITsRepairManageModel from './ITsRepairManageModel';

@injectable()
export default class TsRepairManageModel implements ITsRepairManageModel {
    private log: ILogger;
    private videoUtil: IVideoUtil;
    private recordedManage: IRecordedManageModel;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
    ) {
        this.log = logger.getLogger();
        this.videoUtil = videoUtil;
        this.recordedManage = recordedManage;
    }

    /**
     * Manual repair pre-check.
     * Read/decode only; the source file is never modified.
     * true: healthy, false: damage detected, null: check could not be executed.
     */
    public async check(
        recorded: Recorded,
        sourceVideoFileId: apid.VideoFileId,
        signal?: AbortSignal,
    ): Promise<boolean | null> {
        const sourceVideoFile =
            typeof recorded.videoFiles === 'undefined'
                ? undefined
                : recorded.videoFiles.find(v => v.id === sourceVideoFileId);

        if (typeof sourceVideoFile === 'undefined') {
            this.log.system.error(`TS health check source VideoFile is not found: ${sourceVideoFileId}`);
            return null;
        }

        const inputPath = await this.videoUtil.getFullFilePathFromId(sourceVideoFileId);
        if (inputPath === null) {
            this.log.system.error(`TS health check source path is not found: ${sourceVideoFileId}`);
            return null;
        }

        const repairBin = process.env.TS_REPAIR_PATH || 'ts-repair';
        const ffmpegBin =
            process.env.TS_REPAIR_FFMPEG_PATH ||
            (path.isAbsolute(repairBin)
                ? path.join(path.dirname(repairBin), 'ffmpeg')
                : 'ffmpeg');

        this.log.system.info(
            `TS health check start: recorded=${recorded.id} source=${inputPath}`,
        );

        try {
            const healthy = await new Promise<boolean>((resolve, reject) => {
                const child = spawn(
                    ffmpegBin,
                    [
                        '-hide_banner',
                        '-v',
                        'error',
                        '-xerror',
                        '-err_detect',
                        'explode',
                        '-i',
                        inputPath,
                        '-map',
                        '0:v:0',
                        '-map',
                        '0:a?',
                        '-f',
                        'null',
                        '-',
                    ],
                    {
                        stdio: ['ignore', 'ignore', 'pipe'],
                        detached: typeof signal !== 'undefined',
                    },
                );

                const abortHandler = (): void => {
                    if (
                        child.exitCode !== null ||
                        child.signalCode !== null
                    ) {
                        return;
                    }

                    if (
                        typeof signal !== 'undefined' &&
                        typeof child.pid !== 'undefined'
                    ) {
                        try {
                            process.kill(-child.pid, 'SIGTERM');
                            return;
                        } catch (_) {
                            // process group kill failed; fall back below
                        }
                    }

                    child.kill('SIGTERM');
                };

                if (typeof signal !== 'undefined') {
                    if (signal.aborted) {
                        abortHandler();
                    } else {
                        signal.addEventListener('abort', abortHandler, { once: true });
                    }
                }

                let stderr = '';
                if (child.stderr !== null) {
                    child.stderr.on('data', chunk => {
                        if (stderr.length < 64 * 1024) {
                            stderr += chunk.toString();
                        }
                    });
                }

                child.once('error', reject);
                child.once('close', code => {
                    if (typeof signal !== 'undefined') {
                        signal.removeEventListener('abort', abortHandler);
                    }

                    if (signal?.aborted) {
                        reject(new Error('TS health check canceled'));
                        return;
                    }

                    if (code === 0) {
                        resolve(true);
                        return;
                    }

                    this.log.system.info(
                        `TS health check detected damage: recorded=${recorded.id} source=${inputPath}`,
                    );
                    if (stderr.length > 0) {
                        this.log.system.info(stderr.trim());
                    }
                    resolve(false);
                });
            });

            this.log.system.info(
                `TS health check completed: recorded=${recorded.id} healthy=${healthy}`,
            );
            return healthy;
        } catch (err) {
            if (signal?.aborted) {
                throw err;
            }

            this.log.system.error(`TS health check failed: recorded=${recorded.id}`);
            this.log.system.error(err);
            return null;
        }
    }

    public async repair(
        recorded: Recorded,
        sourceVideoFileId: apid.VideoFileId,
        signal?: AbortSignal,
    ): Promise<apid.VideoFileId | null> {
        const sourceVideoFile =
            typeof recorded.videoFiles === 'undefined'
                ? undefined
                : recorded.videoFiles.find(v => v.id === sourceVideoFileId);

        if (typeof sourceVideoFile === 'undefined') {
            this.log.system.error(`TS repair source VideoFile is not found: ${sourceVideoFileId}`);
            return null;
        }

        const inputPath = await this.videoUtil.getFullFilePathFromId(sourceVideoFileId);
        if (inputPath === null) {
            this.log.system.error(`TS repair source path is not found: ${sourceVideoFileId}`);
            return null;
        }

        const workRoot = process.env.TS_REPAIR_WORK_ROOT;
        if (typeof workRoot === 'undefined' || workRoot.length === 0) {
            this.log.system.error('TS_REPAIR_WORK_ROOT is not configured; TS repair skipped');
            return null;
        }

        try {
            const stat = await fs.stat(workRoot);
            if (!stat.isDirectory()) {
                this.log.system.error(`TS_REPAIR_WORK_ROOT is not a directory: ${workRoot}`);
                return null;
            }
        } catch (err) {
            this.log.system.error(`TS_REPAIR_WORK_ROOT is not accessible: ${workRoot}`);
            this.log.system.error(err);
            return null;
        }

        const parsed = path.parse(sourceVideoFile.filePath);
        const parentDirPath = this.videoUtil.getParentDirPath(sourceVideoFile.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(
                `TS repair parent directory is not found: ${sourceVideoFile.parentDirectoryName}`,
            );
            return null;
        }

        let repairedFileName = `${parsed.name}.repaired.ts`;
        let repairedRelativePath = path.join(parsed.dir, repairedFileName);
        let outputPath = path.join(parentDirPath, repairedRelativePath);

        /* Never overwrite a previous repaired TS. */
        try {
            await fs.access(outputPath);
            repairedFileName = `${parsed.name}.repaired-${Date.now()}.ts`;
            repairedRelativePath = path.join(parsed.dir, repairedFileName);
            outputPath = path.join(parentDirPath, repairedRelativePath);
        } catch (_err) {
            // The normal first repair output does not exist.
        }

        const workDir = path.join(
            workRoot,
            `recorded-${recorded.id}-${Date.now()}`,
        );

        const repairBin = process.env.TS_REPAIR_PATH || 'ts-repair';

        this.log.system.info(
            `TS repair start: recorded=${recorded.id} source=${inputPath} output=${outputPath}`,
        );

        try {
            await new Promise<void>((resolve, reject) => {
                const child = spawn(
                    repairBin,
                    [inputPath, outputPath, workDir],
                    {
                        stdio: 'inherit',
                        detached: typeof signal !== 'undefined',
                    },
                );

                const abortHandler = (): void => {
                    if (
                        child.exitCode !== null ||
                        child.signalCode !== null
                    ) {
                        return;
                    }

                    if (
                        typeof signal !== 'undefined' &&
                        typeof child.pid !== 'undefined'
                    ) {
                        try {
                            process.kill(-child.pid, 'SIGTERM');
                            return;
                        } catch (_) {
                            // process group kill failed; fall back below
                        }
                    }

                    child.kill('SIGTERM');
                };

                if (typeof signal !== 'undefined') {
                    if (signal.aborted) {
                        abortHandler();
                    } else {
                        signal.addEventListener('abort', abortHandler, { once: true });
                    }
                }

                child.once('error', reject);

                child.once('close', (code, exitSignal) => {
                    if (typeof signal !== 'undefined') {
                        signal.removeEventListener('abort', abortHandler);
                    }

                    if (signal?.aborted) {
                        reject(new Error('TS repair canceled'));
                        return;
                    }

                    if (code === 0) {
                        resolve();
                        return;
                    }

                    reject(
                        new Error(
                            `TS repair process exited abnormally: code=${code} signal=${exitSignal}`,
                        ),
                    );
                });
            });
        } catch (err) {
            if (signal?.aborted) {
                throw err;
            }

            this.log.system.error(`TS repair failed: recorded=${recorded.id}`);
            this.log.system.error(err);
            return null;
        }

        if (signal?.aborted) {
            throw new Error('TS repair canceled');
        }

        try {
            const outputStat = await fs.stat(outputPath);
            if (!outputStat.isFile() || outputStat.size === 0) {
                this.log.system.error(`TS repair output is invalid: ${outputPath}`);
                return null;
            }
        } catch (err) {
            this.log.system.error(`TS repair output is not accessible: ${outputPath}`);
            this.log.system.error(err);
            return null;
        }

        if (signal?.aborted) {
            throw new Error('TS repair canceled');
        }

        try {
            const videoFileId = await this.recordedManage.addVideoFile({
                recordedId: recorded.id,
                parentDirectoryName: sourceVideoFile.parentDirectoryName,
                filePath: repairedRelativePath,
                type: 'ts',
                name: 'TS Repair',
                cmState: 'uncut',
            });

            this.log.system.info(
                `TS repair completed: recorded=${recorded.id} videoFile=${videoFileId}`,
            );

            try {
                await fs.rm(workDir, {
                    recursive: true,
                    force: false,
                });

                this.log.system.info(
                    `TS repair work directory removed: recorded=${recorded.id} work=${workDir}`,
                );
            } catch (err) {
                this.log.system.error(
                    `TS repair work directory cleanup failed: recorded=${recorded.id} work=${workDir}`,
                );
                this.log.system.error(err);
            }

            return videoFileId;
        } catch (err) {
            this.log.system.error(
                `TS repair output registration failed: recorded=${recorded.id} output=${outputPath}`,
            );
            this.log.system.error(err);
            return null;
        }
    }
}

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

    public async repair(
        recorded: Recorded,
        sourceVideoFileId: apid.VideoFileId,
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
        const repairedFileName = `${parsed.name}.repaired.ts`;
        const repairedRelativePath = path.join(parsed.dir, repairedFileName);

        const parentDirPath = this.videoUtil.getParentDirPath(sourceVideoFile.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(
                `TS repair parent directory is not found: ${sourceVideoFile.parentDirectoryName}`,
            );
            return null;
        }

        const outputPath = path.join(parentDirPath, repairedRelativePath);

        /*
         * ts-repair itself refuses an existing output/work directory.
         * Include recorded ID and current time so separate repair attempts do not collide.
         */
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
                    },
                );

                child.once('error', reject);

                child.once('close', (code, signal) => {
                    if (code === 0) {
                        resolve();
                        return;
                    }

                    reject(
                        new Error(
                            `TS repair process exited abnormally: code=${code} signal=${signal}`,
                        ),
                    );
                });
            });
        } catch (err) {
            this.log.system.error(`TS repair failed: recorded=${recorded.id}`);
            this.log.system.error(err);
            return null;
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
                /*
                 * Repair itself has already succeeded and the repaired TS has been
                 * registered. Cleanup failure must not invalidate the repaired file.
                 */
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

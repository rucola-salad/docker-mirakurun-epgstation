import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel';
import IEncodeFinishModel from './IEncodeFinishModel';

@injectable()
export default class EncodeFinishModel implements IEncodeFinishModel {
    private log: ILogger;
    private socket: ISocketIOManageModel;
    private ipc: IIPCClient;
    private encodeEvent: IEncodeEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socket: ISocketIOManageModel,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setFinishEncode(this.finishEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
    }

    /**
     * エンコード追加処理
     * @param encodeId
     */
    private addEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコードキャンセル処理
     * @param encodeId
     */
    private cancelEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード終了処理
     * @param info: FinishEncodeInfo
     */
    private async finishEncode(info: FinishEncodeInfo): Promise<void> {
        let newVideoFileId: apid.VideoFileId | null = null;
        let cmCutTimelineSnapshot: {
            frameRate: number;
            keepRanges: Array<{
                startFrame: number;
                endFrame: number;
            }>;
        } | null = null;

        try {
            /*
             * CMカット動画では実況XML再生成用snapshotを必須とする。
             * DBへ動画を登録する前にtimelineを検証し、不正な状態の
             * CMカット動画だけが登録されることを防ぐ。
             */
            if (info.cmCut === true) {
                if (
                    typeof info.cmTimeline !== 'string' ||
                    info.cmTimeline === ''
                ) {
                    throw new Error('CmCutTimelineSnapshotIsNotFound');
                }

                const timeline = JSON.parse(info.cmTimeline);

                if (
                    typeof timeline.frameRate !== 'number' ||
                    Number.isFinite(timeline.frameRate) === false ||
                    timeline.frameRate <= 0 ||
                    Array.isArray(timeline.keepRanges) === false ||
                    timeline.keepRanges.length === 0
                ) {
                    throw new Error('InvalidCmCutTimelineSnapshot');
                }

                for (const range of timeline.keepRanges) {
                    if (
                        typeof range.startFrame !== 'number' ||
                        Number.isFinite(range.startFrame) === false ||
                        typeof range.endFrame !== 'number' ||
                        Number.isFinite(range.endFrame) === false ||
                        range.startFrame < 0 ||
                        range.endFrame < range.startFrame
                    ) {
                        throw new Error('InvalidCmCutTimelineSnapshot');
                    }
                }

                cmCutTimelineSnapshot = {
                    frameRate: timeline.frameRate,
                    keepRanges: timeline.keepRanges,
                };
            }

            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                // add encode file
                const id = await this.ipc.recorded.addVideoFile({
                    recordedId: info.recordedId,
                    parentDirectoryName: info.parentDirName,
                    filePath: info.filePath,
                    type: 'encoded',
                    name: info.mode,
                    cmState: info.cmCut === true ? 'cut' : info.sourceCmState,
                });
                newVideoFileId = id;

                /*
                 * CMカット動画の実況XMLを後から再生成できるように、
                 * 実際にエンコードへ使用したkeepRangesを動画単位で保存する。
                 *
                 * Analyzer側の手動編集が後から変更されても、
                 * 既に生成済みの動画の時間軸はこのsnapshotを使用する。
                 */
                if (cmCutTimelineSnapshot !== null) {
                    const snapshotDir =
                        '/app/data/jikkyo-cache/cmcut';
                    const snapshotPath = path.join(
                        snapshotDir,
                        `${id}.json`,
                    );
                    const tmpPath =
                        `${snapshotPath}.tmp-${process.pid}`;

                    fs.mkdirSync(snapshotDir, { recursive: true });

                    fs.writeFileSync(
                        tmpPath,
                        JSON.stringify({
                            version: 1,
                            recordedId: info.recordedId,
                            videoFileId: id,
                            frameRate:
                                cmCutTimelineSnapshot.frameRate,
                            keepRanges:
                                cmCutTimelineSnapshot.keepRanges,
                        }),
                        'utf8',
                    );

                    fs.renameSync(tmpPath, snapshotPath);

                    this.log.encode.info(
                        `save CM cut jikkyo timeline: ${snapshotPath}`,
                    );
                }
            }
        } catch (err: any) {
            this.log.encode.error('finish encode error');
            this.log.encode.error(err);
        }

        if (info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();

        // Operator にイベントを転送
        await this.ipc.encodeEvent.emitFinishEncode({
            recordedId: info.recordedId,
            videoFileId: newVideoFileId,
            mode: info.mode,
        });
    }

    /**
     * エンコード失敗処理
     */
    private errorEncode(): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード進捗情報更新
     */
    private updateEncodeProgress(): void {
        this.socket.notifyUpdateEncodeProgress();
    }
}

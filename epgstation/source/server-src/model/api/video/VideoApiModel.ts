import { execFile } from 'child_process';
import * as fileType from 'file-type';
import { promisify } from 'util';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IVideoApiModel, { VideoFilePathInfo } from './IVideoApiModel';
import IVideoUtil from './IVideoUtil';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private configuration: IConfiguration;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private ipc: IIPCClient;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IIPCClient') ipc: IIPCClient,
    ) {
        this.configuration = configuration;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
    }

    /**
     * 指定した video fie id のファイルパスを返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFilePathInfo | null>
     */
    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const fullPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        return fullPath === null
            ? null
            : {
                  path: fullPath,
                  mime: await this.createMime(fullPath),
              };
    }

    /**
     * 指定されたファイルパスからファイルの mime を返す
     * @param filePath: string ファイルパス
     * @return Promise<string>
     */
    private async createMime(filePath: string): Promise<string> {
        const mime = await fileType.fromFile(filePath);
        if (typeof mime !== 'undefined') {
            return mime.mime;
        }

        switch (path.extname(filePath)) {
            case '.m2ts':
            case '.ts':
                return 'video/mp2t';
            default:
                throw new Error('MimeTypeError');
        }
    }

    /**
     * 指定した videoFileId の m3u8 形式プレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure: boolean https 通信か
     * @param videoFileId: apid.VideoFileId
     * @return Promise<IPlayList | null>
     */
    public async getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null || typeof video.recordedId === 'undefined') {
            return null;
        }

        const recorded = await this.recordedDB.findId(video?.recordedId);
        if (recorded === null) {
            return null;
        }

        return {
            name: encodeURIComponent(path.basename(video.filePath) + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: `/api/videos/${videoFileId}`,
            }),
        };
    }

    /**
     * 指定した video file id のファイルを削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.recorded.deleteVideoFile(videoFileId);
    }

    /**
     * 指定した video file id のファイルの動画長を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 秒
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const videoInfo = await this.videoUtil.getInfo(filePath);

        return videoInfo.duration;
    }

    /**
     * 指定した video file id のメディア情報を取得する
     */
    public async getMediaInfo(videoFileId: apid.VideoFileId): Promise<apid.VideoMediaInfo> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', [
            '-v',
            'error',
            '-show_streams',
            '-show_format',
            '-of',
            'json',
            filePath,
        ]);

        const probe = JSON.parse(stdout);

        const videoStream = Array.isArray(probe.streams)
            ? probe.streams.find((stream: any) => stream.codec_type === 'video')
            : undefined;
        const audioStream = Array.isArray(probe.streams)
            ? probe.streams.find((stream: any) => stream.codec_type === 'audio')
            : undefined;

        const toNumber = (value: any): number | null => {
            if (value === null || typeof value === 'undefined' || value === 'N/A') {
                return null;
            }

            const n = Number(value);
            return Number.isFinite(n) ? n : null;
        };

        const toFps = (value: any): number | null => {
            if (typeof value !== 'string' || value.length === 0 || value === '0/0') {
                return null;
            }

            const parts = value.split('/');
            if (parts.length === 2) {
                const numerator = Number(parts[0]);
                const denominator = Number(parts[1]);
                if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
                    return numerator / denominator;
                }
            }

            return toNumber(value);
        };

        return {
            format: probe.format?.format_name ?? null,
            duration: toNumber(probe.format?.duration),
            bitrate: toNumber(probe.format?.bit_rate),
            video:
                typeof videoStream === 'undefined'
                    ? null
                    : {
                          codec: videoStream.codec_name ?? null,
                          width: toNumber(videoStream.width),
                          height: toNumber(videoStream.height),
                          fps: toFps(videoStream.avg_frame_rate),
                          bitrate: toNumber(videoStream.bit_rate),
                      },
            audio:
                typeof audioStream === 'undefined'
                    ? null
                    : {
                          codec: audioStream.codec_name ?? null,
                          channels: toNumber(audioStream.channels),
                          channelLayout: audioStream.channel_layout ?? null,
                          sampleRate: toNumber(audioStream.sample_rate),
                          bitrate: toNumber(audioStream.bit_rate),
                      },
        };
    }

    public async sendToKodi(
        host: string,
        isSecure: boolean,
        kodiName: string,
        videoFileId: apid.VideoFileId,
    ): Promise<void> {
        host = this.apiUtil.getHost(host);

        // kodiName で指定された kodi host を config から探す
        const config = this.configuration.getConfig();
        if (typeof config.kodiHosts === 'undefined') {
            throw new Error('KodiHostsIsUndefined');
        }
        const kodi = config.kodiHosts.find(k => {
            return k.name === kodiName;
        });
        if (typeof kodi === 'undefined') {
            throw new Error('KodiHostIsUndefined');
        }

        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const source = `${isSecure ? 'https' : 'http'}://${host}/api/videos/${videoFileId}`;

        return this.apiUtil.sendToKodi(source, kodi);
    }
}

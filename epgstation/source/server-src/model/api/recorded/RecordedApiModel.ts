import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import IIPCClient from '../../ipc/IIPCClient';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import { hasRecordedChapters } from '../../service/RecordedMaintenance';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordedApiModel from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private encodeManage: IEncodeManageModel;
    private recordedItemUtil: IRecordedItemUtil;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
    ) {
        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.recordedItemUtil = recordedItemUtil;
    }

    private async addChapterState(item: apid.RecordedItem): Promise<apid.RecordedItem> {
        (item as any).hasChapters = await hasRecordedChapters(item.id);
        return item;
    }

    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = false;
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedsDropLog: true,
            isNeedTags: false,
        });

        const encodeIndex = this.encodeManage.getRecordedIndex();
        const items = records.map(r => {
            return this.recordedItemUtil.convertRecordedToRecordedItem(r, option.isHalfWidth, encodeIndex);
        });

        await Promise.all(items.map(item => this.addChapterState(item)));

        return {
            records: items,
            total,
        };
    }

    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null> {
        const item = await this.recordedDB.findId(recordedId);
        const encodeIndex = this.encodeManage.getRecordedIndex();

        if (item === null) {
            return null;
        }

        return this.addChapterState(
            this.recordedItemUtil.convertRecordedToRecordedItem(item, isHalfWidth, encodeIndex),
        );
    }

    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const channels = await this.recordedDB.findChannelList();
        const genres = await this.recordedDB.findGenreList();

        return {
            channels: channels,
            genres: genres,
        };
    }

    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.encodeManage.cancelEncodeByRecordedId(recordedId);
        return this.ipc.recorded.delete(recordedId);
    }

    public stopEncode(recordedId: apid.RecordedId): Promise<void> {
        return this.encodeManage.cancelEncodeByRecordedId(recordedId);
    }

    public changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        return this.ipc.recorded.changeProtect(recordedId, isProtect);
    }

    public async fileCleanup(): Promise<void> {
        await this.ipc.recorded.videoFileCleanup();
        await this.ipc.recorded.dropLogFileCleanup();
    }

    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        await this.ipc.recorded.addUploadedVideoFile(option);
    }

    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        return await this.ipc.recorded.createNewRecorded(option);
    }
}

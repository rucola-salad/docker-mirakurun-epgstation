import * as apid from '../../../../../api';

export interface ManualTsRepairResult {
    status: 'healthy' | 'repaired';
    repaired: boolean;
    sourceVideoFileId: apid.VideoFileId;
    repairedVideoFileId?: apid.VideoFileId;
}

export interface RebuildChaptersResult {
    status: 'accepted';
    sourceVideoFileId: apid.VideoFileId;
    sourceType: apid.VideoFileType;
    sourceName: string;
}

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem>;
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    protect(recordedId: apid.RecordedId): Promise<void>;
    unprotect(recordedId: apid.RecordedId): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    cleanup(): Promise<void>;
    generateJikkyo(recordedId: apid.RecordedId): Promise<apid.GenerateJikkyoResult>;
    repair(recordedId: apid.RecordedId): Promise<ManualTsRepairResult>;
    rebuildChapters(recordedId: apid.RecordedId): Promise<RebuildChaptersResult>;
}

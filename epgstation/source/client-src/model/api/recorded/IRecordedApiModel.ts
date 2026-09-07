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

export type RecordedMaintenanceBulkAction = 'repair' | 'chapters';
export type RecordedMaintenanceBulkItemState =
    | 'queued'
    | 'checking'
    | 'repairing'
    | 'rebuilding-chapters'
    | 'completed'
    | 'failed';

export interface RecordedMaintenanceBulkItem {
    recordedId: apid.RecordedId;
    title: string;
    state: RecordedMaintenanceBulkItemState;
    message?: string;
}

export interface RecordedMaintenanceBulkJob {
    id: string;
    action: RecordedMaintenanceBulkAction;
    state: 'running' | 'completed' | 'failed';
    total: number;
    completed: number;
    failed: number;
    currentRecordedId: apid.RecordedId | null;
    currentTitle: string | null;
    currentState: RecordedMaintenanceBulkItemState | null;
    items: RecordedMaintenanceBulkItem[];
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
    getBulkMaintenanceJob(): Promise<RecordedMaintenanceBulkJob | null>;
    startBulkMaintenanceJob(action: RecordedMaintenanceBulkAction, recordedIds: apid.RecordedId[]): Promise<RecordedMaintenanceBulkJob>;
}

import * as apid from '../../../../../api';

export interface ManualTsRepairResult {
    status: 'healthy' | 'repaired';
    repaired: boolean;
    sourceVideoFileId: apid.VideoFileId;
    repairedVideoFileId?: apid.VideoFileId;
}

export interface RebuildChaptersResult {
    status: 'accepted';
    recordedId: apid.RecordedId;
}

export type RecordedMaintenanceBulkAction = 'repair' | 'chapters';
export type RecordedMaintenanceBulkItemState = 'queued' | 'checking' | 'repairing' | 'rebuilding-chapters' | 'completed' | 'failed' | 'canceled';

export interface RecordedMaintenanceBulkItem {
    recordedId: apid.RecordedId;
    title: string;
    state: RecordedMaintenanceBulkItemState;
    message?: string;
}

export interface RecordedMaintenanceBulkJob {
    id: string;
    action: RecordedMaintenanceBulkAction;
    state: 'running' | 'completed' | 'failed' | 'canceled';
    total: number;
    completed: number;
    failed: number;
    currentRecordedId: apid.RecordedId | null;
    currentTitle: string | null;
    currentState: RecordedMaintenanceBulkItemState | null;
    items: RecordedMaintenanceBulkItem[];
}

export type RecordedMaintenanceOrigin = 'automatic' | 'manual' | 'bulk';

export interface RecordedMaintenanceStatus {
    recordedId: apid.RecordedId;
    action: RecordedMaintenanceBulkAction;
    origin: RecordedMaintenanceOrigin;
    state: RecordedMaintenanceBulkItemState;
    message?: string;
    updatedAt: number;
}

export interface RecordedMaintenanceInfo {
    job: RecordedMaintenanceBulkJob | null;
    statuses: RecordedMaintenanceStatus[];
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
    getMaintenanceInfo(): Promise<RecordedMaintenanceInfo>;
    startBulkMaintenanceJob(action: RecordedMaintenanceBulkAction, recordedIds: apid.RecordedId[]): Promise<RecordedMaintenanceBulkJob>;
    cancelMaintenance(recordedId: apid.RecordedId, action: RecordedMaintenanceBulkAction): Promise<void>;
    cancelBulkMaintenanceJob(): Promise<RecordedMaintenanceBulkJob | null>;
}

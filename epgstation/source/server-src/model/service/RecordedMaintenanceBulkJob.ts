import IRecordedDB from '../db/IRecordedDB';
import container from '../ModelContainer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';
import {
    getRecordedAnalysisMarker,
    rebuildRecordedChapters,
    repairRecorded,
    RecordedMaintenanceStage,
    waitForRecordedChapterRebuild,
} from './RecordedMaintenance';

export type RecordedMaintenanceBulkAction = 'repair' | 'chapters';
export type RecordedMaintenanceBulkItemState =
    | 'queued'
    | 'checking'
    | 'repairing'
    | 'rebuilding-chapters'
    | 'completed'
    | 'failed';

export interface RecordedMaintenanceBulkItem {
    recordedId: number;
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
    currentRecordedId: number | null;
    currentTitle: string | null;
    currentState: RecordedMaintenanceBulkItemState | null;
    items: RecordedMaintenanceBulkItem[];
}

let currentJob: RecordedMaintenanceBulkJob | null = null;

const cloneJob = (): RecordedMaintenanceBulkJob | null => {
    return currentJob === null ? null : JSON.parse(JSON.stringify(currentJob));
};

const notifyMaintenance = (): void => {
    container.get<ISocketIOManageModel>('ISocketIOManageModel').notifyRecordedMaintenance();
};

const notifyRecordedUpdate = (): void => {
    container.get<ISocketIOManageModel>('ISocketIOManageModel').notifyClient();
};

const updateStage = (item: RecordedMaintenanceBulkItem, stage: RecordedMaintenanceStage): void => {
    item.state = stage;
    if (currentJob !== null) {
        currentJob.currentState = stage;
    }
    notifyMaintenance();
};

const runJob = async (job: RecordedMaintenanceBulkJob): Promise<void> => {
    const recordedDB = container.get<IRecordedDB>('IRecordedDB');

    try {
        for (const item of job.items) {
            job.currentRecordedId = item.recordedId;
            const recorded = await recordedDB.findId(item.recordedId);
            item.title = recorded === null ? `#${item.recordedId}` : recorded.name;
            job.currentTitle = item.title;
            notifyMaintenance();

            try {
                if (job.action === 'repair') {
                    await repairRecorded(item.recordedId, stage => updateStage(item, stage));
                } else {
                    const previousMarker = await getRecordedAnalysisMarker(item.recordedId);
                    await rebuildRecordedChapters(item.recordedId, stage => updateStage(item, stage));
                    await waitForRecordedChapterRebuild(item.recordedId, previousMarker);
                }

                item.state = 'completed';
                job.completed += 1;
                job.currentState = 'completed';
                notifyMaintenance();
                notifyRecordedUpdate();
            } catch (err: any) {
                item.state = 'failed';
                item.message = err && err.message ? err.message : String(err);
                job.completed += 1;
                job.failed += 1;
                job.currentState = 'failed';
                notifyMaintenance();
            }
        }

        job.currentRecordedId = null;
        job.currentTitle = null;
        job.currentState = null;
        job.state = 'completed';
        notifyMaintenance();
        notifyRecordedUpdate();
    } catch (err: any) {
        job.state = 'failed';
        job.currentState = 'failed';
        notifyMaintenance();
    }
};

export const getRecordedMaintenanceBulkJob = (): RecordedMaintenanceBulkJob | null => cloneJob();

export const startRecordedMaintenanceBulkJob = (
    action: RecordedMaintenanceBulkAction,
    recordedIds: number[],
): RecordedMaintenanceBulkJob => {
    if (currentJob !== null && currentJob.state === 'running') {
        throw new Error('recorded maintenance job is already running');
    }

    const ids = Array.from(new Set(recordedIds));
    const job: RecordedMaintenanceBulkJob = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        action,
        state: 'running',
        total: ids.length,
        completed: 0,
        failed: 0,
        currentRecordedId: null,
        currentTitle: null,
        currentState: null,
        items: ids.map(recordedId => ({
            recordedId,
            title: `#${recordedId}`,
            state: 'queued',
        })),
    };

    currentJob = job;
    notifyMaintenance();
    void runJob(job);

    return cloneJob() as RecordedMaintenanceBulkJob;
};

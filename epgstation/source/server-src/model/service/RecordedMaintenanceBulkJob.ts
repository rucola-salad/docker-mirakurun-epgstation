import IRecordedDB from '../db/IRecordedDB';
import container from '../ModelContainer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';
import {
    addManualRecordedMaintenanceJob,
    setRecordedMaintenanceStatus,
} from './RecordedMaintenanceQueue';
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
    | 'failed'
    | 'canceled';

export interface RecordedMaintenanceBulkItem {
    recordedId: number;
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
    currentRecordedId: number | null;
    currentTitle: string | null;
    currentState: RecordedMaintenanceBulkItemState | null;
    items: RecordedMaintenanceBulkItem[];
}

let currentJob: RecordedMaintenanceBulkJob | null = null;
let currentController: AbortController | null = null;

export const cancelRecordedMaintenanceBulkJob = (): boolean => {
    if (
        currentJob === null ||
        currentJob.state !== 'running' ||
        currentController === null
    ) {
        return false;
    }

    currentController.abort();
    currentJob.state = 'canceled';
    currentJob.currentState = 'canceled';

    for (const item of currentJob.items) {
        if (item.state !== 'queued') {
            continue;
        }

        item.state = 'canceled';
        currentJob.completed += 1;

        setRecordedMaintenanceStatus(
            item.recordedId,
            currentJob.action,
            'bulk',
            'canceled',
        );
    }

    notifyMaintenance();
    return true;
};

const cloneJob = (): RecordedMaintenanceBulkJob | null => {
    return currentJob === null ? null : JSON.parse(JSON.stringify(currentJob));
};

const notifyMaintenance = (): void => {
    container.get<ISocketIOManageModel>('ISocketIOManageModel').notifyRecordedMaintenance();
};

const notifyRecordedUpdate = (): void => {
    container.get<ISocketIOManageModel>('ISocketIOManageModel').notifyClient();
};

const updateStage = (
    item: RecordedMaintenanceBulkItem,
    action: RecordedMaintenanceBulkAction,
    stage: RecordedMaintenanceStage,
): void => {
    item.state = stage;
    if (currentJob !== null) {
        currentJob.currentState = stage;
    }
    setRecordedMaintenanceStatus(
        item.recordedId,
        action,
        'bulk',
        stage,
    );
    notifyMaintenance();
};

const runJob = async (
    job: RecordedMaintenanceBulkJob,
    signal: AbortSignal,
): Promise<void> => {
    const recordedDB = container.get<IRecordedDB>('IRecordedDB');

    try {
        for (const item of job.items) {
            if (signal.aborted) {
                if (item.state === 'queued') {
                    item.state = 'canceled';

                    setRecordedMaintenanceStatus(
                        item.recordedId,
                        job.action,
                        'bulk',
                        'canceled',
                    );
                }

                continue;
            }

            job.currentRecordedId = item.recordedId;
            const recorded = await recordedDB.findId(item.recordedId);
            item.title = recorded === null ? `#${item.recordedId}` : recorded.name;
            job.currentTitle = item.title;
            notifyMaintenance();

            try {
                if (job.action === 'repair') {
                    await repairRecorded(
                        item.recordedId,
                        stage => updateStage(item, job.action, stage),
                        signal,
                    );
                } else {
                    const previousMarker = await getRecordedAnalysisMarker(item.recordedId);
                    await rebuildRecordedChapters(
                        item.recordedId,
                        stage => updateStage(item, job.action, stage),
                        signal,
                    );
                    await waitForRecordedChapterRebuild(
                        item.recordedId,
                        previousMarker,
                        signal,
                    );
                }

                item.state = 'completed';
                setRecordedMaintenanceStatus(
                    item.recordedId,
                    job.action,
                    'bulk',
                    'completed',
                );
                job.completed += 1;
                job.currentState = 'completed';
                notifyMaintenance();
                notifyRecordedUpdate();
            } catch (err: any) {
                if (signal.aborted) {
                    item.state = 'canceled';
                    job.completed += 1;
                    job.currentState = 'canceled';

                    setRecordedMaintenanceStatus(
                        item.recordedId,
                        job.action,
                        'bulk',
                        'canceled',
                    );

                    notifyMaintenance();
                    continue;
                }

                item.state = 'failed';
                item.message = err && err.message ? err.message : String(err);
                setRecordedMaintenanceStatus(
                    item.recordedId,
                    job.action,
                    'bulk',
                    'failed',
                    item.message,
                );
                job.completed += 1;
                job.failed += 1;
                job.currentState = 'failed';
                notifyMaintenance();
            }
        }

        job.currentRecordedId = null;
        job.currentTitle = null;
        job.currentState = null;
        job.state = signal.aborted ? 'canceled' : 'completed';
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
    const controller = new AbortController();
    currentController = controller;

    notifyMaintenance();

    void addManualRecordedMaintenanceJob(
        () => runJob(job, controller.signal),
    ).finally(() => {
        if (currentController === controller) {
            currentController = null;
        }
    });

    return cloneJob() as RecordedMaintenanceBulkJob;
};

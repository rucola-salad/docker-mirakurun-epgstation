import container from '../ModelContainer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';

export type RecordedMaintenanceOrigin = 'automatic' | 'manual' | 'bulk';
export type RecordedMaintenanceAction = 'repair' | 'chapters';

export type RecordedMaintenanceState =
    | 'queued'
    | 'checking'
    | 'repairing'
    | 'rebuilding-chapters'
    | 'completed'
    | 'failed'
    | 'canceled';

export interface RecordedMaintenanceStatus {
    recordedId: number;
    action: RecordedMaintenanceAction;
    origin: RecordedMaintenanceOrigin;
    state: RecordedMaintenanceState;
    message?: string;
    updatedAt: number;
}

export class RecordedMaintenanceCanceledError extends Error {
    constructor() {
        super('recorded maintenance canceled');
        this.name = 'RecordedMaintenanceCanceledError';
    }
}

export interface RecordedMaintenanceContext {
    signal: AbortSignal;
}

interface ManualMaintenanceControl {
    recordedId: number;
    action: RecordedMaintenanceAction;
    origin: 'manual' | 'bulk';
    controller: AbortController;
    started: boolean;
}

const manualMaintenanceControls =
    new Map<string, ManualMaintenanceControl>();

export const throwIfRecordedMaintenanceCanceled = (
    signal?: AbortSignal,
): void => {
    if (typeof signal !== 'undefined' && signal.aborted) {
        throw new RecordedMaintenanceCanceledError();
    }
};

export const isRecordedMaintenanceCanceledError = (
    err: any,
): boolean => {
    return (
        err instanceof RecordedMaintenanceCanceledError ||
        (err !== null &&
            typeof err === 'object' &&
            err.name === 'RecordedMaintenanceCanceledError')
    );
};

export const cancelRecordedMaintenance = (
    recordedId: number,
    action: RecordedMaintenanceAction,
): boolean => {
    const control =
        manualMaintenanceControls.get(
            `${recordedId}:${action}`,
        );

    if (typeof control === 'undefined') {
        return false;
    }

    control.controller.abort();

    setRecordedMaintenanceStatus(
        recordedId,
        action,
        control.origin,
        'canceled',
    );

    return true;
};


class SerialQueue {
    private queue: Promise<void> = Promise.resolve();

    public add<T>(job: () => Promise<T>): Promise<T> {
        const result = this.queue.then(job);

        this.queue = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }
}

const automaticQueue = new SerialQueue();
const manualQueue = new SerialQueue();

const statuses = new Map<string, RecordedMaintenanceStatus>();

const keyOf = (
    recordedId: number,
    action: RecordedMaintenanceAction,
): string => `${recordedId}:${action}`;

const notifyMaintenance = (): void => {
    container
        .get<ISocketIOManageModel>('ISocketIOManageModel')
        .notifyRecordedMaintenance();
};

const cloneStatus = (
    status: RecordedMaintenanceStatus,
): RecordedMaintenanceStatus =>
    JSON.parse(JSON.stringify(status));

export const setRecordedMaintenanceStatus = (
    recordedId: number,
    action: RecordedMaintenanceAction,
    origin: RecordedMaintenanceOrigin,
    state: RecordedMaintenanceState,
    message?: string,
): RecordedMaintenanceStatus => {
    const status: RecordedMaintenanceStatus = {
        recordedId,
        action,
        origin,
        state,
        updatedAt: Date.now(),
    };

    if (typeof message !== 'undefined') {
        status.message = message;
    }

    statuses.set(keyOf(recordedId, action), status);
    notifyMaintenance();

    return cloneStatus(status);
};

export const getRecordedMaintenanceStatuses =
    (): RecordedMaintenanceStatus[] => {
        return Array.from(statuses.values()).map(cloneStatus);
    };

export const getRecordedMaintenanceStatus = (
    recordedId: number,
    action: RecordedMaintenanceAction,
): RecordedMaintenanceStatus | null => {
    const status = statuses.get(keyOf(recordedId, action));
    return typeof status === 'undefined' ? null : cloneStatus(status);
};

function runQueued<T>(
    queue: SerialQueue,
    recordedId: number,
    action: RecordedMaintenanceAction,
    origin: 'automatic',
    job: () => Promise<T>,
): Promise<T>;

function runQueued<T>(
    queue: SerialQueue,
    recordedId: number,
    action: RecordedMaintenanceAction,
    origin: 'manual' | 'bulk',
    job: (context: RecordedMaintenanceContext) => Promise<T>,
): Promise<T>;

async function runQueued<T>(
    queue: SerialQueue,
    recordedId: number,
    action: RecordedMaintenanceAction,
    origin: RecordedMaintenanceOrigin,
    job:
        | (() => Promise<T>)
        | ((context: RecordedMaintenanceContext) => Promise<T>),
): Promise<T> {
    setRecordedMaintenanceStatus(
        recordedId,
        action,
        origin,
        'queued',
    );

    if (origin === 'automatic') {
        const automaticJob =
            job as () => Promise<T>;

        return queue.add(async () => {
            try {
                const result = await automaticJob();

                setRecordedMaintenanceStatus(
                    recordedId,
                    action,
                    origin,
                    'completed',
                );

                return result;
            } catch (err: any) {
                setRecordedMaintenanceStatus(
                    recordedId,
                    action,
                    origin,
                    'failed',
                    err && err.message
                        ? err.message
                        : String(err),
                );

                throw err;
            }
        });
    }

    const control: ManualMaintenanceControl = {
        recordedId,
        action,
        origin,
        controller: new AbortController(),
        started: false,
    };

    const controlKey = keyOf(recordedId, action);
    manualMaintenanceControls.set(
        controlKey,
        control,
    );

    return queue.add(async () => {
        control.started = true;

        try {
            throwIfRecordedMaintenanceCanceled(
                control.controller.signal,
            );

            const manualJob =
                job as (
                    context: RecordedMaintenanceContext,
                ) => Promise<T>;

            const result = await manualJob({
                signal: control.controller.signal,
            });

            // job() が正常終了した時点で処理結果を確定する。
            // TS Repair の DB 登録などが完了した後に届いた
            // キャンセル要求で completed を canceled に戻さない。
            setRecordedMaintenanceStatus(
                recordedId,
                action,
                origin,
                'completed',
            );

            return result;
        } catch (err: any) {
            if (
                control.controller.signal.aborted ||
                isRecordedMaintenanceCanceledError(err)
            ) {
                setRecordedMaintenanceStatus(
                    recordedId,
                    action,
                    origin,
                    'canceled',
                );

                throw new RecordedMaintenanceCanceledError();
            }

            setRecordedMaintenanceStatus(
                recordedId,
                action,
                origin,
                'failed',
                err && err.message
                    ? err.message
                    : String(err),
            );

            throw err;
        } finally {
            if (
                manualMaintenanceControls.get(
                    controlKey,
                ) === control
            ) {
                manualMaintenanceControls.delete(
                    controlKey,
                );
            }
        }
    });
}

export const addAutomaticRecordedMaintenance = <T>(
    recordedId: number,
    action: RecordedMaintenanceAction,
    job: () => Promise<T>,
): Promise<T> => {
    return runQueued(
        automaticQueue,
        recordedId,
        action,
        'automatic',
        job,
    );
};

export const addManualRecordedMaintenance = <T>(
    recordedId: number,
    action: RecordedMaintenanceAction,
    origin: 'manual' | 'bulk',
    job: (
        context: RecordedMaintenanceContext,
    ) => Promise<T>,
): Promise<T> => {
    return runQueued(
        manualQueue,
        recordedId,
        action,
        origin,
        job,
    );
};

export const addManualRecordedMaintenanceJob = <T>(
    job: () => Promise<T>,
): Promise<T> => {
    return manualQueue.add(job);
};

import IChannelDB from '../db/IChannelDB';
import IRecordedDB from '../db/IRecordedDB';
import container from '../ModelContainer';
import IVideoUtil from '../api/video/IVideoUtil';
import ITsRepairManageModel from '../operator/tsRepair/ITsRepairManageModel';
import { requestCmAnalyzer } from './CmAnalyzerProxy';

export type RecordedMaintenanceStage = 'checking' | 'repairing' | 'rebuilding-chapters';

export interface ManualTsRepairResult {
    status: 'healthy' | 'repaired';
    repaired: boolean;
    sourceVideoFileId: number;
    repairedVideoFileId?: number;
}

export interface RebuildChaptersResult {
    status: 'accepted';
    sourceVideoFileId: number;
    sourceType: 'ts' | 'encoded';
    sourceName: string;
}

export class RecordedMaintenanceError extends Error {
    public readonly statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
    }
}

interface ChapterCacheEntry {
    value: boolean;
    expiresAt: number;
}

const chapterCache = new Map<number, ChapterCacheEntry>();

export const invalidateRecordedChapterStatus = (recordedId: number): void => {
    chapterCache.delete(recordedId);
};

const loadAnalysis = async (recordedId: number): Promise<any | null> => {
    try {
        const result = await requestCmAnalyzer(`analysis/${recordedId}`, 'GET', undefined, 1000);
        if (result.statusCode !== 200) {
            return null;
        }
        return JSON.parse(result.body.toString('utf8'));
    } catch (err) {
        return null;
    }
};

export const hasRecordedChapters = async (recordedId: number, force = false): Promise<boolean> => {
    const now = Date.now();
    const cached = chapterCache.get(recordedId);
    if (!force && typeof cached !== 'undefined' && cached.expiresAt > now) {
        return cached.value;
    }

    const analysis = await loadAnalysis(recordedId);
    const value =
        analysis !== null &&
        analysis.timeline &&
        Array.isArray(analysis.timeline.chapters) &&
        analysis.timeline.chapters.length > 0;

    chapterCache.set(recordedId, {
        value,
        expiresAt: now + (value ? 60000 : 5000),
    });

    return value;
};

export const getRecordedAnalysisMarker = async (recordedId: number): Promise<string | null> => {
    const analysis = await loadAnalysis(recordedId);
    return analysis !== null && typeof analysis.analyzedAt === 'string' ? analysis.analyzedAt : null;
};

export const repairRecorded = async (
    recordedId: number,
    onStage?: (stage: RecordedMaintenanceStage) => void,
): Promise<ManualTsRepairResult> => {
    const recordedDB = container.get<IRecordedDB>('IRecordedDB');
    const tsRepairManage = container.get<ITsRepairManageModel>('ITsRepairManageModel');
    const recorded = await recordedDB.findId(recordedId);

    if (recorded === null) {
        throw new RecordedMaintenanceError(404, 'recorded is not found');
    }

    const videoFiles = recorded.videoFiles || [];
    const repaired = videoFiles
        .filter(v => v.type === 'ts' && v.name === 'TS Repair')
        .sort((a, b) => b.id - a.id)[0];
    const original = videoFiles
        .filter(v => v.type === 'ts' && v.name !== 'TS Repair')
        .sort((a, b) => a.id - b.id)[0];

    if (typeof original === 'undefined' && typeof repaired === 'undefined') {
        throw new RecordedMaintenanceError(409, 'repairable TS video file is not found');
    }

    const checkTarget = repaired || original;
    if (typeof onStage !== 'undefined') {
        onStage('checking');
    }
    const healthy = await tsRepairManage.check(recorded, checkTarget.id);

    if (healthy === null) {
        throw new RecordedMaintenanceError(500, 'TS health check could not be executed');
    }

    if (healthy === true) {
        return {
            status: 'healthy',
            repaired: false,
            sourceVideoFileId: checkTarget.id,
        };
    }

    const repairSource = original || repaired;
    if (typeof onStage !== 'undefined') {
        onStage('repairing');
    }
    const repairedVideoFileId = await tsRepairManage.repair(recorded, repairSource.id);

    if (repairedVideoFileId === null) {
        throw new RecordedMaintenanceError(500, 'TS repair failed');
    }

    return {
        status: 'repaired',
        repaired: true,
        sourceVideoFileId: repairSource.id,
        repairedVideoFileId,
    };
};

export const rebuildRecordedChapters = async (
    recordedId: number,
    onStage?: (stage: RecordedMaintenanceStage) => void,
): Promise<RebuildChaptersResult> => {
    const recordedDB = container.get<IRecordedDB>('IRecordedDB');
    const channelDB = container.get<IChannelDB>('IChannelDB');
    const videoUtil = container.get<IVideoUtil>('IVideoUtil');
    const recorded = await recordedDB.findId(recordedId);

    if (recorded === null) {
        throw new RecordedMaintenanceError(404, 'recorded is not found');
    }

    const videoFiles = recorded.videoFiles || [];
    const repaired = videoFiles
        .filter(v => v.type === 'ts' && v.name === 'TS Repair')
        .sort((a, b) => b.id - a.id)[0];
    const original = videoFiles
        .filter(v => v.type === 'ts' && v.name !== 'TS Repair')
        .sort((a, b) => a.id - b.id)[0];
    const encoded = videoFiles
        .filter(v => v.type === 'encoded')
        .sort((a, b) => b.id - a.id)[0];

    const source = repaired || original || encoded;
    if (typeof source === 'undefined') {
        throw new RecordedMaintenanceError(409, 'analyzable video file is not found');
    }

    const recPath = await videoUtil.getFullFilePathFromId(source.id);
    if (recPath === null) {
        throw new RecordedMaintenanceError(404, 'source video file is not found');
    }

    const channel = await channelDB.findId(recorded.channelId);
    if (typeof onStage !== 'undefined') {
        onStage('rebuilding-chapters');
    }
    invalidateRecordedChapterStatus(recordedId);

    const result = await requestCmAnalyzer('analyze', 'POST', {
        recordedId: recorded.id,
        recPath,
        channelName: channel === null ? '' : channel.name,
        title: recorded.name,
        sourceVideoFileId: source.id,
    });

    if (result.statusCode !== 202) {
        throw new RecordedMaintenanceError(502, 'CM analyzer rebuild request failed');
    }

    return {
        status: 'accepted',
        sourceVideoFileId: source.id,
        sourceType: source.type as 'ts' | 'encoded',
        sourceName: source.name,
    };
};

export const waitForRecordedChapterRebuild = async (
    recordedId: number,
    previousMarker: string | null,
): Promise<void> => {
    const timeoutMs = Math.max(60000, Number(process.env.CM_ANALYZER_BULK_TIMEOUT_MS) || 7200000);
    const startedAt = Date.now();
    let seenPending = false;
    let absentChecks = 0;

    while (Date.now() - startedAt < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const marker = await getRecordedAnalysisMarker(recordedId);
        if (marker !== null && marker !== previousMarker) {
            invalidateRecordedChapterStatus(recordedId);
            return;
        }

        try {
            const health = await requestCmAnalyzer('health', 'GET', undefined, 2000);
            if (health.statusCode !== 200) {
                continue;
            }

            const body = JSON.parse(health.body.toString('utf8'));
            const id = String(recordedId);
            const currentId = body.currentJob && String(body.currentJob.recordedId);
            const queued = Array.isArray(body.queuedJobs)
                ? body.queuedJobs.some((job: any) => String(job.recordedId) === id)
                : false;
            const pending = currentId === id || queued;

            if (pending) {
                seenPending = true;
                absentChecks = 0;
            } else {
                absentChecks += 1;
            }

            if (!pending && (seenPending || (Date.now() - startedAt > 10000 && absentChecks >= 3))) {
                throw new Error('CM analyzer finished without a new analysis result');
            }
        } catch (err: any) {
            if (err && err.message === 'CM analyzer finished without a new analysis result') {
                throw err;
            }
        }
    }

    throw new Error('CM analyzer rebuild timed out');
};

export type CmAnalyzerLogoStatus = 'unknown' | 'missing' | 'improving' | 'good' | 'backoff' | 'suspended' | 'unsupported';

export interface ICmAnalyzerLogo {
    stationId: string | null;
    serviceId: string | null;
    channelName: string | null;
    channelType: string | null;
    physicalChannel: string | null;
    hasLogo: boolean;
    qualityScore: number | null;
    generatedAt: string | null;
    hasMeta: boolean;
    status: CmAnalyzerLogoStatus;
    lastCollectAt: string | null;
    nextCollectAt: string | null;
    consecutiveDetectionFailures: number;
    lastResult: string | null;
}

export type CmAnalyzerLogoCollectorPhase =
    | 'idle'
    | 'selecting'
    | 'sampling'
    | 'probing'
    | 'analyzing';

export interface ICmAnalyzerLogoCollectorWorkerStatus {
    running: boolean;
    phase: CmAnalyzerLogoCollectorPhase;
    stationId: string | null;
    channelName: string | null;
    programName: string | null;
}

export interface ICmAnalyzerLogoCollectorStatus {
    enabled: boolean;
    startupEnabled: boolean;
    workers: {
        GR: ICmAnalyzerLogoCollectorWorkerStatus;
        BSCS: ICmAnalyzerLogoCollectorWorkerStatus;
    };
}

export interface ICmAnalyzerChapter {
    number: number;
    time: number;
    timeText: string;
    name: string;
}

export interface ICmAnalyzerCmRange {
    startFrame: number;
    endFrame: number;
    startTime?: number;
    endTime?: number;
}

export interface ICmAnalyzerKeepRange {
    startFrame: number;
    endFrame: number;
}

export type CmAnalyzerCutRangeKind = 'head' | 'cm' | 'other' | 'tail';

export interface ICmAnalyzerCutRange {
    startFrame: number;
    endFrame: number;
    startTime: number;
    endTime: number;
    kind: CmAnalyzerCutRangeKind;
}

export type CmAnalyzerManualPinType = 'chapter' | 'main-start' | 'cm-start' | 'cm-end' | 'main-end';

export interface ICmAnalyzerManualPin {
    frame: number;
    type: CmAnalyzerManualPinType;
}

export interface ICmAnalyzerManualTimeline {
    active: boolean;
    hasAutomaticAnalysis: boolean;
    frameRate?: number;
    duration?: number | null;
    pins: ICmAnalyzerManualPin[];
    savedAt?: string | null;
}

export interface ICmAnalyzerAnalysis {
    version: number;
    recordedId: string;
    stationId: string;
    analyzedAt: string;
    timeline: {
        frameRate?: number;
        chapters: ICmAnalyzerChapter[];
        cmRanges: ICmAnalyzerCmRange[];
        keepRanges: ICmAnalyzerKeepRange[];
        cutRanges?: ICmAnalyzerCutRange[];
        playbackStart?: number;
        playbackEnd?: number;
    };
    manualTimeline?: ICmAnalyzerManualTimeline;
}

export default interface ICmAnalyzerApiModel {
    getLogos(): Promise<ICmAnalyzerLogo[]>;
    deleteLogo(stationId: string): Promise<void>;
    getLogoCollectorStatus(): Promise<ICmAnalyzerLogoCollectorStatus>;
    startLogoCollector(): Promise<ICmAnalyzerLogoCollectorStatus>;
    stopLogoCollector(): Promise<ICmAnalyzerLogoCollectorStatus>;
    getAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null>;
    saveManualTimeline(recordedId: number, frameRate: number, duration: number, pins: ICmAnalyzerManualPin[]): Promise<ICmAnalyzerAnalysis>;
    restoreAutomaticAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null>;
}

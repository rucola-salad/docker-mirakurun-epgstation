export type CmAnalyzerLogoStatus =
    'unknown' |
    'missing' |
    'improving' |
    'good' |
    'backoff' |
    'suspended' |
    'unsupported';

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

export type CmAnalyzerCutRangeKind =
    'head' |
    'cm' |
    'other' |
    'tail';

export interface ICmAnalyzerCutRange {
    startFrame: number;
    endFrame: number;
    startTime: number;
    endTime: number;
    kind: CmAnalyzerCutRangeKind;
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
}

export default interface ICmAnalyzerApiModel {
    getLogos(): Promise<ICmAnalyzerLogo[]>;
    deleteLogo(stationId: string): Promise<void>;
    getAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null>;
}

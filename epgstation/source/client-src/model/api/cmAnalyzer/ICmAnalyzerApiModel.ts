export type CmAnalyzerLogoStatus =
    'unknown' |
    'good' |
    'improving';

export interface ICmAnalyzerLogo {
    stationId: string;
    channelName: string | null;
    qualityScore: number | null;
    generatedAt: string | null;
    hasMeta: boolean;
    status: CmAnalyzerLogoStatus;
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
    };
}

export default interface ICmAnalyzerApiModel {
    getLogos(): Promise<ICmAnalyzerLogo[]>;
    deleteLogo(stationId: string): Promise<void>;
    getAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null>;
}

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

export default interface ICmAnalyzerApiModel {
    getLogos(): Promise<ICmAnalyzerLogo[]>;
    deleteLogo(stationId: string): Promise<void>;
}

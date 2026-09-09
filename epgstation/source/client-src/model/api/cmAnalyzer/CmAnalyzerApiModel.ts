import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import ICmAnalyzerApiModel, {
    ICmAnalyzerAnalysis,
    ICmAnalyzerLogo,
    ICmAnalyzerLogoCollectorStatus,
    ICmAnalyzerManualPin,
} from './ICmAnalyzerApiModel';

@injectable()
export default class CmAnalyzerApiModel implements ICmAnalyzerApiModel {
    private repository: IRepositoryModel;

    constructor(
        @inject('IRepositoryModel')
        repository: IRepositoryModel,
    ) {
        this.repository = repository;
    }

    public async getLogos(): Promise<ICmAnalyzerLogo[]> {
        const result = await this.repository.get('/cm-analyzer/logos');

        if (!result.data || !Array.isArray(result.data.logos)) {
            return [];
        }

        return result.data.logos;
    }

    public async deleteLogo(stationId: string): Promise<void> {
        await this.repository.delete(`/cm-analyzer/logos/${encodeURIComponent(stationId)}`);
    }

    public async getLogoCollectorStatus(): Promise<ICmAnalyzerLogoCollectorStatus> {
        const result = await this.repository.get(
            '/cm-analyzer/logo-collector/status',
        );

        return result.data as ICmAnalyzerLogoCollectorStatus;
    }

    public async startLogoCollector(): Promise<ICmAnalyzerLogoCollectorStatus> {
        const result = await this.repository.post(
            '/cm-analyzer/logo-collector/start',
        );

        return result.data as ICmAnalyzerLogoCollectorStatus;
    }

    public async stopLogoCollector(): Promise<ICmAnalyzerLogoCollectorStatus> {
        const result = await this.repository.post(
            '/cm-analyzer/logo-collector/stop',
        );

        return result.data as ICmAnalyzerLogoCollectorStatus;
    }

    public async getAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null> {
        try {
            const result = await this.repository.get(`/cm-analyzer/analysis/${recordedId.toString(10)}`);

            return result.data as ICmAnalyzerAnalysis;
        } catch (err) {
            const response = (err as any).response;

            if (response && response.status === 404) {
                return null;
            }

            throw err;
        }
    }
    public async saveManualTimeline(recordedId: number, frameRate: number, duration: number, pins: ICmAnalyzerManualPin[]): Promise<ICmAnalyzerAnalysis> {
        const result = await this.repository.post(`/cm-analyzer/analysis/${recordedId.toString(10)}`, {
            frameRate,
            duration,
            pins,
        });

        return result.data as ICmAnalyzerAnalysis;
    }

    public async restoreAutomaticAnalysis(recordedId: number): Promise<ICmAnalyzerAnalysis | null> {
        const result = await this.repository.delete(`/cm-analyzer/analysis/${recordedId.toString(10)}`);

        if (result.data && result.data.analysis) {
            return result.data.analysis as ICmAnalyzerAnalysis;
        }

        return null;
    }
}

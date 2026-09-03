import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import ICmAnalyzerApiModel, { ICmAnalyzerLogo } from './ICmAnalyzerApiModel';

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
}

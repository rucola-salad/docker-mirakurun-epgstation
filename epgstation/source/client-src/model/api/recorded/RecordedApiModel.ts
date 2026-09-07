import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IRecordedApiModel, {
    ManualTsRepairResult,
    RebuildChaptersResult,
    RecordedMaintenanceBulkAction,
    RecordedMaintenanceBulkJob,
} from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        const result = await this.repository.get('/recorded', { params: option });
        return result.data;
    }

    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem> {
        const result = await this.repository.get(`/recorded/${recordedId.toString(10)}`, {
            params: { isHalfWidth },
        });
        return result.data;
    }

    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const result = await this.repository.get('/recorded/options');
        return result.data;
    }

    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.delete(`/recorded/${recordedId}`);
    }

    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.delete(`/recorded/${recordedId}/encode`);
    }

    public async protect(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.put(`/recorded/${recordedId}/protect`);
    }

    public async unprotect(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.put(`/recorded/${recordedId}/unprotect`);
    }

    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        const result = await this.repository.post('recorded', option);
        return result.data.recordedId;
    }

    public async cleanup(): Promise<void> {
        await this.repository.post('/recorded/cleanup');
    }

    public async generateJikkyo(recordedId: apid.RecordedId): Promise<apid.GenerateJikkyoResult> {
        const result = await this.repository.post(`/recorded/${recordedId.toString(10)}/jikkyo`);
        return result.data;
    }

    public async repair(recordedId: apid.RecordedId): Promise<ManualTsRepairResult> {
        const result = await this.repository.post(`/recorded/${recordedId.toString(10)}/repair`);
        return result.data;
    }

    public async rebuildChapters(recordedId: apid.RecordedId): Promise<RebuildChaptersResult> {
        const result = await this.repository.post(`/recorded/${recordedId.toString(10)}/chapters`);
        return result.data;
    }

    public async getBulkMaintenanceJob(): Promise<RecordedMaintenanceBulkJob | null> {
        const result = await this.repository.get('/recorded/bulk-maintenance');
        return result.data.job;
    }

    public async startBulkMaintenanceJob(
        action: RecordedMaintenanceBulkAction,
        recordedIds: apid.RecordedId[],
    ): Promise<RecordedMaintenanceBulkJob> {
        const result = await this.repository.post('/recorded/bulk-maintenance', { action, recordedIds });
        return result.data.job;
    }
}

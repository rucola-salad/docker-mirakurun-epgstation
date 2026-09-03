import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IExtensionSettingsApiModel from './IExtensionSettingsApiModel';

@injectable()
export default class ExtensionSettingsApiModel implements IExtensionSettingsApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async get(): Promise<apid.ExtensionSettings> {
        const result = await this.repository.get('/extension-settings');
        return result.data;
    }

    public async update(settings: apid.ExtensionSettings): Promise<apid.ExtensionSettings> {
        const result = await this.repository.put('/extension-settings', settings);
        return result.data;
    }
}

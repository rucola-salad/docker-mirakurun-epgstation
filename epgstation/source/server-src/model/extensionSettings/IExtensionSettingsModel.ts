import * as apid from '../../../api';

export default interface IExtensionSettingsModel {
    get(): Promise<apid.ExtensionSettings>;
    update(settings: apid.ExtensionSettings): Promise<apid.ExtensionSettings>;
}

import IStorageBaseModel from '../IStorageBaseModel';

export interface IGuideProgramDialogSettingValue {
    encode: string;
    cmCut: boolean;
    isDeleteOriginalAfterEncode: boolean;
}

export const NONE_ENCODE_OPTION = 'TS';

export type IGuideProgramDialogSettingStorageModel = IStorageBaseModel<IGuideProgramDialogSettingValue>;

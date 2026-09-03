import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import IExtensionSettingsModel from '../../extensionSettings/IExtensionSettingsModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    const model = container.get<IExtensionSettingsModel>('IExtensionSettingsModel');

    try {
        api.responseJSON(res, 200, await model.get());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '拡張設定取得',
    tags: ['extension-settings'],
    description: '拡張設定を取得する',
    responses: {
        200: {
            description: '拡張設定を取得しました',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

export const put: Operation = async (req, res) => {
    const model = container.get<IExtensionSettingsModel>('IExtensionSettingsModel');

    try {
        const settings: apid.ExtensionSettings = req.body;
        api.responseJSON(res, 200, await model.update(settings));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '拡張設定更新',
    tags: ['extension-settings'],
    description: '拡張設定を更新する',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['autoGenerateJikkyoXml'],
                    properties: {
                        autoGenerateJikkyoXml: {
                            type: 'boolean',
                        },
                    },
                },
            },
        },
    },
    responses: {
        200: {
            description: '拡張設定を更新しました',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

import { Operation } from 'express-openapi';
import {
    getRecordedMaintenanceBulkJob,
    RecordedMaintenanceBulkAction,
    startRecordedMaintenanceBulkJob,
} from '../../RecordedMaintenanceBulkJob';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    api.responseJSON(res, 200, { job: getRecordedMaintenanceBulkJob() });
};

export const post: Operation = async (req, res) => {
    const action = req.body && req.body.action;
    const recordedIds = req.body && req.body.recordedIds;

    if ((action !== 'repair' && action !== 'chapters') || !Array.isArray(recordedIds)) {
        api.responseError(res, { code: 400, message: 'invalid maintenance request' });
        return;
    }

    const ids = recordedIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isInteger(id) && id > 0);

    if (ids.length === 0 || ids.length !== recordedIds.length) {
        api.responseError(res, { code: 400, message: 'recordedIds must contain valid ids' });
        return;
    }

    try {
        const job = startRecordedMaintenanceBulkJob(action as RecordedMaintenanceBulkAction, ids);
        api.responseJSON(res, 202, { job });
    } catch (err: any) {
        api.responseError(res, {
            code: err && err.message === 'recorded maintenance job is already running' ? 409 : 500,
            message: err && err.message ? err.message : 'failed to start maintenance job',
        });
    }
};

get.apiDoc = {
    summary: '録画一括メンテナンス状態取得',
    tags: ['recorded'],
    responses: {
        200: { description: '一括処理状態' },
        default: { description: '予期しないエラー' },
    },
};

post.apiDoc = {
    summary: '録画一括メンテナンス開始',
    tags: ['recorded'],
    description: '録画修復またはチャプター再作成を1件ずつ順次実行する',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['action', 'recordedIds'],
                    properties: {
                        action: { type: 'string', enum: ['repair', 'chapters'] },
                        recordedIds: {
                            type: 'array',
                            minItems: 1,
                            items: { type: 'integer' },
                        },
                    },
                },
            },
        },
    },
    responses: {
        202: { description: '一括処理を開始しました' },
        400: { description: 'リクエストが不正です' },
        409: { description: '別の一括処理が実行中です' },
        default: { description: '予期しないエラー' },
    },
};

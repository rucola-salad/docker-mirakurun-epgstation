import { Operation } from 'express-openapi';
import * as api from '../../../api';
import {
    cancelRecordedMaintenanceBulkJob,
    getRecordedMaintenanceBulkJob,
} from '../../../RecordedMaintenanceBulkJob';

export const post: Operation = async (_req, res) => {
    const canceled =
        cancelRecordedMaintenanceBulkJob();

    api.responseJSON(res, 200, {
        status: canceled
            ? 'canceling'
            : 'not-running',
        canceled,
        job: getRecordedMaintenanceBulkJob(),
    });
};

post.apiDoc = {
    tags: ['recorded'],
    operationId:
        'cancelRecordedMaintenanceBulkJob',
    summary: '一括録画メンテナンスをキャンセルする',
    responses: {
        200: {
            description:
                'キャンセル要求を処理しました',
        },
        default: {
            description:
                '予期しないエラー',
        },
    },
};

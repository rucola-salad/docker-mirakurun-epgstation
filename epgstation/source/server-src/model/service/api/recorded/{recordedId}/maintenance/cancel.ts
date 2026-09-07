import { Operation } from 'express-openapi';
import * as api from '../../../../api';
import {
    cancelRecordedMaintenance,
    RecordedMaintenanceAction,
} from '../../../../RecordedMaintenanceQueue';

export const post: Operation = async (req, res) => {
    const recordedId = parseInt(req.params.recordedId, 10);

    if (!Number.isFinite(recordedId)) {
        api.responseError(res, {
            code: 400,
            message: 'recordedId is invalid',
        });
        return;
    }

    const action =
        req.body &&
        req.body.action as RecordedMaintenanceAction;

    if (
        action !== 'repair' &&
        action !== 'chapters'
    ) {
        api.responseError(res, {
            code: 400,
            message:
                'action must be repair or chapters',
        });
        return;
    }

    const canceled = cancelRecordedMaintenance(
        recordedId,
        action,
    );

    api.responseJSON(res, 200, {
        status: canceled
            ? 'canceling'
            : 'not-running',
        recordedId,
        action,
        canceled,
    });
};

post.apiDoc = {
    tags: ['recorded'],
    operationId: 'cancelRecordedMaintenance',
    summary: '手動録画メンテナンスをキャンセルする',
    parameters: [
        {
            $ref:
                '#/components/parameters/PathRecordedId',
        },
    ],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['action'],
                    properties: {
                        action: {
                            type: 'string',
                            enum: [
                                'repair',
                                'chapters',
                            ],
                        },
                    },
                },
            },
        },
    },
    responses: {
        200: {
            description:
                'キャンセル要求を処理しました',
        },
        400: {
            description:
                'パラメータが不正です',
        },
        default: {
            description:
                '予期しないエラー',
        },
    },
};

import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const recordedId =
        String(req.params.recordedId || '');

    if (!/^\d+$/.test(recordedId)) {
        api.responseError(res, {
            code: 400,
            message: 'invalid recordedId',
        });
        return;
    }

    try {
        const result =
            await requestCmAnalyzer(
                `analysis/${recordedId}`,
            );

        if (result.statusCode === 404) {
            api.responseError(res, {
                code: 404,
                message:
                    'CM analysis is not found',
            });
            return;
        }

        if (result.statusCode !== 200) {
            api.responseError(res, {
                code: 502,
                message:
                    'CM analyzer analysis request failed',
            });
            return;
        }

        let body: any;

        try {
            body =
                JSON.parse(
                    result.body.toString('utf8'),
                );
        } catch (_err) {
            api.responseError(res, {
                code: 502,
                message:
                    'CM analyzer returned invalid JSON',
            });
            return;
        }

        api.responseJSON(
            res,
            200,
            body,
        );
    } catch (err: any) {
        api.responseError(res, {
            code: 502,
            message:
                err.message ||
                'CM analyzer request failed',
        });
    }
};

get.apiDoc = {
    summary: 'CM解析結果取得',
    tags: ['cm-analyzer'],
    description:
        '録画IDに対応するCM解析結果を取得する',
    parameters: [
        {
            in: 'path',
            name: 'recordedId',
            required: true,
            schema: {
                type: 'integer',
                minimum: 1,
            },
        },
    ],
    responses: {
        200: {
            description:
                'CM解析結果を取得しました',
        },
        400: {
            description:
                'recordedId が不正です',
        },
        404: {
            description:
                'CM解析結果がありません',
        },
        default: {
            description:
                '予期しないエラー',
        },
    },
};

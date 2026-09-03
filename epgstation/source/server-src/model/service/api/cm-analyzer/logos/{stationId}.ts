import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const del: Operation = async (req, res) => {
    const stationId =
        String(req.params.stationId || '');

    if (
        !/^[A-Za-z0-9_-]+$/.test(
            stationId,
        )
    ) {
        api.responseError(res, {
            code: 400,
            message: 'invalid stationId',
        });
        return;
    }

    try {
        const result =
            await requestCmAnalyzer(
                `logos/${encodeURIComponent(
                    stationId,
                )}`,
                'DELETE',
            );

        if (result.statusCode === 404) {
            api.responseError(res, {
                code: 404,
                message:
                    'CM analyzer logo is not found',
            });
            return;
        }

        if (result.statusCode !== 200) {
            api.responseError(res, {
                code: 502,
                message:
                    'CM analyzer logo delete request failed',
            });
            return;
        }

        let body: any;

        try {
            body =
                JSON.parse(
                    result.body.toString('utf8'),
                );
        } catch (err) {
            api.responseError(res, {
                code: 502,
                message:
                    'CM analyzer returned invalid JSON',
            });
            return;
        }

        api.responseJSON(res, 200, body);
    } catch (err: any) {
        api.responseError(res, {
            code: 502,
            message:
                err.message ||
                'CM analyzer request failed',
        });
    }
};

del.apiDoc = {
    summary: 'CM解析ロゴ削除',
    tags: ['cm-analyzer'],
    description:
        'CM Analyzer が保持しているLGDと品質情報を削除する',
    parameters: [
        {
            in: 'path',
            name: 'stationId',
            required: true,
            schema: {
                type: 'string',
                pattern:
                    '^[A-Za-z0-9_-]+$',
            },
        },
    ],
    responses: {
        200: {
            description:
                'CM解析ロゴを削除しました',
        },
        400: {
            description:
                'stationId が不正です',
        },
        404: {
            description:
                'ロゴがありません',
        },
        default: {
            description:
                '予期しないエラー',
        },
    },
};

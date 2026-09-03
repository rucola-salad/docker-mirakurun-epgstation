import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../../CmAnalyzerProxy';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const stationId =
        String(req.params.stationId || '');

    if (
        !/^[A-Za-z0-9_-]+$/.test(
            stationId,
        )
    ) {
        api.responseError(res, {
            code: 400,
            message:
                'invalid stationId',
        });
        return;
    }

    try {
        const result =
            await requestCmAnalyzer(
                `logos/${encodeURIComponent(
                    stationId,
                )}/preview`,
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
                    'CM analyzer logo preview request failed',
            });
            return;
        }

        res.setHeader(
            'Content-Type',
            'image/png',
        );
        res.setHeader(
            'Content-Length',
            result.body.length,
        );
        res.setHeader(
            'Cache-Control',
            'private, no-cache, no-store, must-revalidate',
        );

        res.status(200);
        res.end(result.body);
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
    summary: 'CM解析ロゴプレビュー取得',
    tags: ['cm-analyzer'],
    description:
        'CM Analyzer が保持しているLGDのプレビュー画像を取得する',
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
                'CM解析ロゴプレビューを取得しました',
            content: {
                'image/png': {},
            },
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

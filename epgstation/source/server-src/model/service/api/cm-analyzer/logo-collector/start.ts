import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const post: Operation = async (_req, res) => {
    try {
        const result = await requestCmAnalyzer(
            'logo-collector/start',
            'POST',
        );

        if (result.statusCode !== 200) {
            api.responseError(res, {
                code: 502,
                message: 'CM analyzer logo collector start request failed',
            });
            return;
        }

        let body: any;

        try {
            body = JSON.parse(
                result.body.toString('utf8'),
            );
        } catch (_err) {
            api.responseError(res, {
                code: 502,
                message: 'CM analyzer returned invalid JSON',
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

post.apiDoc = {
    summary: 'CM解析ロゴ自動取得開始',
    tags: ['cm-analyzer'],
    description:
        'CM Analyzer のロゴ自動取得を現在のプロセスで開始する',
    responses: {
        200: {
            description:
                'ロゴ自動取得を開始しました',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

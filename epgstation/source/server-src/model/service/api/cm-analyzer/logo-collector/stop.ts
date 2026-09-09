import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const post: Operation = async (_req, res) => {
    try {
        const result = await requestCmAnalyzer(
            'logo-collector/stop',
            'POST',
        );

        if (result.statusCode !== 200) {
            api.responseError(res, {
                code: 502,
                message: 'CM analyzer logo collector stop request failed',
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
    summary: 'CM解析ロゴ自動取得停止',
    tags: ['cm-analyzer'],
    description:
        'CM Analyzer のロゴ自動取得を現在のプロセスで停止する',
    responses: {
        200: {
            description:
                'ロゴ自動取得を停止しました',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

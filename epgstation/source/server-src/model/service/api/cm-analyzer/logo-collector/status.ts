import { Operation } from 'express-openapi';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const get: Operation = async (_req, res) => {
    try {
        const result = await requestCmAnalyzer(
            'logo-collector/status',
        );

        if (result.statusCode !== 200) {
            api.responseError(res, {
                code: 502,
                message: 'CM analyzer logo collector status request failed',
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

get.apiDoc = {
    summary: 'CM解析ロゴ自動取得状態取得',
    tags: ['cm-analyzer'],
    description:
        'CM Analyzer のロゴ自動取得の現在状態を取得する',
    responses: {
        200: {
            description:
                'ロゴ自動取得状態を取得しました',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

import { Operation } from 'express-openapi';
import {
    rebuildRecordedChapters,
    RecordedMaintenanceError,
} from '../../../RecordedMaintenance';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const recordedId = parseInt(req.params.recordedId, 10);

    if (Number.isNaN(recordedId)) {
        api.responseError(res, { code: 400, message: 'invalid recorded id' });
        return;
    }

    try {
        const result = await rebuildRecordedChapters(recordedId);
        api.responseJSON(res, 202, result);
    } catch (err: any) {
        if (err instanceof RecordedMaintenanceError) {
            api.responseError(res, { code: err.statusCode, message: err.message });
            return;
        }
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'チャプター再作成',
    tags: ['recorded', 'cm-analyzer'],
    description: 'TS Repair、TS、encoded の優先順で解析対象を選びCM Analyzerを再実行する',
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        202: { description: 'CM Analyzerへ再解析を要求しました' },
        404: { description: '録画または動画ファイルがありません' },
        409: { description: '解析可能な動画ファイルがありません' },
        default: { description: '予期しないエラー' },
    },
};

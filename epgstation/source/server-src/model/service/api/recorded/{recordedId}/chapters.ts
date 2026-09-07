import { Operation } from 'express-openapi';
import {
    getRecordedAnalysisMarker,
    rebuildRecordedChapters,
    RecordedMaintenanceError,
    waitForRecordedChapterRebuild,
} from '../../../RecordedMaintenance';
import * as api from '../../../api';
import {
    addManualRecordedMaintenance,
    setRecordedMaintenanceStatus,
} from '../../../RecordedMaintenanceQueue';

export const post: Operation = async (req, res) => {
    const recordedId = parseInt(req.params.recordedId, 10);

    if (Number.isNaN(recordedId)) {
        api.responseError(res, { code: 400, message: 'invalid recorded id' });
        return;
    }

    try {
        void addManualRecordedMaintenance(
            recordedId,
            'chapters',
            'manual',
            async context => {
                const previousMarker = await getRecordedAnalysisMarker(recordedId);
                const rebuildResult = await rebuildRecordedChapters(
                    recordedId,
                    stage => {
                        setRecordedMaintenanceStatus(
                            recordedId,
                            'chapters',
                            'manual',
                            stage,
                        );
                    },
                    context.signal,
                );
                await waitForRecordedChapterRebuild(
                    recordedId,
                    previousMarker,
                    context.signal,
                );
                return rebuildResult;
            },
        ).catch(() => {
            // Failure is exposed through RecordedMaintenanceStatus.
        });

        api.responseJSON(res, 202, {
            status: 'accepted',
            recordedId,
        });
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
        202: { description: 'チャプター再作成を受け付けました' },
        404: { description: '録画または動画ファイルがありません' },
        409: { description: '解析可能な動画ファイルがありません' },
        default: { description: '予期しないエラー' },
    },
};

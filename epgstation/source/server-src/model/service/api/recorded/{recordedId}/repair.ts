import { Operation } from 'express-openapi';
import {
    RecordedMaintenanceError,
    repairRecorded,
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
        const result = await addManualRecordedMaintenance(
            recordedId,
            'repair',
            'manual',
            context =>
                repairRecorded(
                    recordedId,
                    stage => {
                        setRecordedMaintenanceStatus(
                            recordedId,
                            'repair',
                            'manual',
                            stage,
                        );
                    },
                    context.signal,
                ),
        );
        api.responseJSON(res, 200, result);
    } catch (err: any) {
        if (err instanceof RecordedMaintenanceError) {
            api.responseError(res, { code: err.statusCode, message: err.message });
            return;
        }
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画TS修復',
    tags: ['recorded'],
    description: 'TSを検査し、破損している場合だけTS Repairを実行する',
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: { description: 'TS検査または修復が完了しました' },
        404: { description: '録画がありません' },
        409: { description: '修復可能なTSがありません' },
        default: { description: '予期しないエラー' },
    },
};

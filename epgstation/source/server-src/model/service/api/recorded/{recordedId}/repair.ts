import { Operation } from 'express-openapi';
import IRecordedDB from '../../../../db/IRecordedDB';
import container from '../../../../ModelContainer';
import ITsRepairManageModel from '../../../../operator/tsRepair/ITsRepairManageModel';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const recordedId = parseInt(req.params.recordedId, 10);

    if (Number.isNaN(recordedId)) {
        api.responseError(res, { code: 400, message: 'invalid recorded id' });
        return;
    }

    const recordedDB = container.get<IRecordedDB>('IRecordedDB');
    const tsRepairManage = container.get<ITsRepairManageModel>('ITsRepairManageModel');

    try {
        const recorded = await recordedDB.findId(recordedId);
        if (recorded === null) {
            api.responseError(res, { code: 404, message: 'recorded is not found' });
            return;
        }

        const videoFiles = recorded.videoFiles || [];
        const repaired = videoFiles
            .filter(v => v.type === 'ts' && v.name === 'TS Repair')
            .sort((a, b) => b.id - a.id)[0];
        const original = videoFiles
            .filter(v => v.type === 'ts' && v.name !== 'TS Repair')
            .sort((a, b) => a.id - b.id)[0];

        if (typeof original === 'undefined' && typeof repaired === 'undefined') {
            api.responseError(res, {
                code: 409,
                message: 'repairable TS video file is not found',
            });
            return;
        }

        /*
         * If a repaired TS already exists, validate the newest repaired timeline first.
         * A healthy repaired TS means there is no reason to create another one.
         */
        const checkTarget = repaired || original;
        const healthy = await tsRepairManage.check(recorded, checkTarget.id);

        if (healthy === null) {
            api.responseError(res, {
                code: 500,
                message: 'TS health check could not be executed',
            });
            return;
        }

        if (healthy === true) {
            api.responseJSON(res, 200, {
                status: 'healthy',
                repaired: false,
                sourceVideoFileId: checkTarget.id,
            });
            return;
        }

        /* Prefer the original TS as repair source. Fall back to TS Repair only when original is gone. */
        const repairSource = original || repaired;
        const repairedVideoFileId = await tsRepairManage.repair(recorded, repairSource.id);

        if (repairedVideoFileId === null) {
            api.responseError(res, {
                code: 500,
                message: 'TS repair failed',
            });
            return;
        }

        api.responseJSON(res, 200, {
            status: 'repaired',
            repaired: true,
            sourceVideoFileId: repairSource.id,
            repairedVideoFileId,
        });
    } catch (err: any) {
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

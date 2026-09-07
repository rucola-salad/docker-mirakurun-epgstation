import { Operation } from 'express-openapi';
import IChannelDB from '../../../../db/IChannelDB';
import IRecordedDB from '../../../../db/IRecordedDB';
import container from '../../../../ModelContainer';
import IVideoUtil from '../../../../api/video/IVideoUtil';
import { requestCmAnalyzer } from '../../../CmAnalyzerProxy';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const recordedId = parseInt(req.params.recordedId, 10);

    if (Number.isNaN(recordedId)) {
        api.responseError(res, { code: 400, message: 'invalid recorded id' });
        return;
    }

    const recordedDB = container.get<IRecordedDB>('IRecordedDB');
    const channelDB = container.get<IChannelDB>('IChannelDB');
    const videoUtil = container.get<IVideoUtil>('IVideoUtil');

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
        const encoded = videoFiles
            .filter(v => v.type === 'encoded')
            .sort((a, b) => b.id - a.id)[0];

        /* Broken original TS is not selected when a TS Repair exists. */
        const source = repaired || original || encoded;
        if (typeof source === 'undefined') {
            api.responseError(res, {
                code: 409,
                message: 'analyzable video file is not found',
            });
            return;
        }

        const recPath = await videoUtil.getFullFilePathFromId(source.id);
        if (recPath === null) {
            api.responseError(res, {
                code: 404,
                message: 'source video file is not found',
            });
            return;
        }

        const channel = await channelDB.findId(recorded.channelId);
        const result = await requestCmAnalyzer(
            'analyze',
            'POST',
            {
                recordedId: recorded.id,
                recPath,
                channelName: channel === null ? '' : channel.name,
                title: recorded.name,
                sourceVideoFileId: source.id,
            },
        );

        if (result.statusCode !== 202) {
            api.responseError(res, {
                code: 502,
                message: 'CM analyzer rebuild request failed',
            });
            return;
        }

        api.responseJSON(res, 202, {
            status: 'accepted',
            sourceVideoFileId: source.id,
            sourceType: source.type,
            sourceName: source.name,
        });
    } catch (err: any) {
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

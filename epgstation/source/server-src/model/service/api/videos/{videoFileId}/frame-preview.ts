import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileId = Number(req.params.videoFileId);
    const frame = Number(req.query.frame);
    const frameRate = Number(req.query.frameRate);

    if (
        !Number.isInteger(videoFileId) ||
        videoFileId <= 0 ||
        !Number.isInteger(frame) ||
        frame < 0 ||
        !Number.isFinite(frameRate) ||
        frameRate <= 0
    ) {
        api.responseError(res, {
            code: 400,
            message: 'invalid frame preview parameter',
        });
        return;
    }

    try {
        const videoApiModel =
            container.get<IVideoApiModel>('IVideoApiModel');

        const image = await videoApiModel.getFramePreview(
            videoFileId,
            frame,
            frameRate,
        );

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', image.length);
        res.setHeader(
            'Cache-Control',
            'private, no-cache, no-store, must-revalidate',
        );

        res.status(200);
        res.end(image);
    } catch (err: any) {
        api.responseServerError(
            res,
            err.message || 'frame preview failed',
        );
    }
};

get.apiDoc = {
    summary: '手動チャプター編集用フレームプレビュー取得',
    tags: ['videos'],
    description:
        '指定した動画ファイルの手動チャプター編集用プレビュー画像を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            in: 'query',
            name: 'frame',
            required: true,
            schema: {
                type: 'integer',
                minimum: 0,
            },
        },
        {
            in: 'query',
            name: 'frameRate',
            required: true,
            schema: {
                type: 'number',
                minimum: 0,
            },
        },
    ],
    responses: {
        200: {
            description: 'フレームプレビューを取得しました',
            content: {
                'image/jpeg': {},
            },
        },
        400: {
            description: 'パラメータが不正です',
        },
        default: {
            description: '予期しないエラー',
        },
    },
};

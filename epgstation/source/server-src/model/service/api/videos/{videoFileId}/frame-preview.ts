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

    const controller = new AbortController();

    /*
     * チャプター編集で次のフレーム要求が来ると、
     * クライアント側は直前の fetch を AbortController で中断する。
     *
     * HTTP 切断を子 FFmpeg の AbortSignal へ伝播しない場合、
     * 古い frame-preview 用 FFmpeg がデコードを続けて積み上がるため、
     * request/response の切断時に対応する FFmpeg も停止する。
     */
    const abortFramePreview = (): void => {
        if (controller.signal.aborted === false) {
            controller.abort();
        }
    };

    req.once('aborted', abortFramePreview);

    const closeHandler = (): void => {
        if (res.writableEnded === false) {
            abortFramePreview();
        }
    };

    res.once('close', closeHandler);

    try {
        const videoApiModel =
            container.get<IVideoApiModel>('IVideoApiModel');

        const image = await videoApiModel.getFramePreview(
            videoFileId,
            frame,
            frameRate,
            controller.signal,
        );

        /*
         * FFmpeg 完了直前にクライアントが次フレームへ移動した場合は、
         * 切断済み response へ書き込まない。
         */
        if (controller.signal.aborted || res.writableEnded) {
            return;
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', image.length);
        res.setHeader(
            'Cache-Control',
            'private, no-cache, no-store, must-revalidate',
        );

        res.status(200);
        res.end(image);
    } catch (err: any) {
        /*
         * コマ送り/戻しで次の frame-preview が要求されたことによる
         * AbortError は正常系として扱う。
         */
        if (
            controller.signal.aborted ||
            err?.name === 'AbortError' ||
            err?.code === 'ABORT_ERR'
        ) {
            return;
        }

        api.responseServerError(
            res,
            err.message || 'frame preview failed',
        );
    } finally {
        req.removeListener('aborted', abortFramePreview);
        res.removeListener('close', closeHandler);
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

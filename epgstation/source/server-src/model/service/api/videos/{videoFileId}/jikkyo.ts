import { access } from 'fs/promises';
import { Operation } from 'express-openapi';
import * as path from 'path';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const fileInfo = await videoFileApiModel.getFullFilePath(parseInt(req.params.videoFileId, 10));

        if (fileInfo === null) {
            api.responseError(res, {
                code: 404,
                message: 'video file is not found',
            });
            return;
        }

        const ext = path.extname(fileInfo.path);
        const jikkyoPath =
            ext.length === 0 ? `${fileInfo.path}.xml` : `${fileInfo.path.substring(0, fileInfo.path.length - ext.length)}.xml`;

        try {
            await access(jikkyoPath);
        } catch {
            api.responseError(res, {
                code: 404,
                message: 'jikkyo file is not found',
            });
            return;
        }

        api.responseFile(req, res, jikkyoPath, 'application/xml', false);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画実況コメント',
    tags: ['videos'],
    description: 'ビデオファイルに対応する実況コメント XML を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '実況コメント XML を取得しました',
            content: {
                'application/xml': {},
            },
        },
        404: {
            description: '実況コメント XML が存在しません',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};

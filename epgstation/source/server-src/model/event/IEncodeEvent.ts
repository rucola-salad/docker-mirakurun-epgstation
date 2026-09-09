import * as apid from '../../../api';

export interface FinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    parentDirName: string; // 親ディレクトリ名
    filePath: string | null; // 親ディレクトリ以下のファイルパス
    fullOutputPath: string | null; // 出力したファイルのフルパス
    mode: string; // エンコードモード名
    removeOriginal: boolean; // ts を削除するか
    cmCut: boolean; // CMカットするか
    sourceCmState: apid.VideoFileCmState; // エンコード元のCM状態
    cmTimeline?: string; // CMカット時に実際に使用した最終timeline
}

export default interface IEncodeEvent {
    emitAddEncode(encodeId: apid.EncodeId): void;
    emitCancelEncode(encodeId: apid.EncodeId): void;
    emitFinishEncode(info: FinishEncodeInfo): void;
    emitErrorEncode(): void;
    emitUpdateEncodeProgress(): void;
    setAddEncode(callback: (encodeId: apid.EncodeId) => void): void;
    setCancelEncode(callback: (encodeId: apid.EncodeId) => void): void;
    setFinishEncode(callback: (info: FinishEncodeInfo) => void): void;
    setErrorEncode(callback: () => void): void;
    setUpdateEncodeProgress(callback: () => void): void;
}

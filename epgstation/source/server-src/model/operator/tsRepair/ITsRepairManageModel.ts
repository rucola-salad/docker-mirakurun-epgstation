import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';

export default interface ITsRepairManageModel {
    check(
        recorded: Recorded,
        sourceVideoFileId: apid.VideoFileId,
        signal?: AbortSignal,
    ): Promise<boolean | null>;
    repair(
        recorded: Recorded,
        sourceVideoFileId: apid.VideoFileId,
        signal?: AbortSignal,
    ): Promise<apid.VideoFileId | null>;
}

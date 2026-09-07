import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';

export default interface ITsRepairManageModel {
    repair(recorded: Recorded, sourceVideoFileId: apid.VideoFileId): Promise<apid.VideoFileId | null>;
}

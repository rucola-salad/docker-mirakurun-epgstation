import { inject, injectable } from 'inversify';
import * as socketIo from 'socket.io-client';
import Util from '../../util/Util';
import IServerConfigModel from '../serverConfig/IServerConfigModel';
import ISocketIOModel from './ISocketIOModel';

@injectable()
class SocketIOModel implements ISocketIOModel {
    private serverConfiModel: IServerConfigModel;
    private io: socketIo.Socket | null = null;

    constructor(@inject('IServerConfigModel') serverConfiModel: IServerConfigModel) {
        this.serverConfiModel = serverConfiModel;
    }

    public Iinitialize(): void {
        const config = this.serverConfiModel.getConfig();
        if (config === null || this.io !== null) {
            throw new Error('InitializationSocketIOError');
        }

        this.io = socketIo.io(`${location.protocol}//${location.hostname}:${config.socketIOPort}`, {
            path: `${Util.getSubDirectory()}/socket.io`,
        });
    }

    public getIO(): socketIo.Socket | null {
        return this.io;
    }

    public onUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.on(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    public offUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.off(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    public onUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.on(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    public offUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.off(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    public onUpdateRecordedMaintenance(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.on(SocketIOModel.UPDATE_RECORDED_MAINTENANCE_EVENT, callback);
    }

    public offUpdateRecordedMaintenance(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }
        this.io.off(SocketIOModel.UPDATE_RECORDED_MAINTENANCE_EVENT, callback);
    }
}

namespace SocketIOModel {
    export const UPDATE_STATUS_EVENT = 'updateStatus';
    export const UPDATE_ENCODE_STATUS_EVENT = 'updateEncode';
    export const UPDATE_RECORDED_MAINTENANCE_EVENT = 'updateRecordedMaintenance';
}

export default SocketIOModel;

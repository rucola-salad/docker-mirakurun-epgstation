<template>
    <div v-if="isAvailable === true && enabled === true" class="jikkyo-overlay" aria-hidden="true">
        <div
            v-for="comment in comments"
            :key="comment.id"
            class="jikkyo-comment"
            v-bind:class="comment.position"
            v-bind:style="comment.style"
        >
            {{ comment.text }}
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IChannelModel, { Channel } from '@/model/channels/IChannelModel';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

type CommentPosition = 'naka' | 'ue' | 'shita';

interface OverlayComment {
    id: number;
    text: string;
    position: CommentPosition;
    style: { [key: string]: string | number };
}

interface NicoChat {
    content?: string;
    mail?: string;
}

interface RoomData {
    messageServer?: {
        uri?: string;
    };
    threadId?: string;
    yourPostKey?: string;
}

@Component({})
export default class JikkyoOverlay extends Vue {
    @Prop({ required: true })
    public channelId!: apid.ChannelId;

    @Prop({ required: true })
    public enabled!: boolean;

    public comments: OverlayComment[] = [];
    public isAvailable: boolean = false;

    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private watchSocket: WebSocket | null = null;
    private commentSocket: WebSocket | null = null;
    private keepSeatTimer: number | null = null;
    private reconnectTimer: number | null = null;
    private commentSequence: number = 0;
    private laneSequence: number = 0;
    private isDestroyed: boolean = false;
    private currentJikkyoId: string | null = null;

    public mounted(): void {
        this.start();
    }

    public beforeDestroy(): void {
        this.isDestroyed = true;
        this.disconnect();
    }

    @Watch('channelId')
    public onChannelChanged(): void {
        this.start();
    }

    @Watch('enabled')
    public onEnabledChanged(enabled: boolean): void {
        if (enabled === true) {
            this.connect();
        } else {
            this.disconnect();
            this.comments = [];
        }
    }

    private start(): void {
        this.disconnect();
        this.comments = [];

        const channel = this.channelModel.findChannel(this.channelId, false);
        this.currentJikkyoId = channel === null ? null : this.getJikkyoId(channel);
        this.isAvailable = this.currentJikkyoId !== null;
        this.$emit('availability', this.isAvailable);

        if (this.enabled === true && this.isAvailable === true) {
            this.connect();
        }
    }

    private getJikkyoId(channel: Channel): string | null {
        if (channel.channelType === 'GR') {
            const map: { [key: number]: string } = {
                1: 'jk1',
                2: 'jk2',
                3: 'jk12',
                4: 'jk4',
                5: 'jk5',
                6: 'jk6',
                7: 'jk7',
                8: 'jk8',
                9: 'jk9',
            };
            return map[channel.remoteControlKeyId] || null;
        }

        if (channel.channelType === 'BS') {
            const map: { [key: number]: string } = {
                101: 'jk101',
                141: 'jk141',
                151: 'jk151',
                161: 'jk161',
                171: 'jk171',
                181: 'jk181',
                191: 'jk191',
                192: 'jk192',
                193: 'jk193',
                200: 'jk200',
                201: 'jk201',
                211: 'jk211',
                222: 'jk222',
                236: 'jk236',
                252: 'jk252',
                265: 'jk265',
            };
            return map[channel.serviceId] || null;
        }

        if (channel.channelType === 'CS') {
            const map: { [key: number]: string } = {
                333: 'jk333',
            };
            return map[channel.serviceId] || null;
        }

        return null;
    }

    private connect(): void {
        if (this.isDestroyed === true || this.enabled === false || this.currentJikkyoId === null || this.watchSocket !== null) {
            return;
        }

        const jikkyoId = this.currentJikkyoId;
        const socket = new WebSocket(`wss://nx-jikkyo.tsukumijima.net/api/v1/channels/${jikkyoId}/ws/watch`);
        this.watchSocket = socket;

        socket.onopen = (): void => {
            if (this.watchSocket !== socket) {
                return;
            }
            socket.send(
                JSON.stringify({
                    type: 'startWatching',
                    data: {
                        stream: {
                            quality: 'abr',
                            protocol: 'hls',
                            latency: 'low',
                            chasePlay: false,
                        },
                        room: {
                            protocol: 'webSocket',
                            commentable: false,
                        },
                        reconnect: false,
                    },
                }),
            );
        };

        socket.onmessage = (event: MessageEvent): void => {
            this.handleWatchMessage(socket, event.data);
        };

        socket.onerror = (): void => {
            // onclose で再接続する
        };

        socket.onclose = (): void => {
            if (this.watchSocket === socket) {
                this.watchSocket = null;
            }
            this.stopKeepSeat();
            this.closeCommentSocket();
            this.scheduleReconnect();
        };
    }

    private handleWatchMessage(socket: WebSocket, rawData: any): void {
        if (this.watchSocket !== socket || typeof rawData !== 'string') {
            return;
        }

        let message: any;
        try {
            message = JSON.parse(rawData);
        } catch (err) {
            return;
        }

        if (message.type === 'ping') {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'pong' }));
            }
            return;
        }

        if (message.type === 'seat') {
            const interval = Number(message.data && message.data.keepIntervalSec);
            this.startKeepSeat(isNaN(interval) || interval <= 0 ? 30 : interval);
            return;
        }

        if (message.type === 'room') {
            this.connectCommentSocket(message.data as RoomData);
        }
    }

    private startKeepSeat(intervalSec: number): void {
        this.stopKeepSeat();
        this.keepSeatTimer = window.setInterval(() => {
            if (this.watchSocket !== null && this.watchSocket.readyState === WebSocket.OPEN) {
                this.watchSocket.send(JSON.stringify({ type: 'keepSeat' }));
            }
        }, Math.max(10, intervalSec) * 1000);
    }

    private stopKeepSeat(): void {
        if (this.keepSeatTimer !== null) {
            window.clearInterval(this.keepSeatTimer);
            this.keepSeatTimer = null;
        }
    }

    private connectCommentSocket(room: RoomData): void {
        const uri = room.messageServer && room.messageServer.uri;
        const threadId = room.threadId;
        const threadKey = room.yourPostKey || '';

        if (typeof uri !== 'string' || typeof threadId !== 'string') {
            return;
        }

        this.closeCommentSocket();
        const socket = new WebSocket(uri);
        this.commentSocket = socket;

        socket.onopen = (): void => {
            if (this.commentSocket !== socket) {
                return;
            }

            socket.send(
                JSON.stringify([
                    { ping: { content: 'rs:0' } },
                    { ping: { content: 'ps:0' } },
                    {
                        thread: {
                            version: '20061206',
                            thread: threadId,
                            threadkey: threadKey,
                            user_id: '',
                            res_from: -10,
                        },
                    },
                    { ping: { content: 'pf:0' } },
                    { ping: { content: 'rf:0' } },
                ]),
            );
        };

        socket.onmessage = (event: MessageEvent): void => {
            this.handleCommentMessage(event.data);
        };

        socket.onerror = (): void => {
            // 視聴セッション側の切断時に再接続する
        };

        socket.onclose = (): void => {
            if (this.commentSocket === socket) {
                this.commentSocket = null;
            }
        };
    }

    private handleCommentMessage(rawData: any): void {
        if (typeof rawData !== 'string') {
            return;
        }

        let message: any;
        try {
            message = JSON.parse(rawData);
        } catch (err) {
            return;
        }

        if (Array.isArray(message)) {
            for (const item of message) {
                this.handleCommentObject(item);
            }
        } else {
            this.handleCommentObject(message);
        }
    }

    private handleCommentObject(message: any): void {
        if (message === null || typeof message !== 'object' || typeof message.chat !== 'object') {
            return;
        }

        const chat = message.chat as NicoChat;
        if (typeof chat.content !== 'string' || chat.content.length === 0) {
            return;
        }

        this.addComment(chat.content, typeof chat.mail === 'string' ? chat.mail : '');
    }

    private addComment(text: string, mail: string): void {
        const commands = mail.toLowerCase().split(/\s+/);
        const position: CommentPosition = commands.indexOf('ue') !== -1 ? 'ue' : commands.indexOf('shita') !== -1 ? 'shita' : 'naka';
        const fontSize = commands.indexOf('big') !== -1 ? 36 : commands.indexOf('small') !== -1 ? 22 : 30;
        const color = this.getCommentColor(commands);
        const id = ++this.commentSequence;
        const lifetime = position === 'naka' ? 8000 : 4000;
        const lane = this.laneSequence++ % 11;

        const style: { [key: string]: string | number } = {
            color: color,
            fontSize: `${fontSize}px`,
        };

        if (position === 'naka') {
            style.top = `${4 + lane * 8}%`;
            style.animationDuration = `${lifetime / 1000}s`;
        } else if (position === 'ue') {
            style.top = `${3 + (lane % 5) * 8}%`;
        } else {
            style.bottom = `${5 + (lane % 5) * 8}%`;
        }

        this.comments.push({
            id: id,
            text: text,
            position: position,
            style: style,
        });

        // DOM の肥大化を防ぐ
        if (this.comments.length > 120) {
            this.comments.splice(0, this.comments.length - 120);
        }

        window.setTimeout(() => {
            this.comments = this.comments.filter(comment => comment.id !== id);
        }, lifetime + 300);
    }

    private getCommentColor(commands: string[]): string {
        const colors: { [key: string]: string } = {
            white: '#ffffff',
            red: '#ff0000',
            pink: '#ff8080',
            orange: '#ffc000',
            yellow: '#ffff00',
            green: '#00ff00',
            cyan: '#00ffff',
            blue: '#0000ff',
            purple: '#c000ff',
            black: '#000000',
        };

        for (const command of commands) {
            if (typeof colors[command] !== 'undefined') {
                return colors[command];
            }
            if (/^#[0-9a-f]{6}$/i.test(command)) {
                return command;
            }
        }
        return '#ffffff';
    }

    private scheduleReconnect(): void {
        if (this.isDestroyed === true || this.enabled === false || this.currentJikkyoId === null || this.reconnectTimer !== null) {
            return;
        }

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
    }

    private disconnect(): void {
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopKeepSeat();
        this.closeCommentSocket();

        if (this.watchSocket !== null) {
            const socket = this.watchSocket;
            this.watchSocket = null;
            socket.onclose = null;
            socket.close();
        }
    }

    private closeCommentSocket(): void {
        if (this.commentSocket !== null) {
            const socket = this.commentSocket;
            this.commentSocket = null;
            socket.onclose = null;
            socket.close();
        }
    }
}
</script>

<style lang="sass" scoped>
.jikkyo-overlay
    z-index: 2
    position: absolute
    top: 0
    right: 0
    bottom: 0
    left: 0
    overflow: hidden
    pointer-events: none
    user-select: none

.jikkyo-comment
    position: absolute
    white-space: nowrap
    max-width: none
    font-weight: 700
    line-height: 1.15
    text-shadow: -2px -2px 1px #000, 2px -2px 1px #000, -2px 2px 1px #000, 2px 2px 1px #000
    will-change: transform

    &.naka
        left: 100%
        animation-name: jikkyo-scroll
        animation-timing-function: linear
        animation-fill-mode: forwards

    &.ue, &.shita
        left: 50%
        transform: translateX(-50%)
        text-align: center

@keyframes jikkyo-scroll
    from
        transform: translateX(0)
    to
        transform: translateX(calc(-100vw - 100%))

@media screen and (max-width: 600px)
    .jikkyo-comment
        font-size: 20px !important
</style>

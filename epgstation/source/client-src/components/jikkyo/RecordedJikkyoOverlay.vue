<template>
    <div v-if="isAvailable === true && enabled === true" class="jikkyo-overlay" v-bind:class="{ paused: paused }" aria-hidden="true">
        <div
            v-for="comment in comments"
            :key="comment.id"
            class="jikkyo-comment"
            v-bind:class="comment.position"
            v-bind:style="comment.style"
            v-on:animationend="removeComment(comment.id)"
        >
            {{ comment.text }}
        </div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

type CommentPosition = 'naka' | 'ue' | 'shita';

interface RecordedChat {
    vpos: number;
    text: string;
    mail: string;
}

interface OverlayComment {
    id: number;
    text: string;
    position: CommentPosition;
    style: { [key: string]: string | number };
}

@Component({})
export default class RecordedJikkyoOverlay extends Vue {
    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    @Prop({ required: true })
    public currentTime!: number;

    @Prop({ required: true })
    public enabled!: boolean;

    @Prop({ required: true })
    public paused!: boolean;

    @Prop({ required: true })
    public seeking!: boolean;

    @Prop({ required: true })
    public playbackRate!: number;

    public comments: OverlayComment[] = [];
    public isAvailable: boolean = false;

    private chats: RecordedChat[] = [];
    private nextChatIndex: number = 0;
    private lastTime: number = 0;
    private commentSequence: number = 0;
    private laneSequence: number = 0;
    private loadSequence: number = 0;

    public mounted(): void {
        this.load();
    }

    @Watch('videoFileId')
    public onVideoFileIdChanged(): void {
        this.load();
    }

    @Watch('enabled')
    public onEnabledChanged(enabled: boolean): void {
        this.comments = [];
        this.syncPosition(this.currentTime);
        if (enabled === true) {
            this.lastTime = this.currentTime;
        }
    }

    @Watch('playbackRate')
    public onPlaybackRateChanged(): void {
        this.$nextTick(() => {
            this.syncAnimationPlaybackRate();
        });
    }

    @Watch('currentTime')
    public onCurrentTimeChanged(currentTime: number): void {
        if (this.seeking === true) {
            return;
        }

        if (this.isAvailable === false || this.enabled === false || !isFinite(currentTime)) {
            this.lastTime = currentTime;
            return;
        }

        const delta = currentTime - this.lastTime;
        if (delta < -0.25) {
            this.syncPosition(currentTime);
            this.lastTime = currentTime;
            return;
        }

        while (this.nextChatIndex < this.chats.length && this.chats[this.nextChatIndex].vpos / 100 <= currentTime) {
            const chat = this.chats[this.nextChatIndex++];
            if (chat.vpos / 100 > this.lastTime - 0.05) {
                this.addComment(chat.text, chat.mail);
            }
        }
        this.lastTime = currentTime;
    }

    public seek(currentTime: number): void {
        this.comments = [];
        this.syncPosition(currentTime);
        this.lastTime = currentTime;
    }

    private async load(): Promise<void> {
        const sequence = ++this.loadSequence;
        this.comments = [];
        this.chats = [];
        this.nextChatIndex = 0;
        this.isAvailable = false;
        this.$emit('availability', false);

        try {
            const response = await fetch(`./api/videos/${this.videoFileId}/jikkyo`, { credentials: 'same-origin' });
            if (sequence !== this.loadSequence) {
                return;
            }
            if (response.status === 404) {
                return;
            }
            if (response.ok === false) {
                throw new Error(`JikkyoHttpError:${response.status}`);
            }

            const xmlText = await response.text();
            if (sequence !== this.loadSequence) {
                return;
            }
            const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
            if (xml.getElementsByTagName('parsererror').length > 0) {
                throw new Error('JikkyoXmlParseError');
            }

            const chats: RecordedChat[] = [];
            const nodes = xml.getElementsByTagName('chat');
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes.item(i);
                if (node === null) {
                    continue;
                }
                const vpos = Number(node.getAttribute('vpos'));
                const text = node.textContent || '';
                if (isNaN(vpos) || text.length === 0) {
                    continue;
                }
                chats.push({
                    vpos: vpos,
                    text: text,
                    mail: node.getAttribute('mail') || '',
                });
            }
            chats.sort((a, b) => a.vpos - b.vpos);
            this.chats = chats;
            const available = chats.length > 0;
            this.isAvailable = available;
            this.$emit('availability', available);
            this.syncPosition(this.currentTime);
            this.lastTime = this.currentTime;
        } catch (err) {
            console.error(err);
            if (sequence === this.loadSequence) {
                this.isAvailable = false;
                this.$emit('availability', false);
            }
        }
    }

    private syncPosition(currentTime: number): void {
        const targetVpos = Math.max(0, currentTime * 100);
        let low = 0;
        let high = this.chats.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (this.chats[mid].vpos <= targetVpos) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        this.nextChatIndex = low;
    }

    private addComment(text: string, mail: string): void {
        const commands = mail.toLowerCase().split(/\s+/);
        const position: CommentPosition = commands.indexOf('ue') !== -1 ? 'ue' : commands.indexOf('shita') !== -1 ? 'shita' : 'naka';
        const fontSize = commands.indexOf('big') !== -1 ? 36 : commands.indexOf('small') !== -1 ? 22 : 30;
        const color = this.getCommentColor(commands);
        const id = ++this.commentSequence;
        const lifetime = position === 'naka' ? 8000 : 4000;
        const laneCount = position === 'naka' ? 22 : 11;
        const lane = this.laneSequence++ % laneCount;
        const style: { [key: string]: string | number } = { color: color, fontSize: `${fontSize}px` };

        if (position === 'naka') {
            style.top = `${3 + lane * 4.2}%`;
            style.animationDuration = `${lifetime / 1000}s`;
        } else if (position === 'ue') {
            style.top = `${3 + (lane % 5) * 8}%`;
            style.animationDuration = `${lifetime / 1000}s`;
        } else {
            style.bottom = `${5 + (lane % 5) * 8}%`;
            style.animationDuration = `${lifetime / 1000}s`;
        }

        this.comments.push({ id: id, text: text, position: position, style: style });
        if (this.comments.length > 120) {
            this.comments.splice(0, this.comments.length - 120);
        }
        this.$nextTick(() => {
            this.syncAnimationPlaybackRate();
        });
    }

    public removeComment(id: number): void {
        this.comments = this.comments.filter(comment => comment.id !== id);
    }

    private syncAnimationPlaybackRate(): void {
        const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
        const elements = this.$el.querySelectorAll('.jikkyo-comment');

        elements.forEach(element => {
            const animations = (element as any).getAnimations();
            animations.forEach((animation: Animation) => {
                animation.playbackRate = rate;
            });
        });
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
}
</script>

<style lang="sass" scoped>
.jikkyo-overlay
    z-index: 4
    position: absolute
    top: 0
    right: 0
    bottom: 0
    left: 0
    overflow: hidden
    pointer-events: none
    user-select: none

    &.paused
        .jikkyo-comment
            animation-play-state: paused !important

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
        animation-name: jikkyo-fixed
        animation-timing-function: linear
        animation-fill-mode: forwards

@keyframes jikkyo-fixed
    from
        opacity: 1
    to
        opacity: 1

@keyframes jikkyo-scroll
    from
        transform: translateX(0)
    to
        transform: translateX(calc(-100vw - 100%))

@media screen and (max-width: 600px)
    .jikkyo-comment
        font-size: 20px !important
</style>

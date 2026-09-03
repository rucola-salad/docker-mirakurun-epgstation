<template>
    <div v-if="displayInfo !== null" class="watch-recorded-info-card pa-2">
        <v-card class="mx-auto" max-width="800">
            <v-list-item three-line style="cursor: pointer">
                <v-list-item-content>
                    <div class="subtitle-1 font-weight-black">{{ displayInfo.channelName }}</div>
                    <div class="caption font-weight-light">{{ displayInfo.time }}</div>
                    <div class="subtitle-2">
                        {{ displayInfo.name }}
                    </div>
                    <div class="body-2 font-weight-light">{{ displayInfo.description }}</div>

                    <div v-if="mediaInfo !== null" class="media-info mt-3">
                        <div class="caption font-weight-bold">再生ファイル情報</div>

                        <div v-if="mediaInfo.video !== null" class="caption">
                            映像:
                            {{ formatCodec(mediaInfo.video.codec) }}
                            <template v-if="mediaInfo.video.width !== null && mediaInfo.video.height !== null">
                                ・ {{ mediaInfo.video.width }}×{{ mediaInfo.video.height }}
                            </template>
                            <template v-if="mediaInfo.video.fps !== null">・ {{ formatFps(mediaInfo.video.fps) }} fps</template>
                            <template v-if="mediaInfo.video.bitrate !== null">・ {{ formatBitrate(mediaInfo.video.bitrate) }}</template>
                        </div>

                        <div v-if="mediaInfo.audio !== null" class="caption">
                            音声:
                            {{ formatCodec(mediaInfo.audio.codec) }}
                            <template v-if="mediaInfo.audio.channels !== null">・ {{ mediaInfo.audio.channels }}ch</template>
                            <template v-if="mediaInfo.audio.sampleRate !== null">・ {{ formatSampleRate(mediaInfo.audio.sampleRate) }}</template>
                            <template v-if="mediaInfo.audio.bitrate !== null">・ {{ formatBitrate(mediaInfo.audio.bitrate) }}</template>
                        </div>

                        <div v-if="mediaInfo.format !== null" class="caption">コンテナ: {{ mediaInfo.format }}</div>
                    </div>
                </v-list-item-content>
            </v-list-item>
        </v-card>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from '@/model/state/recorded/watch/IWatchRecordedInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class WatchOnRecordedInfoCard extends Vue {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    public displayInfo: DsiplayWatchInfo | null = null;
    public mediaInfo: apid.VideoMediaInfo | null = null;

    private infoState: IWatchRecordedInfoState = container.get<IWatchRecordedInfoState>('IWatchRecordedInfoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.update();
    }).bind(this);

    public created(): void {
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.infoState.clear();
        this.displayInfo = null;
        this.mediaInfo = null;

        this.$nextTick(async () => {
            await this.update();
        });
    }

    private async update(): Promise<void> {
        await this.infoState.update(this.recordedId).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: '番組情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();

        try {
            this.mediaInfo = await this.videoApiModel.getMediaInfo(this.videoFileId);
        } catch (err) {
            this.mediaInfo = null;
            console.error('media info fetch failed', err);
        }
    }

    public formatCodec(codec: string | null): string {
        if (codec === null) {
            return '-';
        }

        switch (codec.toLowerCase()) {
            case 'h264':
                return 'H.264';
            case 'hevc':
                return 'H.265/HEVC';
            case 'aac':
                return 'AAC';
            case 'mpeg2video':
                return 'MPEG-2';
            default:
                return codec.toUpperCase();
        }
    }

    public formatFps(fps: number): string {
        return fps.toFixed(2).replace(/\.00$/, '');
    }

    public formatBitrate(bitrate: number): string {
        if (bitrate >= 1000000) {
            return `${(bitrate / 1000000).toFixed(2)} Mbps`;
        }

        return `${Math.round(bitrate / 1000)} kbps`;
    }

    public formatSampleRate(sampleRate: number): string {
        return `${sampleRate / 1000} kHz`;
    }
}
</script>

<style lang="sass" scoped>
.media-info
    border-top: 1px solid rgba(128, 128, 128, 0.3)
    padding-top: 8px
    line-height: 1.7
</style>

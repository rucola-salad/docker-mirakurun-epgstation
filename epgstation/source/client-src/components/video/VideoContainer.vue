<template>
    <div class="video-container" ref="container">
        <div class="video-content" v-bind:class="{ 'is-ipad': isiPad === true }">
            <div v-if="isLoading === true" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div
                ref="videoControlWrap"
                class="video-control-wrap overflow-hidden"
                v-bind:class="{ 'hide-cursor': isHideCursor }"
                v-on:click="toggleControl"
                v-on:mousemove="mousemove"
                v-on:mouseleave="mouseleave"
            >
                <transition name="fade">
                    <div v-if="isShowControl === true">
                        <div v-if="isLive === false" class="d-flex center-buttons" v-on:click="stopPropagation">
                            <v-btn v-if="hasCmAnalysis" class="add-shadow mx-4" icon dark aria-label="前のチャプター" v-on:click="seekPreviousChapter">
                                <v-icon dark>mdi-skip-previous</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="rewindTime(30)">
                                <v-icon dark>mdi-rewind-30</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="rewindTime(10)">
                                <v-icon dark>mdi-rewind-10</v-icon>
                            </v-btn>
                            <v-btn class="play-button add-shadow mx-4" icon dark v-on:click="togglePlay">
                                <v-icon v-if="isPause === true" dark>mdi-play</v-icon>
                                <v-icon v-else dark>mdi-pause</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="forwardTime(10)">
                                <v-icon dark>mdi-fast-forward-10</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="forwardTime(30)">
                                <v-icon dark>mdi-fast-forward-30</v-icon>
                            </v-btn>
                            <v-btn v-if="hasCmAnalysis" class="add-shadow mx-4" icon dark aria-label="次のチャプター" v-on:click="seekNextChapter">
                                <v-icon dark>mdi-skip-next</v-icon>
                            </v-btn>
                        </div>
                        <v-btn v-if="isEnabledRotation === true && isFullscreen === true" class="rotation-button" icon dark v-on:click="clickRotationButton">
                            <v-icon dark>mdi-screen-rotation</v-icon>
                        </v-btn>
                        <div v-if="duration > 0 && isLive === false" class="d-flex flex-column align-center left-buttons" v-on:click="stopPropagation">
                            <v-btn class="add-shadow" icon dark v-on:click="speedUp">
                                <v-icon dark>mdi-plus-circle</v-icon>
                            </v-btn>
                            <v-btn class="add-shadow my-2" text dark v-on:click="resetSpeed">x{{ playbackRate.toFixed(1) }}</v-btn>
                            <v-btn class="add-shadow" icon dark v-on:click="speedDown">
                                <v-icon dark>mdi-minus-circle</v-icon>
                            </v-btn>
                        </div>
                        <div class="video-control">
                            <div class="content" v-on:click="stopPropagation">
                                <div v-if="isLive === false" class="seekbar-wrap">
                                    <v-slider
                                        class="slider"
                                        v-model="currentTime"
                                        :max="duration"
                                        color="white"
                                        track-color="grey"
                                        :disabled="duration === 0"
                                        v-on:start="startChangeCurrentPosition"
                                        v-on:change="endChangeCurrentPosition"
                                        v-on:input="updateCurrentPosition"
                                    ></v-slider>
                                    <div
                                        v-if="duration > 0 && (hasCmAnalysis || hasCmRanges || seekbarPlaybackBoundaryRanges.length > 0 || seekbarEditPins.length > 0)"
                                        class="seekbar-analysis"
                                        aria-hidden="true"
                                    >
                                        <span
                                            v-for="range in seekbarPlaybackBoundaryRanges"
                                            :key="'boundary-' + range.key"
                                            class="seekbar-playback-boundary-range"
                                            :style="{
                                                left: range.left + '%',
                                                width: range.width + '%',
                                            }"
                                        ></span>
                                        <span
                                            v-for="range in seekbarCmRanges"
                                            :key="'cm-' + range.key"
                                            class="seekbar-cm-range"
                                            :style="{
                                                left: range.left + '%',
                                                width: range.width + '%',
                                            }"
                                        ></span>
                                        <span
                                            v-for="marker in seekbarChapterMarkers"
                                            :key="'chapter-' + marker.key"
                                            class="seekbar-chapter-marker"
                                            :style="{ left: marker.left + '%' }"
                                        ></span>
                                        <span
                                            v-for="marker in seekbarEditPins"
                                            :key="'edit-' + marker.key"
                                            class="seekbar-edit-pin"
                                            v-bind:class="{ selected: marker.selected }"
                                            :style="{ left: marker.left + '%' }"
                                        ></span>
                                    </div>
                                </div>
                                <div class="d-flex align-center overflow-hidden mx-2">
                                    <v-btn v-if="isLive === true" class="play" icon dark aria-label="ライブを再読込" v-on:click="reloadLiveVideo">
                                        <v-icon>mdi-refresh</v-icon>
                                    </v-btn>
                                    <v-btn v-else class="play" icon dark v-on:click="togglePlay">
                                        <v-icon v-if="isPause === true">mdi-play</v-icon>
                                        <v-icon v-else>mdi-pause</v-icon>
                                    </v-btn>
                                    <div class="d-flex align-center volume-content">
                                        <v-btn icon dark v-on:click="switchMute">
                                            <v-icon v-if="volume > 0.4">mdi-volume-high</v-icon>
                                            <v-icon v-else-if="volume > 0.0">mdi-volume-medium</v-icon>
                                            <v-icon v-else>mdi-volume-off</v-icon>
                                        </v-btn>
                                        <v-slider
                                            class="slider"
                                            v-if="isHideAudioVolume === false"
                                            v-model="volume"
                                            min="0.0"
                                            max="1.0"
                                            step="0.1"
                                            color="white"
                                            track-color="grey"
                                            v-on:input="changeVolume"
                                            v-on:change="updateLastSeekTime"
                                        ></v-slider>
                                    </div>
                                    <div v-if="isLive === false" class="time Caption mx-2">
                                        <span>{{ currentTimeStr }}</span>
                                        <span class="mx-1">/</span>
                                        <span>{{ durationStr }}</span>
                                    </div>
                                    <div v-if="hasCmRanges" class="time Caption mx-2">
                                        <span>{{ cmStatusText }}</span>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-btn
                                        v-if="hasCmRanges"
                                        icon
                                        dark
                                        class="cm-skip-icon"
                                        v-bind:class="{ disabled: isCmSkipEnabled === false || chapterEditEnabled === true }"
                                        v-bind:disabled="chapterEditEnabled === true"
                                        aria-label="CM自動スキップ"
                                        :aria-pressed="isCmSkipEnabled && chapterEditEnabled === false ? 'true' : 'false'"
                                        :title="chapterEditEnabled === true ? 'CM自動スキップ: チャプター編集中はOFF' : (isCmSkipEnabled ? 'CM自動スキップ: ON' : 'CM自動スキップ: OFF')"
                                        v-on:click="switchCmSkip"
                                    >
                                        <v-icon>mdi-fast-forward-outline</v-icon>
                                    </v-btn>
                                    <v-btn
                                        v-if="isEnabledSubtitles === true"
                                        icon
                                        dark
                                        class="subtitle-icon"
                                        v-bind:class="{ disabled: isShowingSubtitle === false }"
                                        v-on:click="switchSubtitle"
                                    >
                                        <v-icon>mdi-subtitles</v-icon>
                                    </v-btn>
                                    <v-btn
                                        v-if="isJikkyoAvailable === true"
                                        icon
                                        dark
                                        class="jikkyo-icon"
                                        v-bind:class="{ disabled: isJikkyoEnabled === false || chapterEditEnabled === true }"
                                        v-bind:disabled="chapterEditEnabled === true"
                                        v-on:click="switchJikkyo"
                                    >
                                        <v-icon>mdi-comment-text-outline</v-icon>
                                    </v-btn>
                                    <v-btn v-if="this.isEnabledPip === true" icon dark v-on:click="switchPip">
                                        <v-icon>mdi-picture-in-picture-bottom-right</v-icon>
                                    </v-btn>
                                    <v-btn icon dark v-on:click="switchFullScreen">
                                        <v-icon v-if="isFullscreen === false">mdi-fullscreen</v-icon>
                                        <v-icon v-else>mdi-fullscreen-exit</v-icon>
                                    </v-btn>
                                </div>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>
            <JikkyoOverlay
                v-if="typeof jikkyoChannelId !== 'undefined'"
                ref="jikkyo"
                v-bind:channelId="jikkyoChannelId"
                v-bind:enabled="isJikkyoEnabled && chapterEditEnabled === false"
                v-on:availability="onJikkyoAvailability"
            ></JikkyoOverlay>
            <RecordedJikkyoOverlay
                v-if="typeof recordedJikkyoVideoFileId !== 'undefined'"
                ref="recordedJikkyo"
                v-bind:videoFileId="recordedJikkyoVideoFileId"
                v-bind:currentTime="currentTime"
                v-bind:enabled="isJikkyoEnabled && chapterEditEnabled === false"
                v-bind:seeking="isChangingCurrentPosition"
                v-bind:paused="isPause"
                v-bind:playbackRate="playbackRate"
                v-on:availability="onJikkyoAvailability"
            ></RecordedJikkyoOverlay>
            <div class="video-wrap">
                <NormalVideo
                    v-if="videoParam.type == 'Normal'"
                    v-bind:key="liveVideoReloadKey"
                    ref="video"
                    v-bind:videoSrc.sync="videoParam.src"
                    v-on:timeupdate="onTimeupdate"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:ended="onEnded"
                    v-on:play="onPlay"
                    v-on:pause="onPause"
                    v-on:ratechange="onChangePlaybackRate"
                    v-on:volumechange="onVolumechange"
                ></NormalVideo>
                <LiveHLSVideo
                    v-if="videoParam.type == 'LiveHLS'"
                    v-bind:key="liveVideoReloadKey"
                    ref="video"
                    v-bind:channelId="videoParam.channelId"
                    v-bind:mode="videoParam.mode"
                    v-on:timeupdate="onTimeupdate"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:ended="onEnded"
                    v-on:play="onPlay"
                    v-on:pause="onPause"
                    v-on:ratechange="onChangePlaybackRate"
                    v-on:volumechange="onVolumechange"
                ></LiveHLSVideo>
                <RecordedStreamingVideo
                    v-if="videoParam.type == 'RecordedStreaming'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:streamingType="videoParam.streamingType"
                    v-bind:mode="videoParam.mode"
                    v-on:timeupdate="onTimeupdate"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:ended="onEnded"
                    v-on:play="onPlay"
                    v-on:pause="onPause"
                    v-on:ratechange="onChangePlaybackRate"
                    v-on:volumechange="onVolumechange"
                ></RecordedStreamingVideo>
                <RecordedHLSStreamingVideo
                    v-if="videoParam.type == 'RecordedHLS'"
                    ref="video"
                    v-bind:recordedId="videoParam.recordedId"
                    v-bind:videoFileId="videoParam.videoFileId"
                    v-bind:mode="videoParam.mode"
                    v-on:timeupdate="onTimeupdate"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:ended="onEnded"
                    v-on:play="onPlay"
                    v-on:pause="onPause"
                    v-on:ratechange="onChangePlaybackRate"
                    v-on:volumechange="onVolumechange"
                ></RecordedHLSStreamingVideo>
                <LiveMpegTsVideo
                    v-if="videoParam.type == 'LiveMpegTs'"
                    ref="video"
                    v-bind:videoSrc.sync="videoParam.src"
                    v-on:timeupdate="onTimeupdate"
                    v-on:waiting="onWaiting"
                    v-on:loadeddata="onLoadeddata"
                    v-on:canplay="onCanplay"
                    v-on:ended="onEnded"
                    v-on:play="onPlay"
                    v-on:pause="onPause"
                    v-on:ratechange="onChangePlaybackRate"
                    v-on:volumechange="onVolumechange"
                ></LiveMpegTsVideo>
                <img v-if="chapterEditFramePreviewUrl !== null" class="chapter-edit-frame-preview" v-bind:src="chapterEditFramePreviewUrl" alt="" aria-hidden="true" />
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import JikkyoOverlay from '@/components/jikkyo/JikkyoOverlay.vue';
import RecordedJikkyoOverlay from '@/components/jikkyo/RecordedJikkyoOverlay.vue';
import BaseVideo from '@/components/video/BaseVideo';
import LiveHLSVideo from '@/components/video/LiveHLSVideo.vue';
import NormalVideo from '@/components/video/NormalVideo.vue';
import RecordedHLSStreamingVideo from '@/components/video/RecordedHLSStreamingVideo.vue';
import RecordedStreamingVideo from '@/components/video/RecordedStreamingVideo.vue';
import LiveMpegTsVideo from '@/components/video/LiveMpegTsVideo.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import ICmAnalyzerApiModel, { ICmAnalyzerAnalysis, ICmAnalyzerChapter, ICmAnalyzerCmRange, ICmAnalyzerManualPin } from '@/model/api/cmAnalyzer/ICmAnalyzerApiModel';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import { IVideoPlayerSettingModel } from '@/model/storage/video/IVideoPlayerSettingModel';

interface SpeedItem {
    text: string;
    value: number;
}

@Component({
    components: {
        JikkyoOverlay,
        RecordedJikkyoOverlay,
        NormalVideo,
        LiveHLSVideo,
        RecordedStreamingVideo,
        RecordedHLSStreamingVideo,
        LiveMpegTsVideo,
    },
})
export default class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoParam!: VideoParam.BaseVideoParam;

    @Prop({ required: false })
    public jikkyoChannelId: number | undefined;

    @Prop({ required: false })
    public recordedJikkyoVideoFileId: number | undefined;

    @Prop({ required: false })
    public recordedId: number | null | undefined;

    @Prop({ required: false, default: () => [] })
    public chapterEditPins!: ICmAnalyzerManualPin[];

    @Prop({ required: false, default: null })
    public chapterEditFrameRate!: number | null;

    @Prop({ required: false, default: null })
    public chapterEditSelectedIndex!: number | null;

    @Prop({ required: false, default: false })
    public chapterEditEnabled!: boolean;

    @Prop({ required: false })
    public isEnabledSpeedControl: boolean | undefined; // 速度調整が有効か

    public isHideCursor: boolean = false;
    public currentTime: number = 0; // 動画再生位置 (秒)
    public duration: number = 0; // 動画終了長さ (秒)
    public volume: number = 1.0;
    public speed: number = 1.0;
    public isLoading: boolean = true;
    public isPause: boolean = true; // play ボタン用
    public isShowControl: boolean = false;
    public isHideAudioVolume: boolean = UaUtil.isMobile() || UaUtil.isiPadOS();
    public isEnabledPip: boolean = !!(document as any).pictureInPictureEnabled;
    public isFullscreen: boolean = this.checkFullscreen();
    public currentTimeStr: string = '--:--';
    public durationStr: string = '--:--';
    public playbackRate: number = 1.0;
    public isChangingCurrentPosition: boolean = false;
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    private cmAnalyzerApiModel: ICmAnalyzerApiModel = container.get<ICmAnalyzerApiModel>('ICmAnalyzerApiModel');

    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    public cmAnalysis: ICmAnalyzerAnalysis | null = null;
    public isCmSkipEnabled: boolean = this.settingStorageModel.tmp.enableCmSkipByDefault;

    private chapterEditFrameCursor: number | null = null;
    public chapterEditFramePreviewUrl: string | null = null;
    private chapterEditFramePreviewSerial: number = 0;
    private chapterEditFramePreviewAbortController: AbortController | null = null;

    private cmAnalysisLoadSerial: number = 0;
    private cmAutoSkipSuppressedUntil: number = 0;
    private lastAutoSkippedCmRangeIndex: number | null = null;
    private isChapterEditAvailableForCurrentVideo: boolean = false;

    public isJikkyoEnabled: boolean = this.settingStorageModel.tmp.showJikkyoByDefault;
    public isJikkyoAvailable: boolean = false;

    private lastPlaybackPositionSavedAt: number = 0;
    private isPlaybackPositionRestored: boolean = false;
    private pendingInitialPlaybackPosition: number | null = null;

    // 字幕状態 (表示用)
    public isEnabledSubtitles: boolean = false;
    public isShowingSubtitle: boolean = false;

    public isiPad: boolean = UaUtil.isiPadOS();

    private videoSetting: IVideoPlayerSettingModel = container.get<IVideoPlayerSettingModel>('IVideoPlayerSettingModel');

    private isFirstPlay: boolean = true;
    private isEnabledRotation: boolean = typeof window.screen.orientation !== 'undefined' && UaUtil.isMobile();
    private keyDwonListener = ((e: KeyboardEvent): void => {
        this.onKeyDown(e);
    }).bind(this);
    private fullScreenListener = ((): void => {
        this.fullscreenChange();
    }).bind(this);
    private hideControlTimer: number | undefined;
    private livePlaybackRetryListenerRegistered: boolean = false;
    private liveVideoReloadKey: number = 0;

    // seek 時に使用する一時変数
    private needsReplay: boolean | null = null;
    private lastSeekedTime: number = 0; // 最後に slider を seek した時刻

    // 内部字幕状態
    // eslint-disable-next-line no-undef
    private internalSubtitleState: TextTrackMode = 'disabled';

    public created(): void {
        document.addEventListener('keydown', this.keyDwonListener, false);
        document.addEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.addEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    public beforeDestroy(): void {
        this.clearChapterEditFramePreview();
        document.removeEventListener('keydown', this.keyDwonListener, false);
        this.removeLivePlaybackRetryListener();
        document.removeEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.removeEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.removeLivePlaybackRetryListener();
        this.isFirstPlay = true;
        this.isPlaybackPositionRestored = false;
        this.pendingInitialPlaybackPosition = null;
        this.lastPlaybackPositionSavedAt = 0;
        this.cmAnalysis = null;
        this.lastAutoSkippedCmRangeIndex = null;
        this.cmAutoSkipSuppressedUntil = 0;
    }

    @Watch('chapterEditEnabled')
    public onChapterEditEnabledChange(enabled: boolean): void {
        if (enabled === false) {
            this.chapterEditFrameCursor = null;
            this.clearChapterEditFramePreview();
        }
    }

    @Watch('recordedId', { immediate: true })
    public onRecordedIdChange(): void {
        void this.loadCmAnalysis();
    }

    @Watch('recordedJikkyoVideoFileId', { immediate: true })
    public onRecordedVideoFileIdChange(): void {
        void this.loadCmAnalysis();
    }

    public get hasCmAnalysis(): boolean {
        return this.cmAnalysis !== null && Array.isArray(this.cmAnalysis.timeline.chapters) && this.cmAnalysis.timeline.chapters.length > 0;
    }

    public get hasCmRanges(): boolean {
        return this.getPlayableCmRanges().length > 0;
    }

    public get seekbarPlaybackBoundaryRanges(): Array<{
        key: string;
        left: number;
        width: number;
    }> {
        if (this.duration <= 0 || this.cmAnalysis === null) {
            return [];
        }

        const ranges: Array<{
            key: string;
            left: number;
            width: number;
        }> = [];

        const playbackStart = this.cmAnalysis.timeline.playbackStart;

        if (typeof playbackStart === 'number' && isFinite(playbackStart) && playbackStart > 0) {
            const endTime = Math.min(playbackStart, this.duration);

            if (endTime > 0) {
                ranges.push({
                    key: `head-0-${endTime}`,
                    left: 0,
                    width: (endTime / this.duration) * 100,
                });
            }
        }

        const playbackEnd = this.cmAnalysis.timeline.playbackEnd;

        if (typeof playbackEnd === 'number' && isFinite(playbackEnd) && playbackEnd >= 0 && playbackEnd < this.duration) {
            const startTime = Math.max(0, playbackEnd);

            ranges.push({
                key: `tail-${startTime}-${this.duration}`,
                left: (startTime / this.duration) * 100,
                width: ((this.duration - startTime) / this.duration) * 100,
            });
        }

        return ranges;
    }

    public get seekbarCmRanges(): Array<{
        key: string;
        left: number;
        width: number;
    }> {
        if (this.duration <= 0) {
            return [];
        }

        return this.getPlayableCmRanges()
            .map((range, index) => {
                const startTime = Math.max(0, Math.min(range.startTime as number, this.duration));
                const endTime = Math.max(startTime, Math.min(range.endTime as number, this.duration));

                return {
                    key: `${index}-${startTime}-${endTime}`,
                    left: (startTime / this.duration) * 100,
                    width: ((endTime - startTime) / this.duration) * 100,
                };
            })
            .filter(range => range.width > 0);
    }

    public get seekbarChapterMarkers(): Array<{ key: string; left: number }> {
        if (this.duration <= 0 || this.cmAnalysis === null || !Array.isArray(this.cmAnalysis.timeline.chapters)) {
            return [];
        }

        return this.cmAnalysis.timeline.chapters
            .filter(chapter => typeof chapter.time === 'number' && isFinite(chapter.time) && chapter.time > 0 && chapter.time < this.duration)
            .map((chapter, index) => ({
                key: `${index}-${chapter.time}`,
                left: (chapter.time / this.duration) * 100,
            }));
    }

    public get cmStatusText(): string {
        const ranges = this.getPlayableCmRanges();

        if (ranges.length === 0) {
            return '';
        }

        const currentIndex = ranges.findIndex(range => this.currentTime >= (range.startTime as number) && this.currentTime < (range.endTime as number));

        const autoText = this.isCmSkipEnabled ? '自動ON' : '自動OFF';

        if (currentIndex >= 0) {
            return `CM区間 ${currentIndex + 1}/${ranges.length} ` + autoText;
        }

        return `CM ${ranges.length}区間 ` + autoText;
    }

    public getChapterEditAnalysis(): ICmAnalyzerAnalysis | null {
        return this.cmAnalysis;
    }

    public isChapterEditAvailable(): boolean {
        return this.isChapterEditAvailableForCurrentVideo;
    }

    public getChapterEditCurrentTime(): number {
        return this.currentTime;
    }

    public getChapterEditDuration(): number {
        return this.duration;
    }

    public getChapterEditFrameRate(): number | null {
        if (
            this.cmAnalysis !== null &&
            this.cmAnalysis.timeline &&
            typeof this.cmAnalysis.timeline.frameRate === 'number' &&
            isFinite(this.cmAnalysis.timeline.frameRate) &&
            this.cmAnalysis.timeline.frameRate > 0
        ) {
            return this.cmAnalysis.timeline.frameRate;
        }

        if (typeof this.chapterEditFrameRate === 'number' && isFinite(this.chapterEditFrameRate) && this.chapterEditFrameRate > 0) {
            return this.chapterEditFrameRate;
        }

        return null;
    }

    private getChapterEditMaxFrame(frameRate: number): number {
        /*
         * duration はストリーム終端時刻であり、
         * frame / frameRate による時刻 seek で実際に取得できる
         * 最終映像フレームとは一致しない場合がある。
         *
         * MPEG-TS の末尾では nominal な最終フレーム付近を
         * ffmpeg がデコードできない場合があるため、
         * 2フレーム分を終端から除外する。
         */
        if (this.duration <= 0) {
            return Number.MAX_SAFE_INTEGER;
        }

        return Math.max(0, Math.floor(this.duration * frameRate) - 2);
    }

    public getChapterEditCurrentFrame(): number | null {
        const frameRate = this.getChapterEditFrameRate();

        if (frameRate === null) {
            return null;
        }

        const maxFrame = this.getChapterEditMaxFrame(frameRate);

        if (this.chapterEditFrameCursor !== null) {
            return Math.max(0, Math.min(this.chapterEditFrameCursor, maxFrame));
        }

        return Math.max(0, Math.min(Math.round(this.currentTime * frameRate), maxFrame));
    }

    public seekChapterEditFrame(frame: number): void {
        const frameRate = this.getChapterEditFrameRate();

        if (frameRate === null || !isFinite(frame)) {
            return;
        }

        const maxFrame = this.getChapterEditMaxFrame(frameRate);

        const targetFrame = Math.max(0, Math.min(Math.round(frame), maxFrame));

        this.chapterEditFrameCursor = targetFrame;

        if (typeof this.$refs.video !== 'undefined' && this.isPause === false) {
            (this.$refs.video as BaseVideo).pause();
        }

        this.currentTime = targetFrame / frameRate;
        this.updateTimeStr();
        void this.showChapterEditFramePreview(targetFrame, frameRate);
    }

    private getChapterEditVideoFileId(): number | null {
        if (this.videoParam.type === 'RecordedStreaming') {
            return (this.videoParam as VideoParam.RecordedStreamingParam).videoFileId;
        }

        if (this.videoParam.type === 'RecordedHLS') {
            return (this.videoParam as VideoParam.RecordedHLSParam).videoFileId;
        }

        if (this.videoParam.type === 'Normal') {
            const videoFileId = (this.videoParam as VideoParam.NormalVideoParam).videoFileId;

            return typeof videoFileId === 'number' ? videoFileId : null;
        }

        return null;
    }

    private async showChapterEditFramePreview(frame: number, frameRate: number): Promise<void> {
        if (this.chapterEditEnabled === false || this.isChapterEditAvailable() === false) {
            return;
        }

        const videoFileId = this.getChapterEditVideoFileId();

        if (videoFileId === null) {
            return;
        }

        const serial = ++this.chapterEditFramePreviewSerial;

        if (this.chapterEditFramePreviewAbortController !== null) {
            this.chapterEditFramePreviewAbortController.abort();
        }

        const controller = new AbortController();
        this.chapterEditFramePreviewAbortController = controller;

        try {
            const response = await fetch(`/api/videos/${videoFileId}/frame-preview?frame=${encodeURIComponent(String(frame))}&frameRate=${encodeURIComponent(String(frameRate))}`, {
                signal: controller.signal,
                cache: 'no-store',
            });

            if (!response.ok) {
                throw new Error(`frame preview failed: HTTP ${response.status}`);
            }

            const blob = await response.blob();

            if (serial !== this.chapterEditFramePreviewSerial) {
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            const oldObjectUrl = this.chapterEditFramePreviewUrl;

            this.chapterEditFramePreviewUrl = objectUrl;

            if (oldObjectUrl !== null) {
                URL.revokeObjectURL(oldObjectUrl);
            }
        } catch (err) {
            if (controller.signal.aborted === false) {
                console.error('chapter edit frame preview failed', err);
            }
        } finally {
            if (this.chapterEditFramePreviewAbortController === controller) {
                this.chapterEditFramePreviewAbortController = null;
            }
        }
    }

    private clearChapterEditFramePreview(): void {
        ++this.chapterEditFramePreviewSerial;

        if (this.chapterEditFramePreviewAbortController !== null) {
            this.chapterEditFramePreviewAbortController.abort();
            this.chapterEditFramePreviewAbortController = null;
        }

        if (this.chapterEditFramePreviewUrl !== null) {
            URL.revokeObjectURL(this.chapterEditFramePreviewUrl);
            this.chapterEditFramePreviewUrl = null;
        }
    }

    public stepChapterEditFrame(delta: number, updatePreview: boolean = true): void {
        const frameRate = this.getChapterEditFrameRate();

        if (frameRate === null) {
            return;
        }

        if (this.chapterEditFrameCursor === null) {
            this.chapterEditFrameCursor = Math.max(0, Math.round(this.currentTime * frameRate));
        }

        const maxFrame = this.getChapterEditMaxFrame(frameRate);
        const targetFrame = Math.max(0, Math.min(this.chapterEditFrameCursor + delta, maxFrame));

        this.chapterEditFrameCursor = targetFrame;

        if (typeof this.$refs.video !== 'undefined' && this.isPause === false) {
            (this.$refs.video as BaseVideo).pause();
        }

        this.currentTime = targetFrame / frameRate;
        this.updateTimeStr();

        if (updatePreview) {
            void this.showChapterEditFramePreview(targetFrame, frameRate);
        }
    }

    public refreshChapterEditFramePreview(): void {
        const frameRate = this.getChapterEditFrameRate();

        if (frameRate === null) {
            return;
        }

        const frame = this.getChapterEditCurrentFrame();

        if (frame === null) {
            return;
        }

        void this.showChapterEditFramePreview(frame, frameRate);
    }

    public async reloadChapterEditAnalysis(): Promise<void> {
        await this.loadCmAnalysis();
    }

    public get seekbarEditPins(): Array<{
        key: string;
        left: number;
        selected: boolean;
        type: string;
    }> {
        if (this.duration <= 0 || !Array.isArray(this.chapterEditPins) || this.chapterEditPins.length === 0) {
            return [];
        }

        const frameRate = this.getChapterEditFrameRate();

        if (frameRate === null) {
            return [];
        }

        return this.chapterEditPins.map((pin, index) => {
            const time = pin.frame / frameRate;

            return {
                key: `${index}-${pin.type}-${pin.frame}`,
                left: Math.max(0, Math.min(100, (time / this.duration) * 100)),
                selected: this.chapterEditSelectedIndex === index,
                type: pin.type,
            };
        });
    }

    private async loadCmAnalysis(): Promise<void> {
        const serial = ++this.cmAnalysisLoadSerial;

        this.cmAnalysis = null;
        this.lastAutoSkippedCmRangeIndex = null;
        this.isChapterEditAvailableForCurrentVideo = false;

        if (this.recordedId === null || typeof this.recordedId === 'undefined' || typeof this.recordedJikkyoVideoFileId === 'undefined') {
            return;
        }

        try {
            const recorded = await this.recordedApiModel.get(this.recordedId, false);

            if (serial !== this.cmAnalysisLoadSerial) {
                return;
            }

            const videoFiles = recorded.videoFiles || [];

            const videoFile = videoFiles.find(item => item.id === this.recordedJikkyoVideoFileId);

            /*
             * CMカット済み動画は元録画タイムラインと一致しないため、
             * チャプター移動もCM自動スキップも適用しない。
             */
            if (!videoFile || videoFile.cmState === 'cut') {
                return;
            }

            this.isChapterEditAvailableForCurrentVideo = true;

            const analysis = await this.cmAnalyzerApiModel.getAnalysis(this.recordedId);

            if (serial !== this.cmAnalysisLoadSerial) {
                return;
            }

            this.cmAnalysis = analysis;
            this.restorePlaybackPosition();
        } catch (err) {
            if (serial !== this.cmAnalysisLoadSerial) {
                return;
            }

            console.error('CM analysis load failed', err);

            this.cmAnalysis = null;
        }
    }

    private getPlayableCmRanges(): ICmAnalyzerCmRange[] {
        if (this.cmAnalysis === null || !Array.isArray(this.cmAnalysis.timeline.cmRanges)) {
            return [];
        }

        return this.cmAnalysis.timeline.cmRanges.filter(
            range =>
                typeof range.startTime === 'number' && isFinite(range.startTime) && typeof range.endTime === 'number' && isFinite(range.endTime) && range.endTime > range.startTime,
        );
    }

    private suppressCmAutoSkip(): void {
        this.cmAutoSkipSuppressedUntil = new Date().getTime() + 1500;

        this.lastAutoSkippedCmRangeIndex = null;
    }

    private seekPlaybackTime(time: number): void {
        if (typeof this.$refs.video === 'undefined' || !isFinite(time)) {
            return;
        }

        const seekTime = Math.max(0, this.duration > 0 ? Math.min(time, this.duration) : time);

        this.suppressCmAutoSkip();

        (this.$refs.video as BaseVideo).setCurrentTime(seekTime);

        this.currentTime = seekTime;

        this.syncRecordedJikkyoSeek(seekTime);

        this.updateLastSeekTime();
        this.updateTimeStr();
    }

    public seekPreviousChapter(): void {
        if (this.cmAnalysis === null || !Array.isArray(this.cmAnalysis.timeline.chapters)) {
            return;
        }

        const targetTime = this.currentTime - 1;

        let target: ICmAnalyzerChapter | null = null;

        for (const chapter of this.cmAnalysis.timeline.chapters) {
            if (chapter.time <= targetTime) {
                target = chapter;
            } else {
                break;
            }
        }

        if (target !== null) {
            this.seekPlaybackTime(target.time);
        } else {
            this.seekPlaybackTime(0);
        }
    }

    public seekNextChapter(): void {
        if (this.cmAnalysis === null || !Array.isArray(this.cmAnalysis.timeline.chapters)) {
            return;
        }

        const chapters = this.cmAnalysis.timeline.chapters;

        /*
         * 現在位置がチャプター境界の直前として報告される場合でも、
         * その境界を「現在いるチャプター」とみなして次へ送る。
         */
        const boundaryTolerance = 1.0;

        let currentChapterIndex = -1;

        for (let i = 0; i < chapters.length; i++) {
            if (chapters[i].time <= this.currentTime + boundaryTolerance) {
                currentChapterIndex = i;
            } else {
                break;
            }
        }

        const nextChapterIndex = currentChapterIndex + 1;

        if (nextChapterIndex >= 0 && nextChapterIndex < chapters.length) {
            this.seekPlaybackTime(chapters[nextChapterIndex].time);
        }
    }

    public switchCmSkip(): void {
        this.isCmSkipEnabled = !this.isCmSkipEnabled;

        this.lastAutoSkippedCmRangeIndex = null;

        if (this.isCmSkipEnabled) {
            this.maybeAutoSkipCm();
        }
    }

    private maybeStopAtPlaybackEnd(): boolean {
        if (
            this.chapterEditEnabled === true ||
            this.isCmSkipEnabled === false ||
            this.cmAnalysis === null ||
            typeof this.cmAnalysis.timeline.playbackEnd !== 'number' ||
            !isFinite(this.cmAnalysis.timeline.playbackEnd) ||
            this.isChangingCurrentPosition === true ||
            typeof this.$refs.video === 'undefined'
        ) {
            return false;
        }

        const playbackEnd = this.cmAnalysis.timeline.playbackEnd;

        if (this.currentTime < playbackEnd || (this.$refs.video as BaseVideo).paused() === true) {
            return false;
        }

        /*
         * tail は自動スキップせず、番組としての再生終了位置で停止する。
         * 手動シーク自体は playbackEnd より後も許可する。
         */
        (this.$refs.video as BaseVideo).pause();
        (this.$refs.video as BaseVideo).setCurrentTime(0);
        this.currentTime = 0;
        this.syncRecordedJikkyoSeek(0);
        this.updateTimeStr();
        this.clearPlaybackPosition();

        return true;
    }

    private maybeAutoSkipCm(): void {
        if (
            this.chapterEditEnabled === true ||
            this.isCmSkipEnabled === false ||
            this.isChangingCurrentPosition === true ||
            new Date().getTime() < this.cmAutoSkipSuppressedUntil ||
            typeof this.$refs.video === 'undefined'
        ) {
            return;
        }

        const ranges = this.getPlayableCmRanges();

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];

            const startTime = range.startTime as number;

            const endTime = range.endTime as number;

            if (this.currentTime >= startTime && this.currentTime < endTime) {
                if (this.lastAutoSkippedCmRangeIndex === i) {
                    return;
                }

                this.lastAutoSkippedCmRangeIndex = i;

                const seekTime = this.duration > 0 ? Math.min(endTime + 0.05, this.duration) : endTime + 0.05;

                (this.$refs.video as BaseVideo).setCurrentTime(seekTime);

                this.currentTime = seekTime;

                this.syncRecordedJikkyoSeek(seekTime);

                this.updateTimeStr();
                return;
            }
        }

        if (this.lastAutoSkippedCmRangeIndex !== null) {
            const lastRange = ranges[this.lastAutoSkippedCmRangeIndex];

            if (!lastRange || this.currentTime < (lastRange.startTime as number) - 0.5 || this.currentTime > (lastRange.endTime as number) + 0.5) {
                this.lastAutoSkippedCmRangeIndex = null;
            }
        }
    }

    private get isLive(): boolean {
        return typeof this.jikkyoChannelId !== 'undefined';
    }

    public reloadLiveVideo(): void {
        if (this.isLive === false) {
            return;
        }

        this.removeLivePlaybackRetryListener();

        this.isLoading = true;
        this.isPause = true;
        this.isFirstPlay = true;

        // key を変更して video コンポーネントを作り直し、
        // ライブストリームへ新しく接続する
        this.liveVideoReloadKey++;
    }

    /**
     * on keydown
     * @param event: KeyboardEvent
     */
    private async onKeyDown(event: KeyboardEvent): Promise<void> {
        // space key 入力時に再生状態の反転
        if (event.key === ' ' && this.isLive === false) {
            await this.togglePlay();

            if (typeof this.$refs.video !== 'undefined') {
                if ((this.$refs.video as BaseVideo).paused() === true) {
                    this.isShowControl = true;
                    this.isHideCursor = false;
                } else {
                    await Util.sleep(100);
                    this.isShowControl = false;
                    this.isHideCursor = true;
                    clearTimeout(this.hideControlTimer);
                }
            }
        }

        // switch mute
        if (event.key === 'm') {
            this.switchMute();
        }

        // switch fullscreen
        if (event.key === 'f') {
            this.switchFullScreen();
        }

        if (this.duration > 0 && this.isLive === false) {
            // -10 seek
            if (event.key === 'ArrowLeft') {
                this.rewindTime(10);
            }

            // +10 seek
            if (event.key === 'ArrowRight') {
                this.forwardTime(10);
            }
        }
    }

    /**
     * fullscreen の状態が変化したときに呼ばれる
     */
    private fullscreenChange(): void {
        this.isFullscreen = this.checkFullscreen();
    }

    private checkFullscreen(): boolean {
        return (
            !!(
                (document as any).fullScreen ||
                (document as any).webkitIsFullScreen ||
                (document as any).mozFullScreen ||
                (document as any).msFullscreenElement ||
                (document as any).fullscreenElement
            ) ||
            (typeof this.$refs.video !== 'undefined' && !!(this.$refs.video as any).webkitDisplayingFullscreen)
        );
    }

    /**
     * mousemove 処理
     */
    public mousemove(e: MouseEvent): void {
        if (UaUtil.isAndroid() === true || typeof this.$refs.video === 'undefined' || (this.$refs.video as BaseVideo).paused() === true) {
            return;
        }

        this.isShowControl = true;
        this.isHideCursor = false;

        clearTimeout(this.hideControlTimer);
        if (e.target === this.$refs.videoControlWrap) {
            // video control 外
            this.hideControlTimer = setTimeout(() => {
                this.isShowControl = false;
                this.isHideCursor = true;
            }, 3000);
        }
    }

    /**
     * mouseleave 処理
     */
    private mouseleave(): void {
        //  再生中でない or 最後に slider を seek させてから 50ms 以上経過していない場合は無視する
        if (
            UaUtil.isAndroid() === true ||
            typeof this.$refs.video === 'undefined' ||
            (this.$refs.video as BaseVideo).paused() === true ||
            new Date().getTime() - this.lastSeekedTime < 50
        ) {
            return;
        }

        this.isShowControl = false;
        this.isHideCursor = false;
    }

    // 時刻更新
    public onTimeupdate(): void {
        const duration = this.getVideoDuration();
        this.duration = duration;

        if (this.chapterEditEnabled === false || this.chapterEditFrameCursor === null) {
            this.currentTime = this.getVideoCurrentTime();
        }

        this.updateTimeStr();
        this.updateSubtitleState();

        if (this.maybeStopAtPlaybackEnd()) {
            return;
        }

        this.maybeAutoSkipCm();
        this.savePlaybackPosition();
    }

    /**
     * this.currentTimeStr, this.durationStr を更新する
     */
    private updateTimeStr(): void {
        const c = this.getTimeData(this.currentTime);
        const d = this.getTimeData(this.duration);

        if (d.h > 0) {
            this.currentTimeStr = `${this.zeroPadding(c.h)}:${this.zeroPadding(c.m)}:${this.zeroPadding(c.s)}`;
            this.durationStr = `${this.zeroPadding(d.h)}:${this.zeroPadding(d.m)}:${this.zeroPadding(d.s)}`;
        } else {
            this.currentTimeStr = `${this.zeroPadding(c.m)}:${this.zeroPadding(c.s)}`;
            this.durationStr = `${this.zeroPadding(d.m)}:${this.zeroPadding(d.s)}`;
        }
    }

    /**
     * @param time: number
     * @return { h: number; m: number; s: number }
     */
    private getTimeData(time: number): { h: number; m: number; s: number } {
        if (time === Infinity || isNaN(time)) {
            return {
                h: 0,
                m: 0,
                s: 0,
            };
        }

        time = Math.floor(time);

        return {
            h: (time / 3600) | 0,
            m: ((time % 3600) / 60) | 0,
            s: time % 60,
        };
    }

    /**
     * 0 埋め
     * @param num: number
     * @return string
     */
    private zeroPadding(num: number): string {
        return `0${num.toString(10)}`.slice(-2);
    }

    /**
     * 字幕の状態を更新する
     */
    protected updateSubtitleState(): void {
        if (typeof this.$refs.video !== 'undefined') {
            (this.$refs.video as BaseVideo).fixSubtitleState();
        }

        this.isEnabledSubtitles = typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).isEnabledSubtitles();
        this.isShowingSubtitle = typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).isShowingSubtitle();
    }

    // 読み込み中
    public onWaiting(): void {
        this.isLoading = true;
    }

    // 読み込み完了
    public onLoadeddata(): void {
        this.isLoading = false;
        this.forceUpdateSubtitle();
        this.updateSubtitleState();
        this.restorePlaybackPosition();
    }

    /**
     * HLS 初期化で currentTime が 0 に戻る場合があるため、
     * 初期復元位置を canplay 後に一度だけ保証する。
     */
    private async applyPendingInitialPlaybackPosition(): Promise<void> {
        if (this.pendingInitialPlaybackPosition === null || typeof this.$refs.video === 'undefined') {
            return;
        }

        const target = this.pendingInitialPlaybackPosition;

        const current = this.getVideoCurrentTime();

        /*
         * HLS では初期シークによってストリームが再生成される場合がある。
         * その場合は次の canplay まで pending を保持する。
         */
        if (!isFinite(current) || Math.abs(current - target) > 0.25) {
            (this.$refs.video as BaseVideo).setCurrentTime(target);
            this.currentTime = target;
            this.syncRecordedJikkyoSeek(target);
            this.updateLastSeekTime();
            this.updateTimeStr();
            return;
        }

        /*
         * 目標位置で canplay まで到達した時点で初期復元完了。
         * HLS 再生成で失われた初回自動再生もここで復旧する。
         */
        this.pendingInitialPlaybackPosition = null;

        if ((this.$refs.video as BaseVideo).paused() === true) {
            try {
                await (this.$refs.video as BaseVideo).play();
            } catch (err) {
                if (!(err instanceof DOMException) || err.name !== 'NotAllowedError') {
                    console.error(err);
                }
            }
        }
    }

    // 再生可能
    public async onCanplay(): Promise<void> {
        this.isLoading = false;

        await this.applyPendingInitialPlaybackPosition();

        // ライブ視聴では再生可能になった時点で再生を開始する
        if (typeof this.jikkyoChannelId !== 'undefined' && typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === true) {
            try {
                await (this.$refs.video as BaseVideo).play();
            } catch (err) {
                if (err instanceof DOMException && err.name === 'NotAllowedError') {
                    // 音声付き autoplay が拒否された場合は、
                    // 次のユーザー操作時に再試行する
                    this.addLivePlaybackRetryListener();
                } else {
                    console.error(err);
                    this.addLivePlaybackRetryListener();
                }
            }
        }

        if (typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === true && new Date().getTime() - this.lastSeekedTime > 1000) {
            this.isShowControl = true;
            this.isHideCursor = false;
        }

        setTimeout(() => {
            if (this.isFirstPlay === true && typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === false) {
                this.isShowControl = false;
                this.isHideCursor = true;

                // 字幕の初期表示状態と内部状態を合わせる
                const isShowingSubtitle = this.internalSubtitleState === 'showing';
                const subtitleConfig = this.videoSetting.getSavedValue().isShowSubtitle;
                if (subtitleConfig !== isShowingSubtitle) {
                    this.internalSubtitleState = subtitleConfig === true ? 'showing' : 'disabled';
                    this.forceUpdateSubtitle();
                }
            }
            this.isFirstPlay = false;
        }, 300);

        // set duration
        this.duration = this.getVideoDuration();

        // update time str
        this.updateTimeStr();

        this.updateSubtitleState();
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
        this.clearPlaybackPosition();

        if (this.isLive === false && typeof this.$refs.video !== 'undefined') {
            (this.$refs.video as BaseVideo).pause();
            (this.$refs.video as BaseVideo).setCurrentTime(0);
            this.currentTime = 0;
            this.syncRecordedJikkyoSeek(0);
            this.updateTimeStr();
        }
    }

    // 再生
    public onPlay(): void {
        this.removeLivePlaybackRetryListener();
        this.isPause = false;
        this.updateSubtitleState();
    }

    // 停止
    public onPause(): void {
        this.isPause = true;
    }

    // 再生位置変更開始
    public startChangeCurrentPosition(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.chapterEditFrameCursor = null;
        this.clearChapterEditFramePreview();
        this.isChangingCurrentPosition = true;

        // 後で再生状態を戻すために保存
        if ((this.$refs.video as BaseVideo).paused() === false) {
            // 再生中なら再生停止
            (this.$refs.video as BaseVideo).pause();
            this.needsReplay = true;
        }
    }

    // 再生位置変更終了
    public async endChangeCurrentPosition(time: number): Promise<void> {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.suppressCmAutoSkip();
        this.updateLastSeekTime();
        (this.$refs.video as BaseVideo).setCurrentTime(time);
        this.syncRecordedJikkyoSeek(time);
        this.isChangingCurrentPosition = false;

        // 内部の字幕表示状態と実際の状態を強制的に合わせる
        this.forceUpdateSubtitle();

        // シーク前に再生中であれば再開
        await Util.sleep(200);
        if (this.needsReplay === true && this.chapterEditEnabled === false) {
            await (this.$refs.video as BaseVideo).play().catch(err => {
                console.error(err);
            });
        }
        this.needsReplay = null;
    }

    /**
     * 強制的に実際の字幕の状態を内部の字幕状態に合わせる
     */
    private forceUpdateSubtitle(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        try {
            if (this.internalSubtitleState === 'showing') {
                (this.$refs.video as BaseVideo).showSubtitle();
            } else {
                (this.$refs.video as BaseVideo).disabledSubtitle();
            }
        } catch (err) {
            console.error(err);
        }
    }

    // 再生位置更新時に呼ばれる
    public updateCurrentPosition(): void {
        this.updateTimeStr();
    }

    // 再生速度変更
    public onChangePlaybackRate(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.playbackRate = (this.$refs.video as BaseVideo).getPlaybackRate();
    }

    // 音量変更
    public onVolumechange(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.volume = (this.$refs.video as BaseVideo).getVolume();
    }

    // video control 表示切り替え
    public toggleControl(): void {
        // 最後に slider を seek させてから 50ms 以上経過していない場合は無視する
        if (new Date().getTime() - this.lastSeekedTime < 50) {
            return;
        }

        if (this.isShowControl === false) {
            clearTimeout(this.hideControlTimer);
            this.isHideCursor = false;
        } else if (typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === false) {
            this.isHideCursor = true;
        }
        this.isShowControl = !this.isShowControl;
    }

    // autoplay が拒否されたライブ視聴を、次のユーザー操作で再試行する
    private addLivePlaybackRetryListener(): void {
        if (this.livePlaybackRetryListenerRegistered === true || typeof this.jikkyoChannelId === 'undefined') {
            return;
        }

        this.livePlaybackRetryListenerRegistered = true;
        document.addEventListener('click', this.retryLivePlayback, true);
        document.addEventListener('keydown', this.retryLivePlayback, true);
        document.addEventListener('touchstart', this.retryLivePlayback, true);
    }

    private removeLivePlaybackRetryListener(): void {
        if (this.livePlaybackRetryListenerRegistered === false) {
            return;
        }

        document.removeEventListener('click', this.retryLivePlayback, true);
        document.removeEventListener('keydown', this.retryLivePlayback, true);
        document.removeEventListener('touchstart', this.retryLivePlayback, true);
        this.livePlaybackRetryListenerRegistered = false;
    }

    private retryLivePlayback = async (): Promise<void> => {
        this.removeLivePlaybackRetryListener();

        if (typeof this.jikkyoChannelId === 'undefined' || typeof this.$refs.video === 'undefined' || (this.$refs.video as BaseVideo).paused() === false) {
            return;
        }

        try {
            await (this.$refs.video as BaseVideo).play();
        } catch (err) {
            console.error(err);

            // まだ再生できなければ、次のユーザー操作でもう一度試す
            if (typeof this.jikkyoChannelId !== 'undefined' && typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === true) {
                this.addLivePlaybackRetryListener();
            }
        }
    };

    // 再生状態切り替え
    public async togglePlay(): Promise<void> {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        // ライブ視聴では一時停止させない
        if (typeof this.jikkyoChannelId !== 'undefined') {
            if ((this.$refs.video as BaseVideo).paused() === true) {
                await (this.$refs.video as BaseVideo).play().catch(err => {
                    console.error(err);
                });
            }
            return;
        }

        if ((this.$refs.video as BaseVideo).paused() === true) {
            if (this.chapterEditEnabled === true && this.chapterEditFrameCursor !== null) {
                const frameRate = this.getChapterEditFrameRate();

                if (frameRate !== null) {
                    this.seekPlaybackTime(this.chapterEditFrameCursor / frameRate);
                }

                this.chapterEditFrameCursor = null;
            }

            this.clearChapterEditFramePreview();

            await (this.$refs.video as BaseVideo).play().catch(err => {
                console.error(err);
            });
        } else {
            (this.$refs.video as BaseVideo).pause();
        }
    }

    /**
     * 指定した時間だけ currentTime を戻す
     * @param time: number 戻す時間 (秒)
     */
    public rewindTime(time: number): void {
        if (time < 0 || typeof this.$refs.video === 'undefined') {
            return;
        }

        const newCurrentTime = this.currentTime - time;
        const seekTime = newCurrentTime < 0 ? 0 : newCurrentTime;
        this.suppressCmAutoSkip();
        (this.$refs.video as BaseVideo).setCurrentTime(seekTime);
        this.syncRecordedJikkyoSeek(seekTime);
        this.updateLastSeekTime();
    }

    /**
     * 指定した時間だけ currentTime を進める
     * @param time: number 進める時間 (秒)
     */
    public forwardTime(time: number): void {
        if (time < 0 || typeof this.$refs.video === 'undefined') {
            return;
        }

        const newCurrentTime = this.currentTime + time;
        const seekTime = newCurrentTime > this.duration ? this.duration : newCurrentTime;
        this.suppressCmAutoSkip();
        (this.$refs.video as BaseVideo).setCurrentTime(seekTime);
        this.syncRecordedJikkyoSeek(seekTime);
        this.updateLastSeekTime();
    }

    /**
     * 再生速度 up
     */
    public speedUp(): void {
        this.changePlaybackRate(Math.floor(this.playbackRate * 10 + 1) / 10);
    }

    /**
     * 再生速度を元に戻す
     */
    public resetSpeed(): void {
        this.changePlaybackRate(1.0);
    }

    /**
     * 再生速度 down
     */
    public speedDown(): void {
        this.changePlaybackRate(Math.floor(this.playbackRate * 10 - 1) / 10);
    }

    private changePlaybackRate(rate: number): void {
        if (typeof this.$refs.video === 'undefined' || rate < 0.1) {
            return;
        }

        (this.$refs.video as BaseVideo).setPlaybackRate(rate);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    private getVideoDuration(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (this.$refs.video as BaseVideo).getDuration();
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    private getVideoCurrentTime(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (this.$refs.video as BaseVideo).getCurrentTime();
    }

    /**
     * mute 切り替え
     */
    public switchMute(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (this.$refs.video as BaseVideo).switchMute();
    }

    /**
     * 音量変更
     */
    public changeVolume(volume: number): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (this.$refs.video as BaseVideo).setVolume(volume);
    }

    /**
     * seek 時刻を更新する
     */
    public updateLastSeekTime(): void {
        this.lastSeekedTime = new Date().getTime();
    }

    private getPlaybackPositionKey(): string | null {
        if (this.recordedId === null || typeof this.recordedId === 'undefined') {
            return null;
        }

        return `epgstation-playback-position-${this.recordedId}`;
    }

    private savePlaybackPosition(): void {
        const key = this.getPlaybackPositionKey();
        if (key === null || !isFinite(this.currentTime) || !isFinite(this.duration) || this.duration <= 0) {
            return;
        }

        const now = new Date().getTime();
        if (now - this.lastPlaybackPositionSavedAt < 5000) {
            return;
        }
        this.lastPlaybackPositionSavedAt = now;

        if (this.currentTime < 5 || this.duration - this.currentTime <= 30) {
            localStorage.removeItem(key);
            return;
        }

        localStorage.setItem(key, String(this.currentTime));
    }

    private restorePlaybackPosition(): void {
        if (this.isPlaybackPositionRestored === true || typeof this.$refs.video === 'undefined') {
            return;
        }

        const key = this.getPlaybackPositionKey();

        if (key === null) {
            return;
        }

        const saved = localStorage.getItem(key);

        if (saved !== null) {
            const time = Number(saved);

            if (!isFinite(time) || time < 5) {
                localStorage.removeItem(key);
                return;
            }

            const duration = this.getVideoDuration();

            /*
             * loadeddata / CM解析取得の順序によっては、
             * 初回呼び出し時点では duration がまだ確定していない。
             * この場合は保存位置を削除せず、後続イベントで再試行する。
             */
            if (!isFinite(duration) || duration <= 0) {
                return;
            }

            if (duration - time <= 30) {
                localStorage.removeItem(key);
                return;
            }

            this.isPlaybackPositionRestored = true;
            this.pendingInitialPlaybackPosition = time;

            (this.$refs.video as BaseVideo).setCurrentTime(time);
            this.currentTime = time;
            this.updateTimeStr();
            this.syncRecordedJikkyoSeek(time);
            this.updateLastSeekTime();
            return;
        }

        /*
         * 保存済み再生位置がない場合は、CM解析の本編開始位置を使う。
         *
         * 解析取得より loadeddata が先に発生する場合があるため、
         * cmAnalysis がまだ無ければ restored にせず、解析取得後に再試行する。
         */
        if (this.cmAnalysis === null || typeof this.cmAnalysis.timeline.playbackStart !== 'number' || !isFinite(this.cmAnalysis.timeline.playbackStart)) {
            return;
        }

        this.isPlaybackPositionRestored = true;

        const playbackStart = Math.max(0, this.cmAnalysis.timeline.playbackStart);

        this.pendingInitialPlaybackPosition = playbackStart;

        (this.$refs.video as BaseVideo).setCurrentTime(playbackStart);
        this.currentTime = playbackStart;
        this.updateTimeStr();
        this.syncRecordedJikkyoSeek(playbackStart);
        this.updateLastSeekTime();
    }

    private clearPlaybackPosition(): void {
        const key = this.getPlaybackPositionKey();
        if (key !== null) {
            localStorage.removeItem(key);
        }
    }

    private syncRecordedJikkyoSeek(time: number): void {
        if (typeof this.$refs.recordedJikkyo !== 'undefined') {
            (this.$refs.recordedJikkyo as RecordedJikkyoOverlay).seek(time);
        }
    }

    /**
     * 実況表示切り替え
     */
    public switchJikkyo(): void {
        this.isJikkyoEnabled = !this.isJikkyoEnabled;
    }

    /**
     * 実況対応チャンネル判定結果
     */
    public onJikkyoAvailability(isAvailable: boolean): void {
        this.isJikkyoAvailable = isAvailable;
    }

    // pip 切り替え
    public switchPip(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        try {
            if ((document as any).pictureInPictureElement === null) {
                (this.$refs.video as BaseVideo).requestPictureInPicture();
            } else {
                (document as any).exitPictureInPicture();
            }
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * 字幕表示切り替え
     */
    public switchSubtitle(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if ((this.$refs.video as BaseVideo).isShowingSubtitle() === true) {
            // 非表示
            this.internalSubtitleState = 'disabled';
            (this.$refs.video as BaseVideo).disabledSubtitle();
        } else {
            // 表示
            this.internalSubtitleState = 'showing';
            (this.$refs.video as BaseVideo).showSubtitle();
        }

        this.videoSetting.tmp.isShowSubtitle = this.internalSubtitleState === 'showing';
        this.videoSetting.save();

        this.updateSubtitleState();
    }

    // fullscreen 切り替え
    public async switchFullScreen(): Promise<void> {
        if (typeof this.$refs.container === 'undefined') {
            return;
        }

        if (this.isFullscreen === true) {
            // フルスクリーン終了
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if ((document as any).mozCancelFullScreen) {
                (document as any).mozCancelFullScreen();
            } else if ((document as any).webkitCancelFullScreen) {
                (document as any).webkitCancelFullScreen();
            } else if ((document as any).msExitFullscreen) {
                (document as any).msExitFullscreen();
            }
        } else {
            // フルスクリーンへ切り替え
            if (this.requestFullscreen(this.$refs.container as HTMLElement) === false && typeof this.$refs.video !== 'undefined') {
                (this.$refs.video as BaseVideo).requestFullscreen();
            }

            // 画面回転
            if (this.isLandscape() === false) {
                await this.switchRotation();
            }
        }
    }

    /**
     * full screen element
     * @param e: HTMLElement
     * @return boolean true: 成功, false: 失敗
     */
    private requestFullscreen(e: HTMLElement): boolean {
        /* tslint:disable:newline-before-return */
        if (UaUtil.isAndroid()) {
            e.requestFullscreen({ navigationUI: 'hide' });
            return true;
        } else if (e.requestFullscreen) {
            e.requestFullscreen();
            return true;
        } else if ((e as any).mozRequestFullScreen) {
            (e as any).mozRequestFullScreen();
            return true;
        } else if ((e as any).webkitRequestFullScreen) {
            (e as any).webkitRequestFullScreen();
            return true;
        } else if ((e as any).webkitEnterFullscreen) {
            (e as any).webkitEnterFullscreen();
            return true;
        } else if ((e as any).msRequestFullscreen) {
            (e as any).msRequestFullscreen();
            return true;
        }
        /* tslint:enable:newline-before-return */

        return false;
    }

    /**
     * full screen 時の画面回転状態を変更
     */
    private async switchRotation(): Promise<void> {
        if (this.isEnabledRotation === false) {
            return;
        }

        try {
            if (this.isLandscape()) {
                await (window.screen as any).orientation.lock('natural');
            } else {
                await (window.screen as any).orientation.lock('landscape');
            }
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * 回転状態か？
     * @return boolean true で回転状態
     */
    private isLandscape(): boolean {
        return !this.isEnabledRotation || (window.screen as any).orientation.angle !== 0;
    }

    /**
     * 回転ボタンクリック時の動作
     * @param e: Event
     */
    public clickRotationButton(e: Event): void {
        e.stopPropagation();
        this.switchRotation();
    }

    public stopPropagation(e: Event): void {
        e.stopPropagation();
    }
}
</script>

<style lang="sass" scoped>
.fade-enter-active, .fade-leave-active
    transition: opacity .2s

.fade-enter, .fade-leave-to
    opacity: 0

.video-container
    position: relative
    max-width: 100%
    background: black

    &:fullscreen
        width: 100%
        height: 100%

    &::before
        content: ""
        display: block
        padding-top: 56.25%

    .add-shadow
        text-shadow: 0px 0px 10px black

    .video-content
        position: absolute
        top: 0
        left: 0
        width: 100%
        height: 100%

    .loading
        z-index: 2
        position: absolute
        height: 100%
        width: 100%
        display: flex
        flex-direction: column
        justify-content: center
        align-items: center

    .video-control-wrap
        z-index: 3
        position: relative
        height: 100%
        width: 100%

        &.hide-cursor
            cursor: none

        .center-buttons
            position: absolute
            top: 50%
            left: 50%
            transform: translateY(-50%) translateX(-50%)
            opacity: 0.8

        .rotation-button
            position: absolute
            top: 8px
            right: 16px

        .left-buttons
            position: absolute
            right: 6px
            top: 50%
            transform: translateY(-50%)
            opacity: 0.8

        .video-control
            height: 60px
            position: absolute
            bottom: 0
            width: 100%
            background: linear-gradient(to top, #000000d9, #0000)
            .content
                position: absolute
                width: 100%
                bottom: 0
                opacity: 0.8
                .volume-content
                    .slider
                        width: 64px
                .time
                    height: 36px
                    line-height: 36px
                    color: white
                    font-size: 12px
                    user-select: none

                .cm-skip-icon.disabled, .subtitle-icon.disabled, .jikkyo-icon.disabled
                    opacity: 0.3

                .seekbar-wrap
                    position: relative

                    .seekbar-analysis
                        position: absolute
                        left: 8px
                        right: 8px
                        top: 14px
                        height: 4px
                        pointer-events: none
                        z-index: 5

                    .seekbar-playback-boundary-range
                        position: absolute
                        top: 0
                        height: 4px
                        background-color: #000000
                        opacity: 1

                    .seekbar-cm-range
                        position: absolute
                        top: 0
                        height: 4px
                        background-color: #ff9800
                        opacity: 0.95

                    .seekbar-chapter-marker
                        position: absolute
                        top: -4px
                        width: 2px
                        height: 12px
                        margin-left: -1px
                        background-color: #2196f3
                        opacity: 0.95

        @media screen and (max-width: 420px)
            .left-buttons
                display: none !important

            .video-control
                .volume-content
                    .slider
                        display: none
                .play
                    display: none

    .video-wrap
        z-index: 1
        position: absolute
        top: 0
        right: 0
        bottom: 0
        left: 0
        margin: auto
        width: 100%
        height: 100%

        .chapter-edit-frame-preview
            position: absolute
            top: 0
            right: 0
            bottom: 0
            left: 0
            width: 100%
            height: 100%
            object-fit: contain
            pointer-events: none
            z-index: 2

        video
            width: 100%
            height: 100%
            &::cue
                color: white
                background-color: rgba(0, 0, 0, 0.6)

    .video-content
        &.is-ipad
            video::cue
                font-size: 26px

// aribb24.js 用に フルスクリーン時に video 要素を 16:9 に固定する
@media (aspect-ratio: 16/9), (min-aspect-ratio: 16/9)
    .video-container
        &:fullscreen
            .video-wrap
                height: 100%
                max-width: 177.7vh

@media (max-aspect-ratio: 16/9)
    .video-container
        &:fullscreen
            .video-wrap
                width: 100%
                max-height: 56.18vw

.seekbar-edit-pin
    position: absolute
    top: 0
    bottom: 0
    width: 2px
    background: #ffcc00
    transform: translateX(-1px)
    z-index: 8
    pointer-events: none

    &.selected
        width: 4px
        background: #ff5252
        transform: translateX(-2px)
</style>

<style lang="sass">
.video-container
    .play-button
        .v-icon
            font-size: 60px
    .slider
        .v-input__slot
            margin: 0
        .v-messages
            display: none

.video-menu
    .v-text-field__details
        display: none
</style>

<template>
    <v-main>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer
                    ref="videoContainer"
                    v-if="videoParam !== null"
                    v-bind:videoParam="videoParam"
                    v-bind:recordedId="recordedId"
                    v-bind:recordedJikkyoVideoFileId="videoFileId"
                    v-bind:chapterEditPins="chapterEditPins"
                    v-bind:chapterEditFrameRate="chapterEditFrameRate"
                    v-bind:chapterEditSelectedIndex="chapterEditSelectedIndex"
                    v-bind:chapterEditEnabled="isChapterEditMode"
                ></VideoContainer>

                <div v-if="recordedId !== null" class="chapter-edit-panel pa-3">
                    <div class="d-flex align-center flex-wrap">
                        <v-btn small v-bind:color="isChapterEditMode ? 'primary' : undefined" v-on:click="toggleChapterEditMode">
                            チャプター編集
                            {{ isChapterEditMode ? 'ON' : 'OFF' }}
                        </v-btn>

                        <template v-if="isChapterEditMode">
                            <span class="ml-3">
                                現在:
                                {{ chapterEditCurrentFrameText }}
                            </span>

                            <span v-if="chapterEditSelectedIndex !== null" class="ml-3">
                                選択:
                                {{ selectedPinText }}
                            </span>
                        </template>
                    </div>

                    <template v-if="isChapterEditMode">
                        <div class="d-flex align-center flex-wrap mt-3">
                            <v-btn
                                small
                                class="mr-2"
                                v-on:mousedown="startFrameStep(-1)"
                                v-on:mouseup="stopFrameStep"
                                v-on:mouseleave="stopFrameStep"
                                v-on:touchstart.prevent="startFrameStep(-1)"
                                v-on:touchend.prevent="stopFrameStep"
                            >
                                &#9664;
                            </v-btn>

                            <v-btn
                                small
                                class="mr-4"
                                v-on:mousedown="startFrameStep(1)"
                                v-on:mouseup="stopFrameStep"
                                v-on:mouseleave="stopFrameStep"
                                v-on:touchstart.prevent="startFrameStep(1)"
                                v-on:touchend.prevent="stopFrameStep"
                            >
                                &#9654;
                            </v-btn>

                            <v-btn small color="primary" class="mr-4 mb-1" v-on:click="insertChapterPin">チャプター挿入</v-btn>

                            <v-btn small class="mr-2 mb-1" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="changeSelectedPinType('chapter')">チャプター</v-btn>

                            <v-btn small class="mr-2 mb-1" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="changeSelectedPinType('main-start')">本編開始</v-btn>

                            <v-btn small class="mr-2 mb-1" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="changeSelectedPinType('cm-start')">CM開始</v-btn>

                            <v-btn small class="mr-2 mb-1" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="changeSelectedPinType('cm-end')">CM終了</v-btn>

                            <v-btn small class="mr-2 mb-1" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="changeSelectedPinType('main-end')">本編終了</v-btn>
                        </div>

                        <div class="d-flex align-center flex-wrap mt-2">
                            <v-btn small class="mr-2" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="moveSelectedPinToCurrentFrame">現在位置へ移動</v-btn>

                            <v-btn small color="error" class="mr-4" v-bind:disabled="chapterEditSelectedIndex === null" v-on:click="deleteSelectedPin">削除</v-btn>

                            <v-btn small color="primary" class="mr-2" v-bind:loading="isChapterEditSaving" v-on:click="saveChapterEdit">保存</v-btn>

                            <v-btn small v-bind:disabled="hasAutomaticAnalysis === false" v-on:click="restoreAutomaticAnalysis">自動解析へ戻す</v-btn>
                        </div>

                        <div v-if="chapterEditPins.length > 0" class="chapter-edit-pins mt-3">
                            <v-chip
                                v-for="(pin, index) in sortedChapterEditPins"
                                :key="pin.type + '-' + pin.frame + '-' + index"
                                small
                                class="mr-2 mb-2"
                                v-bind:outlined="chapterEditSelectedIndex !== pin.originalIndex"
                                v-on:click="selectChapterEditPin(pin.originalIndex)"
                            >
                                {{ pinLabel(pin.type) }}
                                @ {{ pin.frame }}
                            </v-chip>
                        </div>
                    </template>
                </div>
                <WatchOnRecordedInfoCard
                    v-if="recordedId !== null && videoFileId !== null"
                    v-bind:recordedId="recordedId"
                    v-bind:videoFileId="videoFileId"
                ></WatchOnRecordedInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, NormalVideoParam } from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import ICmAnalyzerApiModel, { CmAnalyzerManualPinType, ICmAnalyzerAnalysis, ICmAnalyzerManualPin } from '@/model/api/cmAnalyzer/ICmAnalyzerApiModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnRecordedInfoCard,
    },
})
export default class WatchRecorded extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public recordedId: apid.RecordedId | null = null;
    public videoFileId: apid.VideoFileId | null = null;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');

    private cmAnalyzerApiModel: ICmAnalyzerApiModel = container.get<ICmAnalyzerApiModel>('ICmAnalyzerApiModel');

    public isChapterEditMode: boolean = false;
    public isChapterEditSaving: boolean = false;
    public chapterEditPins: ICmAnalyzerManualPin[] = [];
    public chapterEditFrameRate: number | null = null;
    public chapterEditSelectedIndex: number | null = null;
    public hasAutomaticAnalysis: boolean = false;

    private frameStepTimer: number | null = null;
    private frameStepStartTimer: number | null = null;
    private frameStepLastPreviewTime: number = 0;
    private frameStepPreviewInterval: number = 120;

    private get videoContainer(): VideoContainer | null {
        const ref = this.$refs.videoContainer;

        return typeof ref === 'undefined' ? null : (ref as VideoContainer);
    }

    public get chapterEditCurrentFrameText(): string {
        const video = this.videoContainer;

        if (video === null) {
            return '-';
        }

        const frame = video.getChapterEditCurrentFrame();

        return frame === null ? '-' : frame.toString(10);
    }

    public get selectedPinText(): string {
        if (this.chapterEditSelectedIndex === null || !this.chapterEditPins[this.chapterEditSelectedIndex]) {
            return '-';
        }

        const pin = this.chapterEditPins[this.chapterEditSelectedIndex];

        return `${this.pinLabel(pin.type)} @ ${pin.frame}`;
    }

    public get sortedChapterEditPins(): Array<
        ICmAnalyzerManualPin & {
            originalIndex: number;
        }
    > {
        return this.chapterEditPins
            .map((pin, originalIndex) => ({
                ...pin,
                originalIndex,
            }))
            .sort((a, b) => a.frame - b.frame);
    }

    public pinLabel(type: CmAnalyzerManualPinType): string {
        switch (type) {
            case 'chapter':
                return 'チャプター';
            case 'main-start':
                return '本編開始';
            case 'cm-start':
                return 'CM開始';
            case 'cm-end':
                return 'CM終了';
            case 'main-end':
                return '本編終了';
            default:
                return type;
        }
    }

    public async toggleChapterEditMode(): Promise<void> {
        if (this.isChapterEditMode) {
            this.stopFrameStep(false);
            this.isChapterEditMode = false;
            this.chapterEditSelectedIndex = null;
            return;
        }

        const video = this.videoContainer;

        if (video === null) {
            return;
        }

        let analysis = video.getChapterEditAnalysis();

        if (analysis === null && this.recordedId !== null) {
            analysis = await this.cmAnalyzerApiModel.getAnalysis(this.recordedId);
        }

        if (analysis === null) {
            window.alert('CM解析結果がありません。手動編集のみの初期化は次段階で対応します。');
            return;
        }

        const frameRate = analysis.timeline && typeof analysis.timeline.frameRate === 'number' ? analysis.timeline.frameRate : null;

        if (frameRate === null || !isFinite(frameRate) || frameRate <= 0) {
            window.alert('動画のフレームレートを取得できません。');
            return;
        }

        this.chapterEditFrameRate = frameRate;

        const manual = analysis.manualTimeline;

        this.chapterEditPins =
            manual && Array.isArray(manual.pins)
                ? manual.pins.map(pin => ({
                      frame: pin.frame,
                      type: pin.type,
                  }))
                : [];

        this.hasAutomaticAnalysis = manual ? manual.hasAutomaticAnalysis : true;

        this.chapterEditSelectedIndex = null;

        this.isChapterEditMode = true;
    }

    public insertChapterPin(): void {
        const video = this.videoContainer;

        if (video === null) {
            return;
        }

        const frame = video.getChapterEditCurrentFrame();

        if (frame === null) {
            return;
        }

        this.chapterEditPins.push({
            frame,
            type: 'chapter',
        });

        this.chapterEditSelectedIndex = this.chapterEditPins.length - 1;
    }

    public changeSelectedPinType(type: CmAnalyzerManualPinType): void {
        if (this.chapterEditSelectedIndex === null) {
            return;
        }

        const index = this.chapterEditSelectedIndex;
        const pin = this.chapterEditPins[index];

        if (!pin) {
            this.chapterEditSelectedIndex = null;
            return;
        }

        this.$set(this.chapterEditPins, index, {
            ...pin,
            type,
        });
    }

    public selectChapterEditPin(index: number): void {
        if (this.chapterEditSelectedIndex === index) {
            this.chapterEditSelectedIndex = null;
            return;
        }

        const pin = this.chapterEditPins[index];

        if (!pin) {
            return;
        }

        this.chapterEditSelectedIndex = index;

        const video = this.videoContainer;

        if (video !== null) {
            video.seekChapterEditFrame(pin.frame);
        }
    }

    public moveSelectedPinToCurrentFrame(): void {
        if (this.chapterEditSelectedIndex === null) {
            return;
        }

        const video = this.videoContainer;

        if (video === null) {
            return;
        }

        const frame = video.getChapterEditCurrentFrame();

        if (frame === null) {
            return;
        }

        const index = this.chapterEditSelectedIndex;

        const pin = this.chapterEditPins[index];

        if (!pin) {
            return;
        }

        this.$set(this.chapterEditPins, index, {
            ...pin,
            frame,
        });
    }

    public deleteSelectedPin(): void {
        if (this.chapterEditSelectedIndex === null) {
            return;
        }

        this.chapterEditPins.splice(this.chapterEditSelectedIndex, 1);

        this.chapterEditSelectedIndex = null;
    }

    public startFrameStep(delta: number): void {
        this.stopFrameStep(false);

        this.frameStepLastPreviewTime = Date.now();
        this.stepFrame(delta, true);

        this.frameStepStartTimer = window.setTimeout(() => {
            this.frameStepTimer = window.setInterval(() => {
                const now = Date.now();
                const updatePreview = now - this.frameStepLastPreviewTime >= this.frameStepPreviewInterval;

                this.stepFrame(delta, updatePreview);

                if (updatePreview) {
                    this.frameStepLastPreviewTime = now;
                }
            }, 45);
        }, 350);
    }

    public stopFrameStep(refreshPreview: boolean = true): void {
        const wasRepeating = this.frameStepTimer !== null;

        if (this.frameStepStartTimer !== null) {
            window.clearTimeout(this.frameStepStartTimer);
            this.frameStepStartTimer = null;
        }

        if (this.frameStepTimer !== null) {
            window.clearInterval(this.frameStepTimer);
            this.frameStepTimer = null;
        }

        if (refreshPreview && wasRepeating) {
            const video = this.videoContainer;

            if (video !== null) {
                video.refreshChapterEditFramePreview();
            }
        }
    }

    private stepFrame(delta: number, updatePreview: boolean): void {
        const video = this.videoContainer;

        if (video !== null) {
            video.stepChapterEditFrame(delta, updatePreview);
        }

        this.$forceUpdate();
    }

    public async saveChapterEdit(): Promise<void> {
        if (this.recordedId === null || this.chapterEditFrameRate === null) {
            return;
        }

        const video = this.videoContainer;

        if (video === null) {
            return;
        }

        const duration = video.getChapterEditDuration();

        if (!isFinite(duration) || duration <= 0) {
            window.alert('動画の長さを取得できません。');
            return;
        }

        this.isChapterEditSaving = true;

        try {
            const analysis = await this.cmAnalyzerApiModel.saveManualTimeline(this.recordedId, this.chapterEditFrameRate, duration, this.chapterEditPins);

            this.applySavedAnalysis(analysis);

            await video.reloadChapterEditAnalysis();
        } catch (err) {
            window.alert(err instanceof Error ? err.message : '手動タイムラインの保存に失敗しました。');
        } finally {
            this.isChapterEditSaving = false;
        }
    }

    public async restoreAutomaticAnalysis(): Promise<void> {
        if (this.recordedId === null || this.hasAutomaticAnalysis === false) {
            return;
        }

        if (!window.confirm('手動編集を破棄して自動解析へ戻しますか？')) {
            return;
        }

        const video = this.videoContainer;

        try {
            const analysis = await this.cmAnalyzerApiModel.restoreAutomaticAnalysis(this.recordedId);

            if (analysis !== null) {
                this.applySavedAnalysis(analysis);
            } else {
                this.chapterEditPins = [];
            }

            this.chapterEditSelectedIndex = null;

            if (video !== null) {
                await video.reloadChapterEditAnalysis();
            }
        } catch (err) {
            window.alert(err instanceof Error ? err.message : '自動解析への復元に失敗しました。');
        }
    }

    private applySavedAnalysis(analysis: ICmAnalyzerAnalysis): void {
        const manual = analysis.manualTimeline;

        if (manual) {
            this.chapterEditPins = manual.pins.map(pin => ({
                frame: pin.frame,
                type: pin.type,
            }));

            this.hasAutomaticAnalysis = manual.hasAutomaticAnalysis;
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.stopFrameStep(false);
        this.isChapterEditMode = false;
        this.chapterEditPins = [];
        this.chapterEditFrameRate = null;
        this.chapterEditSelectedIndex = null;
        this.hasAutomaticAnalysis = false;

        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);
        this.videoFileId = videoId;
        this.recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);

        this.$nextTick(async () => {
            if (videoId !== null) {
                (this.videoParam as NormalVideoParam) = {
                    type: 'Normal',
                    src: `./api/videos/${videoId}`,
                    videoFileId: videoId,
                };
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>

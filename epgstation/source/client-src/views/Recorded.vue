<template>
    <v-main>
        <EditTitleBar
            v-if="isEditMode === true"
            :title="selectedTitle"
            :isEditMode.sync="isEditMode"
            v-on:exit="onFinishEdit"
            v-on:selectall="onSelectAll"
            :isShowEncode="true"
            :isEncodeDisabled="recordedState.getSelectedCnt().cnt === 0"
            v-on:encode="onMultipleEncode"
            :isShowJikkyo="true"
            :isJikkyoDisabled="recordedState.getSelectedCnt().cnt === 0"
            v-on:jikkyo="onMultipleJikkyo"
            :isShowRepair="true"
            :isRepairDisabled="recordedState.getSelectedCnt().cnt === 0 || isBulkMaintenanceRunning"
            v-on:repair="onMultipleRepair"
            :isShowChapters="true"
            :isChaptersDisabled="recordedState.getSelectedCnt().cnt === 0 || isBulkMaintenanceRunning"
            v-on:chapters="onMultipleChapters"
            v-on:delete="onMultiplueDeletion"
        ></EditTitleBar>
        <TitleBar v-else title="録画済み">
            <template v-slot:menu>
                <RecordedSearchMenu></RecordedSearchMenu>
                <RecordedMainMenu v-on:edit="onEdit" v-on:cleanup="onCleanup"></RecordedMainMenu>
            </template>
        </TitleBar>

        <v-card v-if="bulkMaintenanceJob !== null" class="ma-2 pa-3 maintenance-status" outlined>
            <div class="d-flex align-center">
                <div class="subtitle-2 font-weight-bold">
                    {{ maintenanceActionLabel }}
                    <span v-if="bulkMaintenanceJob.state === 'running'">実行中</span>
                    <span v-else-if="bulkMaintenanceJob.state === 'completed'">完了</span>
                    <span v-else-if="bulkMaintenanceJob.state === 'canceled'">キャンセル済み</span>
                    <span v-else>失敗</span>
                </div>
                <v-spacer></v-spacer>
                <v-btn
                    v-if="bulkMaintenanceJob.state === 'running'"
                    x-small
                    text
                    class="mr-2"
                    :loading="isCancelingBulkMaintenance"
                    :disabled="isCancelingBulkMaintenance"
                    v-on:click="cancelBulkMaintenance"
                >
                    <v-icon x-small class="mr-1">mdi-cancel</v-icon>
                    キャンセル
                </v-btn>
                <div class="caption">{{ bulkMaintenanceJob.completed }} / {{ bulkMaintenanceJob.total }}件</div>
            </div>
            <v-progress-linear class="mt-2" :value="maintenanceProgress" :indeterminate="bulkMaintenanceJob.total === 0"></v-progress-linear>
            <div v-if="bulkMaintenanceJob.currentTitle !== null" class="body-2 mt-2">
                現在: {{ bulkMaintenanceJob.currentTitle }}
                <span v-if="bulkMaintenanceJob.currentState !== null">/ {{ maintenanceStateLabel(bulkMaintenanceJob.currentState) }}</span>
            </div>
            <div v-if="bulkMaintenanceJob.failed > 0" class="caption error--text mt-1">失敗: {{ bulkMaintenanceJob.failed }}件</div>
            <div class="maintenance-items mt-2">
                <div v-for="item in bulkMaintenanceJob.items" :key="item.recordedId" class="caption text-truncate" :title="item.message || ''">
                    <v-icon x-small class="mr-1">{{ maintenanceStateIcon(item.state) }}</v-icon>
                    {{ item.title }}: {{ maintenanceStateLabel(item.state) }}
                </div>
            </div>
        </v-card>

        <v-card v-if="maintenanceStatuses.length > 0" class="ma-2 pa-3 maintenance-status" outlined>
            <div class="subtitle-2 font-weight-bold">処理状態</div>
            <div v-for="status in maintenanceStatuses" :key="`${status.recordedId}-${status.action}`" class="caption d-flex align-center mt-1">
                <div class="text-truncate">
                    <v-icon x-small class="mr-1">{{ maintenanceStateIcon(status.state) }}</v-icon>
                    #{{ status.recordedId }} {{ status.action === 'repair' ? '録画修復' : 'チャプター再作成' }}:
                    {{ maintenanceStateLabel(status.state) }}
                </div>
                <v-btn
                    v-if="canCancelMaintenance(status)"
                    x-small
                    text
                    class="ml-2"
                    :loading="isCancelingMaintenance(status)"
                    :disabled="isCancelingMaintenance(status)"
                    v-on:click="cancelMaintenance(status)"
                >
                    <v-icon x-small>mdi-cancel</v-icon>
                    キャンセル
                </v-btn>
            </div>
        </v-card>

        <transition name="page">
            <div v-if="settingValue !== null && recordedState.getRecorded().length > 0" ref="appContent" class="app-content pa-1">
                <div v-bind:style="contentWrapStyle">
                    <RecordedItems
                        :recorded="recordedState.getRecorded()"
                        v-on:detail="gotoDetail"
                        v-on:stopEncode="stopEncode"
                        v-on:selected="selectItem"
                        :isTableMode="settingValue.isShowTableMode === true"
                        :isEditMode.sync="isEditMode"
                        :isShowDropInfo="settingValue.isShowDropInfoInsteadOfDescription"
                    ></RecordedItems>
                    <Pagination v-if="isEditMode === false" :total="recordedState.getTotal()" :pageSize="settingValue.recordedLength"></Pagination>
                    <div style="visibility: hidden">dummy</div>
                </div>
            </div>
        </transition>
        <RecordedMultipleDeletionDialog
            v-if="isEditMode === true"
            :isOpen.sync="isOpenMultiplueDeletionDialog"
            :total="recordedState.getSelectedCnt().cnt"
            v-on:delete="onExecuteMultiplueDeletion"
        ></RecordedMultipleDeletionDialog>
        <AddMultipleEncodeDialog
            v-if="isEditMode === true"
            :isOpen.sync="isOpenMultipleEncodeDialog"
            :recorded="recordedState.getSelectedRecorded()"
            v-on:complete="onMultipleEncodeComplete"
        ></AddMultipleEncodeDialog>
        <GenerateMultipleJikkyoDialog
            v-if="isEditMode === true"
            :isOpen.sync="isOpenMultipleJikkyoDialog"
            :recorded="recordedState.getSelectedRecorded()"
            v-on:complete="onMultipleJikkyoComplete"
        ></GenerateMultipleJikkyoDialog>
        <RecordedCleanupDialog :isOpen.sync="isOpenCleanupDialog"></RecordedCleanupDialog>
    </v-main>
</template>

<script lang="ts">
import AddMultipleEncodeDialog from '@/components/encode/AddMultipleEncodeDialog.vue';
import GenerateMultipleJikkyoDialog from '@/components/recorded/GenerateMultipleJikkyoDialog.vue';
import Pagination from '@/components/pagination/Pagination.vue';
import RecordedCleanupDialog from '@/components/recorded/RecordedCleanupDialog.vue';
import RecordedItems from '@/components/recorded/RecordedItems.vue';
import RecordedMainMenu from '@/components/recorded/RecordedMainMenu.vue';
import RecordedMultipleDeletionDialog from '@/components/recorded/RecordedMultipleDeletionDialog.vue';
import RecordedSearchMenu from '@/components/recorded/RecordedSearchMenu.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import IRecordedApiModel, {
    RecordedMaintenanceBulkAction,
    RecordedMaintenanceBulkItemState,
    RecordedMaintenanceBulkJob,
    RecordedMaintenanceStatus,
} from '@/model/api/recorded/IRecordedApiModel';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedState, { MultipleDeletionOption } from '@/model/state/recorded/IRecordedState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        AddMultipleEncodeDialog,
        GenerateMultipleJikkyoDialog,
        TitleBar,
        EditTitleBar,
        RecordedSearchMenu,
        RecordedMainMenu,
        RecordedItems,
        Pagination,
        RecordedMultipleDeletionDialog,
        RecordedCleanupDialog,
    },
})
export default class Recorded extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;
    public isOpenMultipleEncodeDialog: boolean = false;
    public isOpenMultipleJikkyoDialog: boolean = false;
    public isOpenCleanupDialog: boolean = false;
    public bulkMaintenanceJob: RecordedMaintenanceBulkJob | null = null;
    public maintenanceStatuses: RecordedMaintenanceStatus[] = [];
    public cancelingMaintenanceKeys: string[] = [];
    public isCancelingBulkMaintenance: boolean = false;

    private isVisibilityHidden: boolean = false;
    private maintenancePollTimer: number | null = null;
    private isMaintenanceStatusInitialized: boolean = false;
    private recordedState: IRecordedState = container.get<IRecordedState>('IRecordedState');
    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.recordedState.fetchData(this.createFetchDataOption());
    }).bind(this);
    private onUpdateMaintenanceCallback = (async (): Promise<void> => {
        await this.fetchMaintenanceStatus();
    }).bind(this);

    get selectedTitle(): string {
        const info = this.recordedState.getSelectedCnt();
        return `${info.cnt} 件選択 (${Util.getFileSizeStr(info.size)})`;
    }

    get isBulkMaintenanceRunning(): boolean {
        return this.bulkMaintenanceJob !== null && this.bulkMaintenanceJob.state === 'running';
    }

    get activeMaintenanceStatuses(): RecordedMaintenanceStatus[] {
        return this.maintenanceStatuses.filter(status => status.state !== 'completed' && status.state !== 'failed' && status.state !== 'canceled');
    }

    get maintenanceActionLabel(): string {
        if (this.bulkMaintenanceJob === null) {
            return '';
        }
        return this.bulkMaintenanceJob.action === 'repair' ? '録画修復' : 'チャプター再作成';
    }

    get maintenanceProgress(): number {
        if (this.bulkMaintenanceJob === null || this.bulkMaintenanceJob.total === 0) {
            return 0;
        }
        return (this.bulkMaintenanceJob.completed / this.bulkMaintenanceJob.total) * 100;
    }

    get contentWrapStyle(): any {
        return this.isVisibilityHidden === false
            ? {}
            : {
                  opacity: 0,
                  visibility: 'hidden',
              };
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.onUpdateRecordedMaintenance(this.onUpdateMaintenanceCallback);
        this.fetchMaintenanceStatus().catch(err => console.error(err));
    }

    public beforeDestroy(): void {
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.offUpdateRecordedMaintenance(this.onUpdateMaintenanceCallback);
        this.stopMaintenancePolling();
    }

    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.isVisibilityHidden = true;
        this.$nextTick(() => next());
    }

    public gotoDetail(recordedId: apid.RecordedId): void {
        Util.move(this.$router, { path: `/recorded/detail/${recordedId.toString(10)}` });
    }

    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        try {
            await this.recordedState.stopEncode(recordedId);
            this.snackbarState.open({ color: 'success', text: 'エンコード停止' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'エンコード停止に失敗' });
        }
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.recordedState.clearSelect();
    }

    public onSelectAll(): void {
        this.recordedState.selectAll();
    }

    public selectItem(recordedId: apid.RecordedId): void {
        this.recordedState.select(recordedId);
    }

    public onMultipleEncode(): void {
        if (this.recordedState.getSelectedCnt().cnt === 0) return;
        this.isOpenMultipleEncodeDialog = true;
    }

    public onMultipleEncodeComplete(result: { success: number; failed: number }): void {
        this.isOpenMultipleEncodeDialog = false;
        this.isEditMode = false;
        this.recordedState.clearSelect();
        this.snackbarState.open({
            color: result.failed === 0 ? 'success' : 'error',
            text: result.failed === 0 ? `${result.success} 件のエンコードを追加しました。` : `${result.success} 件追加、${result.failed} 件失敗しました。`,
        });
    }

    public onMultipleJikkyo(): void {
        if (this.recordedState.getSelectedCnt().cnt === 0) return;
        this.isOpenMultipleJikkyoDialog = true;
    }

    public onMultipleJikkyoComplete(result: { updated: number; preserved: number; failed: number }): void {
        this.isOpenMultipleJikkyoDialog = false;
        this.isEditMode = false;
        this.recordedState.clearSelect();
        this.snackbarState.open({
            color: result.failed === 0 ? 'success' : 'error',
            text: `実況XML取得結果: 更新 ${result.updated} 件 / 既存保持 ${result.preserved} 件 / 失敗 ${result.failed} 件`,
        });
        this.recordedState.fetchData(this.createFetchDataOption()).catch(err => console.error(err));
    }

    public async onMultipleRepair(): Promise<void> {
        await this.startBulkMaintenance('repair');
    }

    public async onMultipleChapters(): Promise<void> {
        await this.startBulkMaintenance('chapters');
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(option: MultipleDeletionOption): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.recordedState.multiplueDeletion(option);
            this.snackbarState.open({ color: 'success', text: '選択した番組を削除しました。' });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '一部番組の削除に失敗しました。' });
        }
    }

    public onCleanup(): void {
        this.isOpenCleanupDialog = true;
    }

    public maintenanceStateLabel(state: RecordedMaintenanceBulkItemState): string {
        switch (state) {
            case 'queued':
                return '待機中';
            case 'checking':
                return 'TS検査中';
            case 'repairing':
                return 'TS修復中';
            case 'rebuilding-chapters':
                return 'チャプター再作成中';
            case 'completed':
                return '完了';
            case 'failed':
                return '失敗';
            case 'canceled':
                return 'キャンセル済み';
        }
    }

    public maintenanceStateIcon(state: RecordedMaintenanceBulkItemState): string {
        switch (state) {
            case 'completed':
                return 'mdi-check-circle';
            case 'failed':
                return 'mdi-alert-circle';
            case 'canceled':
                return 'mdi-cancel';
            case 'queued':
                return 'mdi-clock-outline';
            default:
                return 'mdi-progress-clock';
        }
    }

    public canCancelMaintenance(status: RecordedMaintenanceStatus): boolean {
        return status.origin === 'manual' && status.state !== 'completed' && status.state !== 'failed' && status.state !== 'canceled';
    }

    public isCancelingMaintenance(status: RecordedMaintenanceStatus): boolean {
        return this.cancelingMaintenanceKeys.indexOf(`${status.recordedId}:${status.action}`) !== -1;
    }

    public async cancelMaintenance(status: RecordedMaintenanceStatus): Promise<void> {
        if (!this.canCancelMaintenance(status) || this.isCancelingMaintenance(status)) {
            return;
        }

        const key = `${status.recordedId}:${status.action}`;
        this.cancelingMaintenanceKeys.push(key);

        try {
            await this.recordedApiModel.cancelMaintenance(status.recordedId, status.action);
            await this.fetchMaintenanceStatus();
            this.snackbarState.open({
                color: 'success',
                text: 'キャンセルを要求しました',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'キャンセルに失敗しました',
            });
        } finally {
            this.cancelingMaintenanceKeys = this.cancelingMaintenanceKeys.filter(item => item !== key);
        }
    }

    public async cancelBulkMaintenance(): Promise<void> {
        if (!this.isBulkMaintenanceRunning || this.isCancelingBulkMaintenance) {
            return;
        }

        this.isCancelingBulkMaintenance = true;

        try {
            this.bulkMaintenanceJob = await this.recordedApiModel.cancelBulkMaintenanceJob();
            await this.fetchMaintenanceStatus();
            this.snackbarState.open({
                color: 'success',
                text: '一括処理のキャンセルを要求しました',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '一括処理をキャンセルできませんでした',
            });
        } finally {
            this.isCancelingBulkMaintenance = false;
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordedState.clearData();
        this.$nextTick(async () => {
            await this.recordedState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({ color: 'error', text: '録画データ取得に失敗' });
                console.error(err);
            });
            this.isVisibilityHidden = false;
            await this.scrollState.emitDoneGetData();
        });
    }

    private async startBulkMaintenance(action: RecordedMaintenanceBulkAction): Promise<void> {
        const selected = this.recordedState.getSelectedRecorded();
        const recordedIds = selected.map(item => item.recordedItem.id);
        if (recordedIds.length === 0 || this.isBulkMaintenanceRunning) {
            return;
        }

        try {
            this.bulkMaintenanceJob = await this.recordedApiModel.startBulkMaintenanceJob(action, recordedIds);
            this.isEditMode = false;
            this.recordedState.clearSelect();
            this.updateMaintenancePolling();
            this.snackbarState.open({
                color: 'success',
                text: action === 'repair' ? '一括録画修復を開始しました' : '一括チャプター再作成を開始しました',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '一括処理を開始できませんでした' });
            await this.fetchMaintenanceStatus().catch(() => undefined);
        }
    }

    private async fetchMaintenanceStatus(): Promise<void> {
        const info = await this.recordedApiModel.getMaintenanceInfo();

        if (this.isMaintenanceStatusInitialized === false) {
            this.bulkMaintenanceJob = info.job !== null && info.job.state === 'running' ? info.job : null;

            this.maintenanceStatuses = info.statuses.filter(status => status.state !== 'completed' && status.state !== 'failed' && status.state !== 'canceled');

            this.isMaintenanceStatusInitialized = true;
        } else {
            const visibleKeys = new Set(this.maintenanceStatuses.map(status => `${status.recordedId}:${status.action}`));

            this.maintenanceStatuses = info.statuses.filter(status => {
                const key = `${status.recordedId}:${status.action}`;

                return (status.state !== 'completed' && status.state !== 'failed' && status.state !== 'canceled') || visibleKeys.has(key);
            });

            if (info.job !== null) {
                if (info.job.state === 'running' || this.bulkMaintenanceJob === null || this.bulkMaintenanceJob.id === info.job.id) {
                    this.bulkMaintenanceJob = info.job;
                }
            }
        }

        this.updateMaintenancePolling();
    }

    private updateMaintenancePolling(): void {
        if ((this.isBulkMaintenanceRunning || this.activeMaintenanceStatuses.length > 0) && this.maintenancePollTimer === null) {
            this.maintenancePollTimer = window.setInterval(() => {
                this.fetchMaintenanceStatus().catch(err => console.error(err));
            }, 2000);
        } else if (!this.isBulkMaintenanceRunning && this.activeMaintenanceStatuses.length === 0) {
            this.stopMaintenancePolling();
        }
    }

    private stopMaintenancePolling(): void {
        if (this.maintenancePollTimer !== null) {
            window.clearInterval(this.maintenancePollTimer);
            this.maintenancePollTimer = null;
        }
    }

    private createFetchDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const option: apid.GetRecordedOption = {
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.recordedLength,
            limit: this.settingValue.recordedLength,
        };

        if (typeof this.$route.query.keyword === 'string') option.keyword = this.$route.query.keyword;
        if (typeof this.$route.query.ruleId !== 'undefined') option.ruleId = parseInt(this.$route.query.ruleId as string, 10);
        if (typeof this.$route.query.channelId !== 'undefined') option.channelId = parseInt(this.$route.query.channelId as string, 10);
        if (typeof this.$route.query.genre !== 'undefined') option.genre = parseInt(this.$route.query.genre as string, 10);
        if (typeof this.$route.query.hasOriginalFile !== 'undefined') {
            option.hasOriginalFile = (this.$route.query.hasOriginalFile as any) === true || this.$route.query.hasOriginalFile === 'true';
        }

        return option;
    }
}
</script>

<style lang="sass" scoped>
.maintenance-status
    max-width: 1000px
    margin-left: auto !important
    margin-right: auto !important

.maintenance-items
    max-height: 180px
    overflow-y: auto
</style>

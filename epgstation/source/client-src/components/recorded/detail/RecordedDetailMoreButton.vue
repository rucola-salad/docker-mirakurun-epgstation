<template>
    <div>
        <v-menu v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="openDownloadDialog">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-download</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>download</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item v-if="typeof recordedItem.ruleId !== 'undefined'" v-on:click="gotoRule">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-calendar</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>rule</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="search">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-magnify</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>search</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item :disabled="isRepairing" v-on:click="repairRecording">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-tools</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>録画修復</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item :disabled="isRebuildingChapters" v-on:click="rebuildChapters">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-format-list-bulleted</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>チャプター再作成</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item v-if="recordedItem.isProtected === true" v-on:click="unprotect">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-lock-open</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>unprotect</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item v-else v-on:click="protect">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-lock</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>protect</v-list-item-title></v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog">
                    <v-list-item-icon class="mr-3"><v-icon>mdi-delete</v-icon></v-list-item-icon>
                    <v-list-item-content><v-list-item-title>delete</v-list-item-title></v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
        <RecordedDownloadDialog
            :isOpen.sync="isOpenDownloadDialog"
            :recordedItem="recordedItem"
            v-on:download="downloadVideo"
            v-on:downloadPlayList="downloadPlayList"
        ></RecordedDownloadDialog>
        <RecordedDeleteDialog
            :isOpen.sync="isOpenDeleteDialog"
            :recordedItem="recordedItem"
            :isDelaySnackbarViewNum="800"
            v-on:deleteSuccessful="deleteSuccessful"
        ></RecordedDeleteDialog>
    </div>
</template>

<script lang="ts">
import RecordedDeleteDialog from '@/components/recorded/RecordedDeleteDialog.vue';
import RecordedDownloadDialog from '@/components/recorded/RecordedDownloadDialog.vue';
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import StrUtil from '@/util/StrUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        RecordedDownloadDialog,
        RecordedDeleteDialog,
    },
})
export default class RecordedDetailMoreButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    public isOpened: boolean = false;
    public isOpenDeleteDialog: boolean = false;
    public isOpenDownloadDialog: boolean = false;
    public isRepairing: boolean = false;
    public isRebuildingChapters: boolean = false;

    public recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public async openDownloadDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDownloadDialog = true;
    }

    public async gotoRule(): Promise<void> {
        if (typeof this.recordedItem.ruleId === 'undefined') {
            return;
        }
        await Util.sleep(300);
        Util.move(this.$router, {
            path: '/search',
            query: { rule: this.recordedItem.ruleId.toString(10) },
        });
    }

    public async repairRecording(): Promise<void> {
        if (this.isRepairing) {
            return;
        }
        this.isRepairing = true;
        this.isOpened = false;
        this.snackbarState.open({ color: 'info', text: 'TSを検査しています' });
        try {
            const result = await this.recordedApiModel.repair(this.recordedItem.id);
            this.snackbarState.open({
                color: 'success',
                text: result.repaired ? '録画のTS修復が完了しました' : 'TSを検査しました。修復の必要はありません',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: '録画修復に失敗しました' });
        } finally {
            this.isRepairing = false;
        }
    }

    public async rebuildChapters(): Promise<void> {
        if (this.isRebuildingChapters) {
            return;
        }
        this.isRebuildingChapters = true;
        this.isOpened = false;
        try {
            const result = await this.recordedApiModel.rebuildChapters(this.recordedItem.id);
            this.snackbarState.open({
                color: 'success',
                text: `チャプター再作成を開始しました (${result.sourceName})`,
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'チャプター再作成に失敗しました' });
        } finally {
            this.isRebuildingChapters = false;
        }
    }

    public async unprotect(): Promise<void> {
        try {
            await this.recordedApiModel.unprotect(this.recordedItem.id);
            this.snackbarState.open({ color: 'success', text: '保護解除に成功' });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '保護解除に失敗' });
        }
    }

    public async protect(): Promise<void> {
        try {
            await this.recordedApiModel.protect(this.recordedItem.id);
            this.snackbarState.open({ color: 'success', text: '保護に成功' });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '保護に失敗' });
        }
    }

    public async search(): Promise<void> {
        await Util.sleep(300);
        if (typeof this.recordedItem.ruleId !== 'undefined') {
            Util.move(this.$router, {
                path: '/recorded',
                query: { ruleId: this.recordedItem.ruleId.toString(10) },
            });
        }
        Util.move(this.$router, {
            path: '/recorded',
            query: { keyword: StrUtil.createSearchKeyword(this.recordedItem.name) },
        });
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();
        return false;
    }

    public deleteSuccessful(deleteSuccessful: boolean): void {
        if (deleteSuccessful === true) {
            this.$router.back();
        }
    }

    public downloadVideo(video: apid.VideoFile): void {
        this.$emit('download', video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        this.$emit('downloadPlayList', video);
    }
}
</script>

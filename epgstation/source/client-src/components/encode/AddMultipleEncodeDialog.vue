<template>
    <v-dialog v-model="dialogModel" max-width="500" scrollable>
        <v-card>
            <v-card-title>一括エンコード</v-card-title>

            <div class="pa-3 pt-0 add-encode">
                <div class="subtitle-1 mb-2">{{ recorded.length }} 件をエンコード登録</div>

                <v-select :items="encodeList" v-model="encodeMode" label="preset" :menu-props="{ auto: true }"></v-select>

                <div class="directory">
                    <v-select
                        :items="parentDirectoryList"
                        v-model="parentDirectory"
                        label="recorded"
                        :menu-props="{ auto: true }"
                        :disabled="setting.tmp.isSaveSameDirectory === true"
                        class="parent"
                    ></v-select>

                    <v-text-field v-model="directory" label="sub directory" clearable :disabled="setting.tmp.isSaveSameDirectory === true" class="sub"></v-text-field>
                </div>

                <v-checkbox v-model="cmCut" class="mx-1 my-0" label="CMカット"></v-checkbox>

                <v-checkbox v-model="setting.tmp.isSaveSameDirectory" class="mx-1 my-0" label="元ファイルと同じ場所に保存する"></v-checkbox>

                <v-checkbox v-model="setting.tmp.removeOriginal" class="mx-1 my-0" label="元ファイルを削除する"></v-checkbox>

                <div class="caption mt-2">source は TS を優先します。TS が存在しない場合は先頭の動画ファイルを使用します。</div>
            </div>

            <v-card-actions>
                <v-spacer></v-spacer>

                <v-btn text color="error" :disabled="isAdding === true" v-on:click="cancel">キャンセル</v-btn>

                <v-btn text color="primary" :loading="isAdding === true" :disabled="recorded.length === 0 || encodeMode === null" v-on:click="add">
                    {{ recorded.length }} 件を追加
                </v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IEncodeApiModel from '@/model/api/encode/IEncodeApiModel';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import { IAddEncodeSettingStorageModel } from '@/model/storage/encode/IAddEncodeSettingStorageModel';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class AddMultipleEncodeDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public recorded!: RecordedDisplayData[];

    public encodeMode: string | null = null;
    public parentDirectory: string | null = null;
    public directory: string | null = null;
    public cmCut: boolean = false;
    public isAdding: boolean = false;

    public setting: IAddEncodeSettingStorageModel = container.get<IAddEncodeSettingStorageModel>('IAddEncodeSettingStorageModel');

    private encodeApiModel: IEncodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    get dialogModel(): boolean {
        return this.isOpen;
    }

    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    get encodeList(): string[] {
        const config = this.serverConfig.getConfig();
        return config === null ? [] : config.encode;
    }

    get parentDirectoryList(): string[] {
        const config = this.serverConfig.getConfig();
        return config === null ? [] : config.recorded;
    }

    public cancel(): void {
        if (this.isAdding === true) {
            return;
        }

        this.dialogModel = false;
    }

    public async add(): Promise<void> {
        if (this.isAdding === true || this.encodeMode === null) {
            return;
        }

        this.isAdding = true;

        let success = 0;
        let failed = 0;

        for (const r of this.recorded) {
            const videoFiles = typeof r.recordedItem.videoFiles === 'undefined' ? [] : r.recordedItem.videoFiles;

            const source = videoFiles.find(v => v.type === 'ts') || (videoFiles.length > 0 ? videoFiles[0] : null);

            if (source === null) {
                console.error(`encode source not found: recordedId=${r.recordedItem.id}`);
                failed++;
                continue;
            }

            const option: apid.AddManualEncodeProgramOption = {
                recordedId: r.recordedItem.id,
                sourceVideoFileId: source.id,
                mode: this.encodeMode,
                removeOriginal: this.setting.tmp.removeOriginal,
                cmCut: this.cmCut,
            };

            if (this.setting.tmp.isSaveSameDirectory === true) {
                option.isSaveSameDirectory = true;
            } else {
                if (this.parentDirectory === null) {
                    console.error(`parent directory is null: recordedId=${r.recordedItem.id}`);
                    failed++;
                    continue;
                }

                option.parentDir = this.parentDirectory;

                if (this.directory !== null && this.directory.length > 0) {
                    option.directory = this.directory;
                }
            }

            try {
                await this.encodeApiModel.addEncode(option);
                success++;
            } catch (err) {
                console.error(err);
                failed++;
            }
        }

        this.setting.tmp.encodeMode = this.encodeMode;
        this.setting.tmp.parentDirectory = this.parentDirectory;
        this.setting.save();

        this.isAdding = false;
        this.$emit('complete', { success, failed });
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState !== true || !!oldState !== false) {
            return;
        }

        const saved = this.setting.getSavedValue();

        this.directory = null;

        if (saved.encodeMode !== null && this.encodeList.indexOf(saved.encodeMode) !== -1) {
            this.encodeMode = saved.encodeMode;
        } else {
            this.encodeMode = this.encodeList.length > 0 ? this.encodeList[0] : null;
        }

        if (saved.parentDirectory !== null && this.parentDirectoryList.indexOf(saved.parentDirectory) !== -1) {
            this.parentDirectory = saved.parentDirectory;
        } else {
            this.parentDirectory = this.parentDirectoryList.length > 0 ? this.parentDirectoryList[0] : null;
        }
    }
}
</script>

<style lang="sass" scoped>
.add-encode
    @media screen and (min-width: 400px)
        .directory
            display: flex
            align-items: center

        .parent
            flex-basis: 35%

        .sub
            flex-basis: 65%
</style>

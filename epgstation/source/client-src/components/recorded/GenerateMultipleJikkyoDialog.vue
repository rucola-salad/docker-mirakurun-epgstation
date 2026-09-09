<template>
    <v-dialog v-model="dialogModel" max-width="600" persistent>
        <v-card>
            <v-card-title>実況XML一括取得</v-card-title>

            <v-card-text v-if="result === null">
                選択した {{ recorded.length }} 件の実況XMLを取得します。
                <div class="caption mt-2">既にXMLが存在する録画も再取得します。取得結果が0件の場合は既存の非0件XMLを保持します。</div>
            </v-card-text>

            <v-card-text v-else>
                <div class="subtitle-1 font-weight-bold mb-2">実況XML取得結果</div>

                <div>更新: {{ result.updated }} 件</div>
                <div>既存保持: {{ result.preserved }} 件</div>
                <div>失敗: {{ result.failed }} 件</div>

                <div v-if="result.failures.length > 0" class="mt-4">
                    <div class="font-weight-bold mb-1">失敗:</div>

                    <div v-for="failure in result.failures" :key="failure.recordedId" class="mb-1">・録画ID {{ failure.recordedId }}: {{ failure.message }}</div>
                </div>
            </v-card-text>

            <v-card-actions>
                <v-spacer></v-spacer>

                <template v-if="result === null">
                    <v-btn text color="error" :disabled="isGenerating === true" v-on:click="cancel">キャンセル</v-btn>

                    <v-btn text color="primary" :loading="isGenerating === true" :disabled="recorded.length === 0" v-on:click="generate">{{ recorded.length }} 件を取得</v-btn>
                </template>

                <v-btn v-else text color="primary" v-on:click="closeResult">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import container from '@/model/ModelContainer';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

interface JikkyoFailure {
    recordedId: number;
    message: string;
}

interface JikkyoGenerateResult {
    updated: number;
    preserved: number;
    failed: number;
    failures: JikkyoFailure[];
}

@Component({})
export default class GenerateMultipleJikkyoDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public recorded!: RecordedDisplayData[];

    public isGenerating: boolean = false;
    public result: JikkyoGenerateResult | null = null;

    private recordedApiModel: IRecordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    get dialogModel(): boolean {
        return this.isOpen;
    }

    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    @Watch('isOpen')
    public onIsOpenChange(value: boolean): void {
        if (value === true) {
            this.result = null;
            this.isGenerating = false;
        }
    }

    public cancel(): void {
        if (this.isGenerating === true) {
            return;
        }

        this.dialogModel = false;
    }

    public closeResult(): void {
        if (this.result === null) {
            return;
        }

        const result = this.result;

        this.dialogModel = false;
        this.$emit('complete', {
            updated: result.updated,
            preserved: result.preserved,
            failed: result.failed,
        });
    }

    public async generate(): Promise<void> {
        if (this.isGenerating === true || this.recorded.length === 0) {
            return;
        }

        this.isGenerating = true;

        let updated = 0;
        let preserved = 0;
        const failures: JikkyoFailure[] = [];

        for (const r of this.recorded) {
            try {
                const result = await this.recordedApiModel.generateJikkyo(r.recordedItem.id);

                if (result.updated > 0) {
                    updated++;
                } else if (result.preserved > 0) {
                    preserved++;
                }
            } catch (err) {
                console.error(`jikkyo fetch failed: recordedId=${r.recordedItem.id}`, err);

                failures.push({
                    recordedId: r.recordedItem.id,
                    message: this.getErrorMessage(err),
                });
            }
        }

        this.result = {
            updated,
            preserved,
            failed: failures.length,
            failures,
        };

        this.isGenerating = false;
    }

    private getErrorMessage(err: unknown): string {
        const error = err as any;

        if (typeof error?.response?.data?.message === 'string' && error.response.data.message.length > 0) {
            return error.response.data.message;
        }

        if (typeof error?.response?.data?.error?.message === 'string' && error.response.data.error.message.length > 0) {
            return error.response.data.error.message;
        }

        if (typeof error?.message === 'string' && error.message.length > 0) {
            return error.message;
        }

        return '実況XML取得に失敗しました';
    }
}
</script>

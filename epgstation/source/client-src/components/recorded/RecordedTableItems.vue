<template>
    <v-card class="mx-auto recorded-table" max-width="1000px">
        <v-simple-table>
            <template v-slot:default>
                <thead>
                    <tr>
                        <th>タイトル</th>
                        <th class="channel">放送局</th>
                        <th class="time">時間</th>
                        <th class="menu"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" v-bind:key="item.recordedItem.id" v-on:click="gotoDetail(item)" v-bind:class="{ 'selected-color': item.isSelected === true }">
                        <td>
                            <div>
                                {{ item.display.name }}
                                <v-icon v-if="hasJikkyo(item) === true" small title="実況コメントあり">mdi-message-text</v-icon>
                                <v-icon v-if="hasChapters(item) === true" small title="チャプターあり">mdi-format-list-bulleted</v-icon>
                            </div>
                            <RecordedVideoFileChips
                                v-if="typeof item.recordedItem.videoFiles !== 'undefined'"
                                :videoFiles="item.recordedItem.videoFiles"
                                class="mt-1"
                            ></RecordedVideoFileChips>
                        </td>
                        <td>{{ item.display.channelName }}</td>
                        <td>{{ item.display.shortTime }} ({{ item.display.duration }} m)</td>
                        <td class="menu">
                            <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
                        </td>
                    </tr>
                </tbody>
            </template>
        </v-simple-table>
    </v-card>
</template>

<script lang="ts">
import RecordedItemMenu from '@/components/recorded/RecordedItemMenu.vue';
import RecordedVideoFileChips from '@/components/recorded/RecordedVideoFileChips.vue';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({ components: { RecordedItemMenu, RecordedVideoFileChips } })
export default class RecordedTableItems extends Vue {
    @Prop({ required: true }) public items!: RecordedDisplayData[];
    @Prop({ required: true }) public isEditMode!: boolean;
    @Prop({ required: true }) public isShowDropInfo!: boolean;

    public hasJikkyo(item: RecordedDisplayData): boolean {
        return typeof item.recordedItem.videoFiles !== 'undefined' && item.recordedItem.videoFiles.some(v => v.hasJikkyo === true);
    }

    public hasChapters(item: RecordedDisplayData): boolean {
        return (item.recordedItem as any).hasChapters === true;
    }

    public gotoDetail(item: RecordedDisplayData): void {
        if (this.isEditMode === true) {
            this.$emit('selected', item.recordedItem.id);
            return;
        }
        this.$emit('detail', item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }
}
</script>

<style lang="sass" scoped>
.recorded-table
    cursor: pointer
    .channel
        min-width: 180px
    .time
        width: 190px
    .menu
        width: 68px
</style>

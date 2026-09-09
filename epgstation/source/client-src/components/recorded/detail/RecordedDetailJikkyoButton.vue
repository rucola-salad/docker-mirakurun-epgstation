<template>
    <v-btn
        v-if="recordedItem.isRecording === false"
        color="teal white--text"
        v-on:click="generateJikkyo"
        class="ma-1"
        :loading="isGenerating"
        :disabled="isGenerating"
    >
        <v-icon left dark>mdi-comment-text-outline</v-icon>
        {{ hasJikkyo ? '実況XML再取得' : '実況XML取得' }}
    </v-btn>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedDetailJikkyoButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ default: false })
    public isGenerating!: boolean;

    @Prop({ default: false })
    public hasJikkyo!: boolean;

    public generateJikkyo(): void {
        this.$emit('generateJikkyo');
    }
}
</script>

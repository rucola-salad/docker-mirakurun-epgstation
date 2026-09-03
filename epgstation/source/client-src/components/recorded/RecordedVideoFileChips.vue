<template>
    <div v-if="videoFiles.length > 0" class="video-file-chips">
        <v-chip v-for="videoFile in videoFiles" :key="videoFile.id" x-small label class="mr-1 mb-1 video-file-chip" :title="`${videoFile.name} ・ ${formatSize(videoFile.size)}`">
            <v-icon x-small left>
                {{ videoFile.type === 'ts' ? 'mdi-file-video-outline' : 'mdi-cog-outline' }}
            </v-icon>
            <span class="video-file-name">{{ videoFile.name }}</span>
            <span class="ml-1">・ {{ formatSize(videoFile.size) }}</span>
        </v-chip>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedVideoFileChips extends Vue {
    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public formatSize(size: number): string {
        if (size >= 1024 * 1024 * 1024) {
            return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }

        if (size >= 1024 * 1024) {
            return `${Math.round(size / (1024 * 1024))} MB`;
        }

        if (size >= 1024) {
            return `${Math.round(size / 1024)} KB`;
        }

        return `${size} B`;
    }
}
</script>

<style lang="sass" scoped>
.video-file-chips
    display: flex
    flex-wrap: wrap
    min-width: 0

.video-file-chip
    max-width: 100%

.video-file-name
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
</style>

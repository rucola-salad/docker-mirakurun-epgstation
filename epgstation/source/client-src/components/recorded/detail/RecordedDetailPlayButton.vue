<template>
    <div>
        <v-menu v-model="isOpened" offset-y :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn color="primary" v-on="on" class="ma-1">
                    <v-icon left dark>{{ button }}</v-icon>
                    {{ title }}
                </v-btn>
            </template>

            <v-card class="play-menu-card">
                <div class="pa-2">
                    <v-btn v-for="video in videoFiles" v-bind:key="video.id" color="success" dark block class="my-1 play-video-button" v-on:click="play(video)">
                        <div class="play-video-content">
                            <div class="play-video-name">
                                {{ video.name }}
                            </div>
                            <div class="play-video-sub">{{ video.type === 'ts' ? '元録画' : 'エンコード' }} ・ {{ formatSize(video.size) }}</div>
                        </div>
                    </v-btn>
                </div>
            </v-card>
        </v-menu>

        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedDetailPlayButton extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop({ required: true })
    public button!: string;

    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public isOpened: boolean = false;

    public play(video: apid.VideoFile): void {
        this.$emit('play', video);
    }

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

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>

<style lang="sass" scoped>
.play-menu-card
    width: min(92vw, 420px)
    max-width: 420px

.play-video-button
    height: auto !important
    min-height: 52px
    white-space: normal

.play-video-content
    width: 100%
    min-width: 0
    text-align: left
    line-height: 1.3

.play-video-name
    white-space: normal
    overflow-wrap: anywhere
    word-break: break-word

.play-video-sub
    margin-top: 2px
    font-size: 11px
    opacity: 0.85
    white-space: normal
</style>

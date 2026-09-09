<template>
    <v-app-bar app :color="appBarColor" :clipped-left="navigationState.isClipped">
        <v-btn icon v-on:click="onClose">
            <v-icon>mdi-close</v-icon>
        </v-btn>
        <v-toolbar-title>{{ title }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon v-on:click="onSelectAll">
            <v-icon>mdi-select-all</v-icon>
        </v-btn>
        <v-tooltip v-if="isShowEncode === true" bottom>
            <template v-slot:activator="{ on }">
                <v-btn icon :disabled="isEncodeDisabled === true" v-on="on" v-on:click="onEncode">
                    <v-icon>mdi-video-plus</v-icon>
                </v-btn>
            </template>
            <span>一括エンコード</span>
        </v-tooltip>
        <v-tooltip v-if="isShowJikkyo === true" bottom>
            <template v-slot:activator="{ on }">
                <v-btn icon :disabled="isJikkyoDisabled === true" v-on="on" v-on:click="onJikkyo">
                    <v-icon>mdi-comment-text-outline</v-icon>
                </v-btn>
            </template>
            <span>実況XML取得</span>
        </v-tooltip>
        <v-tooltip v-if="isShowRepair === true" bottom>
            <template v-slot:activator="{ on }">
                <v-btn icon :disabled="isRepairDisabled === true" v-on="on" v-on:click="onRepair">
                    <v-icon>mdi-tools</v-icon>
                </v-btn>
            </template>
            <span>録画修復</span>
        </v-tooltip>
        <v-tooltip v-if="isShowChapters === true" bottom>
            <template v-slot:activator="{ on }">
                <v-btn icon :disabled="isChaptersDisabled === true" v-on="on" v-on:click="onChapters">
                    <v-icon>mdi-format-list-bulleted</v-icon>
                </v-btn>
            </template>
            <span>チャプター再作成</span>
        </v-tooltip>
        <v-btn icon v-on:click="onDelete">
            <v-icon>mdi-delete</v-icon>
        </v-btn>
    </v-app-bar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue } from 'vue-property-decorator';
import INavigationState from '../../model/state/navigation/INavigationState';

@Component({})
export default class EditTitleBar extends Vue {
    @Prop({ required: true }) public title!: string;
    @Prop({ required: true }) public isEditMode!: boolean;
    @Prop({ default: false }) public isShowEncode!: boolean;
    @Prop({ default: false }) public isEncodeDisabled!: boolean;
    @Prop({ default: false }) public isShowJikkyo!: boolean;
    @Prop({ default: false }) public isJikkyoDisabled!: boolean;
    @Prop({ default: false }) public isShowRepair!: boolean;
    @Prop({ default: false }) public isRepairDisabled!: boolean;
    @Prop({ default: false }) public isShowChapters!: boolean;
    @Prop({ default: false }) public isChaptersDisabled!: boolean;

    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    get editMode(): boolean {
        return this.isEditMode;
    }
    set editMode(value: boolean) {
        this.$emit('update:isEditMode', value);
    }

    get appBarColor(): string | null {
        return this.$vuetify.theme.dark === true ? null : 'white';
    }

    public onClose(): void {
        this.$emit('exit');
        this.editMode = false;
    }

    public onSelectAll(): void {
        this.$emit('selectall');
    }

    public onEncode(): void {
        this.$emit('encode');
    }

    public onJikkyo(): void {
        this.$emit('jikkyo');
    }

    public onRepair(): void {
        this.$emit('repair');
    }

    public onChapters(): void {
        this.$emit('chapters');
    }

    public onDelete(): void {
        this.$emit('delete');
    }
}
</script>

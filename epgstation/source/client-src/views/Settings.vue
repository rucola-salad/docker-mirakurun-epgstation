<template>
    <v-main>
        <TitleBar title="設定"></TitleBar>
        <transition name="page">
            <div v-if="isShow" ref="appContent" class="app-content">
                <v-container>
                    <v-card class="mx-auto" max-width="800">
                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">全般</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">PWA</v-list-item-title>
                                        <v-list-item-subtitle>PWAを有効化する(※再読込後有効になります)</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnablePWA" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">OSカラーテーマ</v-list-item-title>
                                        <v-list-item-subtitle>OSのカラーテーマに連動させる</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="shouldUseOSColorTheme" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">ダークテーマ</v-list-item-title>
                                        <v-list-item-subtitle>ダークテーマを有効化する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="isForceDarkTheme" :disabled="shouldUseOSColorTheme" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">半角表示</v-list-item-title>
                                        <v-list-item-subtitle>強制的に半角表示にする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isHalfWidthDisplayed" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">放映中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>放送波毎にタブで分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isOnAirTabListView" value></v-switch>
                                </div>
                                <div v-if="isSupportedMpegts" class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">web での再生を優先する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isPreferredPlayingLiveM2TSOnWeb" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.onAirM2TSViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">番組表</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">描画設定</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideModeItems" v-model="storageModel.tmp.guideMode" class="guide-mode" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示時間</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideLengthItems" v-model="storageModel.tmp.guideLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">ダークテーマの配色を無効化する</v-list-item-title>
                                        <v-list-item-subtitle>ダークテーマ使用時でも通常時と同じ配色設定になります</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isForceDisableDarkThemeForGuide" value :disabled="$vuetify.theme.dark === false"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">無料放送だけ表示する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowOnlyFreePrograms" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>ナビゲーションの表示を放送波別に分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableDisplayForEachBroadcastWave" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">検索時に放送局情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeChannelIdWhenSearching" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">検索時にジャンル情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeGenreWhenSearching" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">予約</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="reservesLengthItems" v-model="storageModel.tmp.reservesLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>
                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">録画中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordingLengthItems" v-model="storageModel.tmp.recordingLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">録画</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordedLengthItems" v-model="storageModel.tmp.recordedLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">テーブル表示</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowTableMode" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">ドロップ情報を表示する</v-list-item-title>
                                        <v-list-item-subtitle>概要の代わりにドロップとファイルサイズ情報を表示する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowDropInfoInsteadOfDescription" value></v-switch>
                                </div>

                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">削除時のチェックを入れるか</v-list-item-title>
                                        <v-list-item-subtitle>有効にするとファイル削除のチェックが入れられた状態で録画削除ダイアログが開かれます</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.deleteRecordedDefaultValue" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">web での再生を優先する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isPreferredPlayingOnWeb" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedViewURLScheme" value></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">ダウンロード URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedDownloadURLScheme" value></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedDownloadURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">検索</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">最大表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="searchLengthItems" v-model="storageModel.tmp.searchLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">自動スクロール</v-list-item-title>
                                        <v-list-item-subtitle>ルール編集時に検索結果へ自動スクロールする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableAutoScrollWhenEditingRule" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">自動サブディレクトリ設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にキーワードをサブディレクトリにコピーする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableCopyKeywordToDirectory" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">録画済み番組を排除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に録画済み番組を排除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckAvoidDuplicate" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">エンコードの自動設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にエンコード設定を自動で行う</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableEncodingSettingWhenCreateRule" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">元ファイルの自動削除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に元ファイルの自動削除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckDeleteOriginalAfterEncode" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">ルール</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="rulesLengthItems" v-model="storageModel.tmp.rulesLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">録画・再生設定</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">実況XMLを自動作成する</v-list-item-title>
                                        <v-list-item-subtitle>録画・エンコード完了時に実況XMLを自動生成する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="extensionSettings.autoGenerateJikkyoXml"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">実況コメントをデフォルトで表示する</v-list-item-title>
                                        <v-list-item-subtitle>録画再生開始時の実況表示の初期状態</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.showJikkyoByDefault"></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">CMスキップをデフォルトで有効にする</v-list-item-title>
                                        <v-list-item-subtitle>CM未カット動画を再生するときの初期状態</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.enableCmSkipByDefault"></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item>
                            <v-list-item-content>
                                <div class="title mb-2">CM解析ロゴ管理</div>

                                <v-progress-linear
                                    v-if="isLoadingCmAnalyzerLogoCollectorStatus"
                                    indeterminate
                                    class="mb-2"
                                ></v-progress-linear>

                                <div v-if="cmAnalyzerLogoCollectorStatus !== null" class="cm-logo-collector mb-3">
                                    <div class="d-flex align-center">
                                        <div class="font-weight-bold">
                                            ロゴ自動取得
                                        </div>

                                        <v-chip
                                            x-small
                                            class="ml-2"
                                            :color="cmAnalyzerLogoCollectorStatus.enabled ? 'success' : undefined"
                                        >
                                            {{ cmAnalyzerLogoCollectorStatus.enabled ? 'ON' : 'OFF' }}
                                        </v-chip>

                                        <v-spacer></v-spacer>

                                        <v-btn
                                            small
                                            text
                                            :color="cmAnalyzerLogoCollectorStatus.enabled ? 'error' : 'primary'"
                                            :loading="isUpdatingCmAnalyzerLogoCollector"
                                            v-on:click="toggleCmAnalyzerLogoCollector"
                                        >
                                            {{ cmAnalyzerLogoCollectorStatus.enabled ? '停止' : '開始' }}
                                        </v-btn>
                                    </div>

                                    <div
                                        v-for="worker in cmAnalyzerLogoCollectorWorkers"
                                        :key="worker.name"
                                        class="cm-logo-worker"
                                    >
                                        <span class="font-weight-bold cm-logo-worker-name">
                                            {{ worker.name }}
                                        </span>

                                        <span>
                                            {{ getCmAnalyzerLogoCollectorWorkerText(worker.status) }}
                                        </span>

                                        <span
                                            v-if="worker.status.channelName"
                                            class="text--secondary ml-2"
                                        >
                                            {{ worker.status.channelName }}
                                        </span>

                                        <span
                                            v-if="worker.status.programName"
                                            class="text--secondary ml-2 cm-logo-worker-program"
                                        >
                                            {{ worker.status.programName }}
                                        </span>
                                    </div>
                                </div>

                                <div
                                    v-else-if="!isLoadingCmAnalyzerLogoCollectorStatus"
                                    class="caption text--secondary mb-3"
                                >
                                    ロゴ自動取得状態を取得できませんでした
                                </div>

                                <v-progress-linear
                                    v-if="isLoadingCmAnalyzerLogos"
                                    indeterminate
                                    class="mb-2"
                                ></v-progress-linear>

                                <div v-else>
                                    <div class="d-flex flex-wrap align-center cm-logo-summary">
                                        <span>登録 {{ cmAnalyzerLogoRegisteredCount }}</span>
                                        <span class="ml-3">未取得 {{ cmAnalyzerLogoMissingCount }}</span>
                                        <span class="ml-3">改善中 {{ cmAnalyzerLogoImprovingCount }}</span>

                                        <v-spacer></v-spacer>

                                        <v-btn
                                            v-if="cmAnalyzerLogos.length > 0"
                                            small
                                            text
                                            color="primary"
                                            v-on:click="isCmAnalyzerLogoListOpen = !isCmAnalyzerLogoListOpen"
                                        >
                                            {{ isCmAnalyzerLogoListOpen ? 'ロゴ一覧を閉じる' : 'ロゴ一覧を開く' }}
                                            <v-icon small right>
                                                {{ isCmAnalyzerLogoListOpen ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
                                            </v-icon>
                                        </v-btn>
                                    </div>

                                    <div
                                        v-if="cmAnalyzerLogos.length === 0"
                                        class="text--secondary mt-2"
                                    >
                                        CM解析ロゴはありません
                                    </div>

                                    <div
                                        v-if="isCmAnalyzerLogoListOpen"
                                        class="cm-logo-list mt-2"
                                    >
                                        <v-card
                                            v-for="logo in cmAnalyzerLogos"
                                            :key="getCmAnalyzerLogoKey(logo)"
                                            outlined
                                            class="cm-logo-row mb-1"
                                        >
                                            <div class="d-flex flex-wrap align-center px-3 py-2">
                                                <div class="cm-logo-row-main">
                                                    <span class="font-weight-bold">
                                                        {{ logo.channelName || logo.stationId || logo.serviceId || '不明なチャンネル' }}
                                                    </span>

                                                    <span class="caption text--secondary ml-2">
                                                        {{ getCmAnalyzerLogoIdentifier(logo) }}
                                                    </span>
                                                </div>

                                                <div class="cm-logo-row-status">
                                                    {{ getCmAnalyzerLogoStatus(logo) }}
                                                </div>

                                                <div class="cm-logo-row-quality">
                                                    {{ getCmAnalyzerLogoQuality(logo) }}
                                                </div>

                                                <v-spacer></v-spacer>

                                                <v-btn
                                                    small
                                                    text
                                                    v-on:click="toggleCmAnalyzerLogoDetail(logo)"
                                                >
                                                    {{ isCmAnalyzerLogoDetailOpen(logo) ? '閉じる' : '詳細' }}
                                                </v-btn>

                                                <v-btn
                                                    v-if="logo.stationId && logo.hasLogo !== false"
                                                    small
                                                    text
                                                    color="error"
                                                    :disabled="isDeletingCmAnalyzerLogo"
                                                    v-on:click="openCmAnalyzerLogoDeleteDialog(logo)"
                                                >
                                                    削除
                                                </v-btn>
                                            </div>

                                            <div
                                                v-if="isCmAnalyzerLogoDetailOpen(logo)"
                                                class="cm-logo-detail px-3 pb-3"
                                            >
                                                <div
                                                    v-if="logo.stationId && logo.hasLogo !== false"
                                                    class="cm-logo-preview mb-2"
                                                >
                                                    <img
                                                        :src="getCmAnalyzerLogoPreviewUrl(logo)"
                                                        :alt="logo.stationId + ' logo'"
                                                    />
                                                </div>

                                                <div class="caption">
                                                    生成日時: {{ getCmAnalyzerLogoGeneratedAt(logo) }}
                                                </div>
                                                <div class="caption">
                                                    最終取得: {{ getCmAnalyzerLogoLastCollectAt(logo) }}
                                                </div>
                                                <div class="caption">
                                                    次回取得: {{ getCmAnalyzerLogoNextCollectAt(logo) }}
                                                </div>
                                                <div
                                                    v-if="logo.consecutiveDetectionFailures > 0"
                                                    class="caption"
                                                >
                                                    連続検出失敗:
                                                    {{ logo.consecutiveDetectionFailures }} 回
                                                </div>
                                            </div>
                                        </v-card>
                                    </div>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">ビデオプレーヤ</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">字幕の縁取りを強制する</v-list-item-title>
                                        <v-list-item-subtitle>aribb24.js 使用時に有効になります</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isForceEnableSubtitleStroke" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-card-actions right>
                            <v-spacer></v-spacer>
                            <v-btn text v-on:click="reset">リセット</v-btn>
                            <v-btn text color="primary" v-on:click="save">保存</v-btn>
                        </v-card-actions>
                    </v-card>
                    <div style="visibility: hidden">dummy</div>
                </v-container>
            </div>
        </transition>
        <v-dialog v-model="isCmAnalyzerLogoDeleteDialogOpen" max-width="360" persistent>
            <v-card>
                <v-card-text class="pa-4">
                    <div class="text--primary">
                        {{ cmAnalyzerLogoDeleteTarget ? cmAnalyzerLogoDeleteTarget.stationId : '' }}
                        のCM解析ロゴを削除しますか？
                    </div>
                    <div class="caption mt-2">バックグラウンド収集または次回の録画解析時に新しいロゴが生成されます。</div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer></v-spacer>

                    <v-btn color="primary" text :disabled="isDeletingCmAnalyzerLogo" v-on:click="closeCmAnalyzerLogoDeleteDialog">キャンセル</v-btn>

                    <v-btn color="error" text :loading="isDeletingCmAnalyzerLogo" v-on:click="deleteCmAnalyzerLogo">削除</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import * as apid from '../../../api';
import IExtensionSettingsApiModel from '@/model/api/extensionSettings/IExtensionSettingsApiModel';
import ICmAnalyzerApiModel, {
    ICmAnalyzerLogo,
    ICmAnalyzerLogoCollectorStatus,
    ICmAnalyzerLogoCollectorWorkerStatus,
} from '@/model/api/cmAnalyzer/ICmAnalyzerApiModel';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState from '@/model/state/navigation/INavigationState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, GuideViewMode } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import IColorThemeState from '@/model/state/IColorThemeState';
import Mpegts from 'mpegts.js';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface GuideModeItem {
    text: string;
    value: GuideViewMode;
}

interface SelectItem {
    text: string;
    value: number;
}

@Component({
    components: {
        TitleBar,
    },
})
export default class Settings extends Vue {
    public isShow: boolean = false;
    public storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    public extensionSettings: apid.ExtensionSettings = {
        autoGenerateJikkyoXml: true,
    };

    public cmAnalyzerLogos: ICmAnalyzerLogo[] = [];
    public isLoadingCmAnalyzerLogos: boolean = false;
    public isCmAnalyzerLogoDeleteDialogOpen: boolean = false;
    public cmAnalyzerLogoDeleteTarget: ICmAnalyzerLogo | null = null;
    public isDeletingCmAnalyzerLogo: boolean = false;
    public isCmAnalyzerLogoListOpen: boolean = false;
    public cmAnalyzerLogoDetailKeys: string[] = [];

    public cmAnalyzerLogoCollectorStatus: ICmAnalyzerLogoCollectorStatus | null = null;
    public isLoadingCmAnalyzerLogoCollectorStatus: boolean = false;
    public isUpdatingCmAnalyzerLogoCollector: boolean = false;

    private cmAnalyzerLogoCollectorStatusTimer: number | null = null;

    private extensionSettingsApi = container.get<IExtensionSettingsApiModel>('IExtensionSettingsApiModel');
    private cmAnalyzerApi = container.get<ICmAnalyzerApiModel>('ICmAnalyzerApiModel');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private colorThemeState: IColorThemeState = container.get<IColorThemeState>('IColorThemeState');

    public readonly guideModeItems: GuideModeItem[] = [
        {
            text: '逐次',
            value: 'sequential',
        },
        {
            text: '最小',
            value: 'minimum',
        },
        {
            text: 'すべて',
            value: 'all',
        },
    ];

    public guideLengthItems: SelectItem[] = [];
    public reservesLengthItems: SelectItem[] = [];
    public recordingLengthItems: SelectItem[] = [];
    public recordedLengthItems: SelectItem[] = [];
    public searchLengthItems: SelectItem[] = [];
    public rulesLengthItems: SelectItem[] = [];

    get shouldUseOSColorTheme(): boolean {
        return this.storageModel.tmp.shouldUseOSColorTheme;
    }

    set shouldUseOSColorTheme(value: boolean) {
        this.storageModel.tmp.shouldUseOSColorTheme = value;
        if (value) {
            this.isForceDarkTheme = this.colorThemeState.isTmpDarkTheme();
        }
    }

    get isForceDarkTheme(): boolean {
        return this.storageModel.tmp.isForceDarkTheme;
    }

    set isForceDarkTheme(value: boolean) {
        this.storageModel.tmp.isForceDarkTheme = value;
        this.$vuetify.theme.dark = value;
    }

    get isSupportedMpegts(): boolean {
        return Mpegts.isSupported();
    }

    constructor() {
        super();

        this.isForceDarkTheme = this.colorThemeState.isTmpDarkTheme();

        for (let i = 1; i <= 24; i++) {
            this.guideLengthItems.push({
                text: i.toString(10),
                value: i,
            });
        }

        for (let i = 1; i <= 100; i++) {
            const item: SelectItem = {
                text: i.toString(10),
                value: i,
            };
            this.reservesLengthItems.push(item);
            this.recordingLengthItems.push(item);
            this.recordedLengthItems.push(item);
            this.rulesLengthItems.push(item);
        }

        for (let i = 50; i <= 600; i += 50) {
            const item: SelectItem = {
                text: i.toString(10),
                value: i,
            };
            this.searchLengthItems.push(item);
        }
    }

    get cmAnalyzerLogoRegisteredCount(): number {
        return this.cmAnalyzerLogos.filter(logo => logo.hasLogo !== false).length;
    }

    get cmAnalyzerLogoMissingCount(): number {
        return this.cmAnalyzerLogos.filter(logo => logo.status === 'missing').length;
    }

    get cmAnalyzerLogoImprovingCount(): number {
        return this.cmAnalyzerLogos.filter(logo => logo.status === 'improving').length;
    }

    get cmAnalyzerLogoCollectorWorkers(): Array<{
        name: string;
        status: ICmAnalyzerLogoCollectorWorkerStatus;
    }> {
        if (this.cmAnalyzerLogoCollectorStatus === null) {
            return [];
        }

        return [
            {
                name: 'GR',
                status: this.cmAnalyzerLogoCollectorStatus.workers.GR,
            },
            {
                name: 'BS/CS',
                status: this.cmAnalyzerLogoCollectorStatus.workers.BSCS,
            },
        ];
    }

    public getCmAnalyzerLogoCollectorWorkerText(
        worker: ICmAnalyzerLogoCollectorWorkerStatus,
    ): string {
        if (
            this.cmAnalyzerLogoCollectorStatus !== null &&
            !this.cmAnalyzerLogoCollectorStatus.enabled &&
            worker.running
        ) {
            return `停止待ち / ${this.getCmAnalyzerLogoCollectorPhaseText(worker.phase)}`;
        }

        if (
            this.cmAnalyzerLogoCollectorStatus !== null &&
            !this.cmAnalyzerLogoCollectorStatus.enabled &&
            !worker.running
        ) {
            return '停止';
        }

        return this.getCmAnalyzerLogoCollectorPhaseText(worker.phase);
    }

    public getCmAnalyzerLogoCollectorPhaseText(phase: string): string {
        switch (phase) {
            case 'selecting':
                return '対象選択中';
            case 'sampling':
                return 'サンプル取得中';
            case 'probing':
                return 'サンプル確認中';
            case 'analyzing':
                return 'ロゴ解析中';
            case 'idle':
            default:
                return '待機中';
        }
    }

    public async toggleCmAnalyzerLogoCollector(): Promise<void> {
        if (
            this.cmAnalyzerLogoCollectorStatus === null ||
            this.isUpdatingCmAnalyzerLogoCollector
        ) {
            return;
        }

        const enable = !this.cmAnalyzerLogoCollectorStatus.enabled;
        this.isUpdatingCmAnalyzerLogoCollector = true;

        try {
            this.cmAnalyzerLogoCollectorStatus = enable
                ? await this.cmAnalyzerApi.startLogoCollector()
                : await this.cmAnalyzerApi.stopLogoCollector();

            this.snackbarState.open({
                text: enable
                    ? 'CM解析ロゴ自動取得を開始しました'
                    : 'CM解析ロゴ自動取得を停止しました',
                color: 'success',
            });
        } catch (err) {
            this.snackbarState.open({
                text: enable
                    ? 'CM解析ロゴ自動取得の開始に失敗しました'
                    : 'CM解析ロゴ自動取得の停止に失敗しました',
                color: 'error',
            });

            console.error(err);
        } finally {
            this.isUpdatingCmAnalyzerLogoCollector = false;
        }
    }

    public toggleCmAnalyzerLogoDetail(logo: ICmAnalyzerLogo): void {
        const key = this.getCmAnalyzerLogoKey(logo);
        const index = this.cmAnalyzerLogoDetailKeys.indexOf(key);

        if (index >= 0) {
            this.cmAnalyzerLogoDetailKeys.splice(index, 1);
            return;
        }

        this.cmAnalyzerLogoDetailKeys.push(key);
    }

    public isCmAnalyzerLogoDetailOpen(logo: ICmAnalyzerLogo): boolean {
        return this.cmAnalyzerLogoDetailKeys.indexOf(
            this.getCmAnalyzerLogoKey(logo),
        ) >= 0;
    }

    public getCmAnalyzerLogoKey(logo: ICmAnalyzerLogo): string {
        if (logo.stationId !== null) {
            return `station:${logo.stationId}`;
        }

        return `service:${logo.serviceId || logo.channelName || 'unknown'}`;
    }

    public getCmAnalyzerLogoIdentifier(logo: ICmAnalyzerLogo): string {
        const values: string[] = [];

        if (logo.stationId !== null) {
            values.push(logo.stationId);
        } else if (logo.serviceId !== null) {
            values.push(`service ${logo.serviceId}`);
        }

        if (logo.channelType) {
            values.push(logo.channelType);
        }

        return values.join(' / ');
    }

    public getCmAnalyzerLogoStatus(logo: ICmAnalyzerLogo): string {
        switch (logo.status) {
            case 'missing':
                return '未取得';
            case 'good':
                return '良好';
            case 'improving':
                return '改善中';
            case 'backoff':
                return '待機中';
            case 'suspended':
                return '長期待機';
            case 'unsupported':
                return '未対応';
            default:
                return '未評価';
        }
    }

    public getCmAnalyzerLogoQuality(logo: ICmAnalyzerLogo): string {
        if (logo.qualityScore === null) {
            return '－';
        }

        return `${logo.qualityScore.toFixed(2)} 点`;
    }

    public getCmAnalyzerLogoGeneratedAt(logo: ICmAnalyzerLogo): string {
        if (logo.generatedAt === null) {
            return '－';
        }

        return new Date(logo.generatedAt).toLocaleString();
    }

    public getCmAnalyzerLogoLastCollectAt(logo: ICmAnalyzerLogo): string {
        if (!logo.lastCollectAt) {
            return '－';
        }

        return new Date(logo.lastCollectAt).toLocaleString();
    }

    public getCmAnalyzerLogoNextCollectAt(logo: ICmAnalyzerLogo): string {
        if (!logo.nextCollectAt) {
            return '－';
        }

        return new Date(logo.nextCollectAt).toLocaleString();
    }

    public getCmAnalyzerLogoPreviewUrl(logo: ICmAnalyzerLogo): string {
        if (logo.stationId === null) {
            return '';
        }

        return './api/cm-analyzer/logos/' + encodeURIComponent(logo.stationId) + '/preview';
    }

    public openCmAnalyzerLogoDeleteDialog(logo: ICmAnalyzerLogo): void {
        this.cmAnalyzerLogoDeleteTarget = logo;
        this.isCmAnalyzerLogoDeleteDialogOpen = true;
    }

    public closeCmAnalyzerLogoDeleteDialog(): void {
        if (this.isDeletingCmAnalyzerLogo) {
            return;
        }

        this.isCmAnalyzerLogoDeleteDialogOpen = false;
        this.cmAnalyzerLogoDeleteTarget = null;
    }

    public async deleteCmAnalyzerLogo(): Promise<void> {
        const target = this.cmAnalyzerLogoDeleteTarget;

        if (target === null || target.stationId === null || target.hasLogo === false) {
            return;
        }

        this.isDeletingCmAnalyzerLogo = true;

        try {
            await this.cmAnalyzerApi.deleteLogo(target.stationId);

            this.isCmAnalyzerLogoDeleteDialogOpen = false;
            this.cmAnalyzerLogoDeleteTarget = null;

            await this.loadCmAnalyzerLogos();

            this.snackbarState.open({
                text: `${target.stationId} のCM解析ロゴを削除しました`,
                color: 'success',
            });
        } catch (err) {
            this.snackbarState.open({
                text: `${target.stationId} のCM解析ロゴ削除に失敗しました`,
                color: 'error',
            });

            console.error(err);
        } finally {
            this.isDeletingCmAnalyzerLogo = false;
        }
    }

    private async loadCmAnalyzerLogoCollectorStatus(
        silent: boolean = false,
    ): Promise<void> {
        if (
            this.isLoadingCmAnalyzerLogoCollectorStatus ||
            this.isUpdatingCmAnalyzerLogoCollector
        ) {
            return;
        }

        if (!silent) {
            this.isLoadingCmAnalyzerLogoCollectorStatus = true;
        }

        try {
            this.cmAnalyzerLogoCollectorStatus =
                await this.cmAnalyzerApi.getLogoCollectorStatus();
        } catch (err) {
            if (!silent) {
                this.cmAnalyzerLogoCollectorStatus = null;
            }

            console.error(err);
        } finally {
            if (!silent) {
                this.isLoadingCmAnalyzerLogoCollectorStatus = false;
            }
        }
    }

    private startCmAnalyzerLogoCollectorStatusPolling(): void {
        this.stopCmAnalyzerLogoCollectorStatusPolling();

        this.cmAnalyzerLogoCollectorStatusTimer = window.setInterval(() => {
            this.loadCmAnalyzerLogoCollectorStatus(true);
        }, 3000);
    }

    private stopCmAnalyzerLogoCollectorStatusPolling(): void {
        if (this.cmAnalyzerLogoCollectorStatusTimer === null) {
            return;
        }

        window.clearInterval(this.cmAnalyzerLogoCollectorStatusTimer);
        this.cmAnalyzerLogoCollectorStatusTimer = null;
    }

    private async loadCmAnalyzerLogos(): Promise<void> {
        this.isLoadingCmAnalyzerLogos = true;

        try {
            this.cmAnalyzerLogos = await this.cmAnalyzerApi.getLogos();
        } catch (err) {
            this.cmAnalyzerLogos = [];

            this.snackbarState.open({
                text: 'CM解析ロゴの読み込みに失敗しました',
                color: 'error',
            });
        } finally {
            this.isLoadingCmAnalyzerLogos = false;
        }
    }

    public beforeDestroy(): void {
        this.stopCmAnalyzerLogoCollectorStatusPolling();
        this.isShow = false;
    }

    public destroyed(): void {
        // ページから移動するときに tmp をリセット
        this.storageModel.resetTmpValue();
        this.$vuetify.theme.dark = this.colorThemeState.isDarkTheme();
    }

    /**
     * setting の tmp をデフォルト値へリセットする
     */
    public reset(): void {
        this.storageModel.tmp = this.storageModel.getDefaultValue();
        this.extensionSettings = {
            autoGenerateJikkyoXml: true,
        };
        this.$vuetify.theme.dark = this.colorThemeState.isDarkTheme();
    }

    /**
     * tmp の値を保存する
     */
    public async save(): Promise<void> {
        try {
            await this.extensionSettingsApi.update(this.extensionSettings);
            this.storageModel.save();
            this.navigationState.updateItems(this.$route);

            this.snackbarState.open({
                text: '保存されました',
                color: 'success',
            });
        } catch (err) {
            this.snackbarState.open({
                text: '設定の保存に失敗しました',
                color: 'error',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(async () => {
            try {
                this.extensionSettings = await this.extensionSettingsApi.get();
            } catch (err) {
                this.snackbarState.open({
                    text: 'サーバー設定の読み込みに失敗しました',
                    color: 'error',
                });
            }

            await Promise.all([
                this.loadCmAnalyzerLogos(),
                this.loadCmAnalyzerLogoCollectorStatus(),
            ]);

            this.startCmAnalyzerLogoCollectorStatusPolling();

            this.isShow = true;

            this.$nextTick(async () => {
                // スクロール位置復元を許可
                await this.scrollState.emitDoneGetData();
            });
        });
    }
}
</script>

<style lang="sass" scoped>
.guide-mode
    max-width: 100px
.guide-time
    max-width: 70px
.cm-logo-collector
    border: 1px solid rgba(127, 127, 127, 0.35)
    border-radius: 4px
    padding: 8px 12px
.cm-logo-worker
    display: flex
    flex-wrap: wrap
    align-items: baseline
    line-height: 1.6
.cm-logo-worker-name
    display: inline-block
    min-width: 52px
.cm-logo-worker-program
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    max-width: 520px
.cm-logo-summary
    min-height: 32px
.cm-logo-list
    width: 100%
.cm-logo-row-main
    min-width: 220px
    flex: 1 1 320px
.cm-logo-row-status
    min-width: 70px
    margin-left: 12px
.cm-logo-row-quality
    min-width: 90px
    margin-left: 12px
.cm-logo-detail
    border-top: 1px solid rgba(127, 127, 127, 0.25)
    padding-top: 8px
.cm-logo-preview
    text-align: left
.cm-logo-preview img
    max-width: 180px
    max-height: 70px
    image-rendering: auto
</style>

<style lang="sass">
// toggle switch の橋が途切れるため
.v-input--switch
    margin-right: 4px
    margin-top: 0 !important
    padding-top: 0 !important
    .v-input__slot
        margin-bottom: 0 !important
    .v-messages
        display: none
</style>

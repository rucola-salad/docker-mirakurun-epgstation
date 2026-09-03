EPGStation 2.6.20 - NX-Jikkyo ライブ実況表示 初版
====================================================

目的
----
EPGStation の /onair/watch 画面で、NX-Jikkyo のリアルタイムコメントを
映像上にオーバーレイ表示します。

変更ファイル
----------
新規:
  client/src/components/jikkyo/JikkyoOverlay.vue

変更:
  client/src/components/video/VideoContainer.vue
  client/src/views/WatchOnAir.vue

初版の仕様
--------
- NX-Jikkyo の視聴セッション WebSocket (/ws/watch) に接続
- room メッセージで得たコメント WebSocket (/ws/comment) に接続
- 直近10コメント + 以後のリアルタイムコメントを受信
- naka / ue / shita を簡易表示
- white/red/pink/orange/yellow/green/cyan/blue/purple/black と #RRGGBB を反映
- big / small を簡易反映
- プレイヤー操作欄に実況 ON/OFF ボタンを追加
- ON/OFF 状態は localStorage に保存
- フルスクリーン時も実況を表示
- 録画再生にはまだ影響しない

チャンネル対応
------------
GR:
  remote 1->jk1, 2->jk2, 3->jk12, 4->jk4, 5->jk5,
  6->jk6, 7->jk7, 8->jk8, 9->jk9
BS:
  101,141,151,161,171,181,191,192,193,200,201,211,222,236,252,265
CS:
  333 (AT-X)

注意:
  serviceId=260 は現在の受信環境では J:COM BS であり、NX-Jikkyo の jk260 と
  一致すると断定できないため、意図的に未対応です。

テスト適用手順（Dockerイメージはまだ再ビルドしない）
-------------------------------------------------
以下は ~/git/docker-mirakurun-epgstation に本アーカイブを展開した前提です。

1. バックアップ用ディレクトリを作る

  TS=$(date +%Y%m%d-%H%M%S)
  mkdir -p "epgstation/jikkyo-backup/$TS/components/video"
  mkdir -p "epgstation/jikkyo-backup/$TS/views"

2. 現在のコンテナ内ソースをホストへバックアップ

  docker cp epgstation-v2:/app/client/src/components/video/VideoContainer.vue \
    "epgstation/jikkyo-backup/$TS/components/video/VideoContainer.vue"

  docker cp epgstation-v2:/app/client/src/views/WatchOnAir.vue \
    "epgstation/jikkyo-backup/$TS/views/WatchOnAir.vue"

3. バックアップ確認

  ls -l "epgstation/jikkyo-backup/$TS/components/video/VideoContainer.vue" \
        "epgstation/jikkyo-backup/$TS/views/WatchOnAir.vue"

ここまで確認してから適用してください。

4. 新規ディレクトリをコンテナ内に作成

  docker exec epgstation-v2 mkdir -p /app/client/src/components/jikkyo

5. 修正版をコンテナへコピー

  docker cp epgstation-jikkyo-live-patch/client/src/components/jikkyo/JikkyoOverlay.vue \
    epgstation-v2:/app/client/src/components/jikkyo/JikkyoOverlay.vue

  docker cp epgstation-jikkyo-live-patch/client/src/components/video/VideoContainer.vue \
    epgstation-v2:/app/client/src/components/video/VideoContainer.vue

  docker cp epgstation-jikkyo-live-patch/client/src/views/WatchOnAir.vue \
    epgstation-v2:/app/client/src/views/WatchOnAir.vue

6. 差分確認

  docker exec epgstation-v2 sh -lc '
    grep -n "Jikkyo\|jikkyo" /app/client/src/components/video/VideoContainer.vue
    grep -n "Jikkyo\|jikkyo" /app/client/src/components/jikkyo/JikkyoOverlay.vue | head -40
    grep -n "jikkyoChannelId" /app/client/src/views/WatchOnAir.vue
  '

7. クライアントをビルド

  docker exec epgstation-v2 sh -lc '
    cd /app/client && yarn build
  '

yarn がない場合のみ:

  docker exec epgstation-v2 sh -lc '
    cd /app/client && npm run build
  '

8. ブラウザで強制再読み込みし、放映中 -> 視聴 を開く

- 対応チャンネルならコメントアイコンが表示される
- アイコンで実況 ON/OFF
- Chrome DevTools Console に WebSocket エラーがないことを確認
- jk1 / jk6 などコメントの多い局で試すと確認しやすい

戻し方
------
バックアップした2ファイルを docker cp で戻し、JikkyoOverlay.vue はそのまま残しても
参照されなくなるため動作には影響しません。
その後 /app/client で再度 yarn build してください。

※ 初回テストでは Dockerfile を変更・Dockerイメージを再ビルドしません。
   現在の Dockerfile が l3tnun/epgstation:master-debian をベースにしており、
   再ビルド時に予期せず上流版が変わるリスクを避けるためです。
   動作確認後に、現在のベースイメージを固定して永続化します。

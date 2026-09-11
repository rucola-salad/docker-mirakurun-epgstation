'use strict';

const fs = require('fs');

const timelineText = process.env.CM_TIMELINE || '';
const cmCut = process.env.CM_CUT === '1';
const command = process.argv[2];
const filterFieldmatch = command === '--filter-fieldmatch';
if (!timelineText) {
    process.stdout.write(JSON.stringify({
        hasTimeline: false,
        filter: null,
        chapters: []
    }));
    process.exit(0);
}

const timeline = JSON.parse(timelineText);
const frameRate = Number(timeline.frameRate);
const videoStartTime = Number(process.env.CM_VIDEO_START_TIME);
const audioStreamCount = Number(process.env.CM_AUDIO_STREAM_COUNT || '1');
const chapters = Array.isArray(timeline.chapters)
    ? timeline.chapters
    : [];
const keepRanges = Array.isArray(timeline.keepRanges)
    ? timeline.keepRanges
    : [];

if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error('InvalidTimelineFrameRate');
}

if (cmCut && (!Number.isFinite(videoStartTime) || videoStartTime < 0)) {
    throw new Error('InvalidVideoStartTime');
}

if (
    cmCut &&
    (!Number.isInteger(audioStreamCount) || audioStreamCount < 0)
) {
    throw new Error('InvalidAudioStreamCount');
}

const unique = values => {
    const result = [];
    for (const value of values.sort((a, b) => a - b)) {
        if (
            result.length === 0 ||
            Math.abs(result[result.length - 1] - value) > 0.001
        ) {
            result.push(value);
        }
    }
    return result;
};

const output = {
    hasTimeline: true,
    filter: null,
    chapters: [],
    duration: null
};

if (!cmCut) {
    output.chapters = unique(
        chapters
            .map(ch => Number(ch.time))
            .filter(t => Number.isFinite(t) && t >= 0)
    );
} else {
    if (keepRanges.length === 0) {
        throw new Error('KeepRangesIsEmpty');
    }

    const normalized = keepRanges.map(range => ({
        startFrame: Number(range.startFrame),
        endFrame: Number(range.endFrame)
    }));

    for (const range of normalized) {
        if (
            !Number.isInteger(range.startFrame) ||
            !Number.isInteger(range.endFrame) ||
            range.endFrame < range.startFrame
        ) {
            throw new Error('InvalidKeepRange');
        }
    }

    /*
     * keepRanges は inclusive frame。
     * end は最終保持frameの次frame時刻。
     */
    const filters = [];

    /*
     * 映像と各音声streamは独立してsplit/trim/concatする。
     *
     * 音声は [0:a:0], [0:a:1] ... のaudio ordinalで扱うため、
     * MPEG-TS上のglobal stream indexが 1, 11 のように離れていてもよい。
     */
    filters.push(
        `[0:v:0]split=${normalized.length}` +
        normalized.map((_range, i) => `[vsrc${i}]`).join('')
    );

    for (let audioIndex = 0; audioIndex < audioStreamCount; audioIndex++) {
        filters.push(
            `[0:a:${audioIndex}]asplit=${normalized.length}` +
            normalized
                .map(
                    (_range, rangeIndex) =>
                        `[asrc${audioIndex}_${rangeIndex}]`
                )
                .join('')
        );
    }

    normalized.forEach((range, rangeIndex) => {
        /*
         * Video ranges use CM Analyzer's decoded-frame numbers.
         * keepRanges endFrame is inclusive, while FFmpeg end_frame is exclusive.
         */
        filters.push(
            `[vsrc${rangeIndex}]` +
            `trim=start_frame=${range.startFrame}:end_frame=${range.endFrame + 1},` +
            `setpts=PTS-STARTPTS` +
            `${filterFieldmatch ? ',fieldmatch=order=tff' : ''}` +
            `[v${rangeIndex}]`
        );

        /*
         * Audio must be cut at the PTS of the corresponding video frame.
         * MPEG-TS decoded video does not necessarily start at PTS 0.
         */
        const audioStart =
            videoStartTime + range.startFrame / frameRate;
        const audioEnd =
            videoStartTime + (range.endFrame + 1) / frameRate;

        for (
            let audioIndex = 0;
            audioIndex < audioStreamCount;
            audioIndex++
        ) {
            const audioDuration =
                (range.endFrame - range.startFrame + 1) / frameRate;

            filters.push(
                `[asrc${audioIndex}_${rangeIndex}]` +
                `atrim=start=${audioStart}:end=${audioEnd},` +
                `asetpts=PTS-${audioStart}/TB,` +
                `aresample=48000:async=1:first_pts=0,` +
                `apad=pad_dur=${audioDuration},` +
                `atrim=duration=${audioDuration},` +
                `asetpts=PTS-STARTPTS` +
                `[a${audioIndex}_${rangeIndex}]`
            );
        }
    });

    /*
     * Video concat.
     */
    filters.push(
        normalized
            .map((_range, rangeIndex) => `[v${rangeIndex}]`)
            .join('') +
        `concat=n=${normalized.length}:v=1:a=0[vcut]`
    );

    /*
     * Audio concat: streamごとに独立した出力を作る。
     * [acut0], [acut1], ...
     */
    for (let audioIndex = 0; audioIndex < audioStreamCount; audioIndex++) {
        filters.push(
            normalized
                .map(
                    (_range, rangeIndex) =>
                        `[a${audioIndex}_${rangeIndex}]`
                )
                .join('') +
            `concat=n=${normalized.length}:v=0:a=1[acut${audioIndex}]`
        );
    }

    output.filter = filters.join(';');

    /*
     * 出力先頭と、各keepRangeの接続点をchapterにする。
     */
    const positions = [0];
    let elapsed = 0;

    normalized.forEach((range, i) => {
        const frames = range.endFrame - range.startFrame + 1;
        elapsed += frames / frameRate;

        if (i < normalized.length - 1) {
            positions.push(elapsed);
        }
    });

    output.duration = elapsed;

    /*
     * CM境界以外の通常chapterが保持範囲内にある場合も、
     * カット後時間軸へ変換する。
     *
     * cm-start/cm-end/main-start/main-end は境界情報なので
     * splice chapterとは別に重複追加しない。
     */
    for (const chapter of chapters) {
        if (
            chapter.name === 'cm-start' ||
            chapter.name === 'cm-end' ||
            chapter.name === 'main-start' ||
            chapter.name === 'main-end'
        ) {
            continue;
        }

        const originalTime = Number(chapter.time);
        if (!Number.isFinite(originalTime)) {
            continue;
        }

        const frame = Math.round(originalTime * frameRate);

        let before = 0;

        for (const range of normalized) {
            if (frame < range.startFrame) {
                break;
            }

            if (frame <= range.endFrame) {
                positions.push(
                    before + (frame - range.startFrame) / frameRate
                );
                break;
            }

            before +=
                (range.endFrame - range.startFrame + 1) / frameRate;
        }
    }

    output.chapters = unique(positions);
}



if (command === '--filter' || command === '--filter-fieldmatch') {
    if (!output.filter) {
        process.exit(2);
    }

    process.stdout.write(output.filter);
    process.exit(0);
}

if (command === '--metadata') {
    const filename = process.argv[3];

    if (!filename) {
        throw new Error('MetadataFileIsNotSpecified');
    }

    if (output.chapters.length === 0) {
        process.exit(0);
    }

    let text = ';FFMETADATA1\n';

    for (let i = 0; i < output.chapters.length; i++) {
        const start = Math.max(
            0,
            Math.round(output.chapters[i] * 1000)
        );

        const next =
            i + 1 < output.chapters.length
                ? Math.round(output.chapters[i + 1] * 1000)
                : Number.isFinite(output.duration) &&
                  output.duration > output.chapters[i]
                ? Math.round(output.duration * 1000)
                : start + 1;

        text += '[CHAPTER]\n';
        text += 'TIMEBASE=1/1000\n';
        text += `START=${start}\n`;
        text += `END=${Math.max(start + 1, next)}\n`;
        text += `title=Chapter ${String(i + 1).padStart(2, '0')}\n`;
    }

    fs.writeFileSync(filename, text);
    process.exit(0);
}

process.stdout.write(JSON.stringify(output));

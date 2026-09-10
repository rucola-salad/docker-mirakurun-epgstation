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
const chapters = Array.isArray(timeline.chapters)
    ? timeline.chapters
    : [];
const keepRanges = Array.isArray(timeline.keepRanges)
    ? timeline.keepRanges
    : [];

if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error('InvalidTimelineFrameRate');
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
    const concatInputs = [];

    /*
     * 同じ入力streamを複数のtrim/atrimへ直接接続せず、
     * keepRange数だけ明示的にsplit/asplitしてから切り出す。
     */
    filters.push(
        `[0:v:0]split=${normalized.length}` +
        normalized.map((_range, i) => `[vsrc${i}]`).join('')
    );
    filters.push(
        `[0:a:0]asplit=${normalized.length}` +
        normalized.map((_range, i) => `[asrc${i}]`).join('')
    );

    normalized.forEach((range, i) => {
        const start = range.startFrame / frameRate;
        const end = (range.endFrame + 1) / frameRate;

        filters.push(
            `[vsrc${i}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS` +
            `${filterFieldmatch ? ',fieldmatch=order=tff' : ''}[v${i}]`
        );
        filters.push(
            `[asrc${i}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
        );

        concatInputs.push(`[v${i}][a${i}]`);
    });

    filters.push(
        `${concatInputs.join('')}concat=n=${normalized.length}:v=1:a=1[vcut][acut]`
    );

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

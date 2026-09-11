'use strict';

const fs = require('fs');

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const subtitleOffset = Number(process.argv[4]);
const timelineText = process.env.CM_TIMELINE || '';

if (!inputFile || !outputFile) {
    throw new Error(
        'Usage: cm-subtitle-helper.js input.srt output.srt subtitleOffset'
    );
}

if (!timelineText) {
    throw new Error('CM_TIMELINE is not specified');
}

if (!Number.isFinite(subtitleOffset)) {
    throw new Error('InvalidSubtitleOffset');
}

const timeline = JSON.parse(timelineText);
const frameRate = Number(timeline.frameRate);
const keepRanges = Array.isArray(timeline.keepRanges)
    ? timeline.keepRanges
    : [];

if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error('InvalidTimelineFrameRate');
}

if (keepRanges.length === 0) {
    throw new Error('KeepRangesIsEmpty');
}

const ranges = keepRanges
    .map(range => ({
        startFrame: Number(range.startFrame),
        endFrame: Number(range.endFrame)
    }))
    .sort((a, b) => a.startFrame - b.startFrame);

for (const range of ranges) {
    if (
        !Number.isInteger(range.startFrame) ||
        !Number.isInteger(range.endFrame) ||
        range.endFrame < range.startFrame
    ) {
        throw new Error('InvalidKeepRange');
    }
}

const parseTime = text => {
    const match = text.match(
        /^(\d+):(\d{2}):(\d{2}),(\d{3})$/
    );

    if (!match) {
        throw new Error(`InvalidSrtTime: ${text}`);
    }

    return (
        Number(match[1]) * 3600 +
        Number(match[2]) * 60 +
        Number(match[3]) +
        Number(match[4]) / 1000
    );
};

const formatTime = seconds => {
    const millis = Math.max(0, Math.round(seconds * 1000));

    const ms = millis % 1000;
    const totalSeconds = Math.floor(millis / 1000);

    const sec = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);

    const min = totalMinutes % 60;
    const hour = Math.floor(totalMinutes / 60);

    return (
        String(hour).padStart(2, '0') +
        ':' +
        String(min).padStart(2, '0') +
        ':' +
        String(sec).padStart(2, '0') +
        ',' +
        String(ms).padStart(3, '0')
    );
};

const hasVisibleText = text => {
    const visible = text
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\u200b/g, '')
        .trim();

    return visible.length > 0;
};

const parseSrt = text => {
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

    if (!normalized) {
        return [];
    }

    const blocks = normalized.split(/\n{2,}/);
    const cues = [];

    for (const block of blocks) {
        const lines = block.split('\n');

        const timingIndex = lines.findIndex(line =>
            line.includes(' --> ')
        );

        if (timingIndex < 0) {
            continue;
        }

        const timing = lines[timingIndex].match(
            /^(\d+:\d{2}:\d{2},\d{3})\s+-->\s+(\d+:\d{2}:\d{2},\d{3})/
        );

        if (!timing) {
            continue;
        }

        const body = lines
            .slice(timingIndex + 1)
            .join('\n');

        if (!hasVisibleText(body)) {
            continue;
        }

        cues.push({
            start: parseTime(timing[1]),
            end: parseTime(timing[2]),
            body
        });
    }

    return cues;
};

const source = fs.readFileSync(inputFile, 'utf8');
const cues = parseSrt(source);
const result = [];

let elapsedBeforeRange = 0;

for (const range of ranges) {
    const rangeStart =
        range.startFrame / frameRate;

    const rangeEnd =
        (range.endFrame + 1) / frameRate;

    for (const cue of cues) {
        /*
         * libaribb24 -> SRT は最初の字幕packetを0基準にする。
         *
         * subtitleOffset:
         *   subtitleFirstPTS(relative to input)
         *   - firstDecodedVideoPTS
         *
         * を加算することでCM Analyzerのframe 0基準へ戻す。
         */
        const sourceStart =
            cue.start + subtitleOffset;

        const sourceEnd =
            cue.end + subtitleOffset;

        const intersectionStart =
            Math.max(sourceStart, rangeStart);

        const intersectionEnd =
            Math.min(sourceEnd, rangeEnd);

        if (intersectionEnd <= intersectionStart) {
            continue;
        }

        const outputStart =
            elapsedBeforeRange +
            (intersectionStart - rangeStart);

        const outputEnd =
            elapsedBeforeRange +
            (intersectionEnd - rangeStart);

        if (outputEnd - outputStart < 0.001) {
            continue;
        }

        result.push({
            start: outputStart,
            end: outputEnd,
            body: cue.body
        });
    }

    elapsedBeforeRange +=
        (range.endFrame - range.startFrame + 1) /
        frameRate;
}

result.sort((a, b) => {
    if (Math.abs(a.start - b.start) > 0.0005) {
        return a.start - b.start;
    }

    return a.end - b.end;
});

let output = '';

for (let i = 0; i < result.length; i++) {
    const cue = result[i];

    output += `${i + 1}\n`;
    output +=
        `${formatTime(cue.start)} --> ${formatTime(cue.end)}\n`;
    output += `${cue.body}\n\n`;
}

fs.writeFileSync(outputFile, output);

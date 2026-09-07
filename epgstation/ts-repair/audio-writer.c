#define _POSIX_C_SOURCE 200809L

#include "audio-writer.h"

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <libavutil/samplefmt.h>

struct AudioWriter {
    int stream_index;
    int sample_rate;
    enum AVSampleFormat sample_fmt;
    int channels;
    int *fds;
    int64_t max_written_sample;
};

static void close_fds(AudioWriter *writer)
{
    int ch;

    if (!writer || !writer->fds)
        return;

    for (ch = 0; ch < writer->channels; ch++) {
        if (writer->fds[ch] >= 0)
            close(writer->fds[ch]);
    }
}

int audio_writer_open(AudioWriter **writer_out,
                      const char *work_dir,
                      int stream_index,
                      const AVFrame *first_frame)
{
    AudioWriter *writer;
    int ch;

    if (!writer_out || !work_dir || !first_frame)
        return -1;

    if (first_frame->format != AV_SAMPLE_FMT_FLTP) {
        fprintf(stderr,
                "ERROR: unsupported audio sample format: %s\n",
                av_get_sample_fmt_name(first_frame->format));
        return -1;
    }

    if (first_frame->sample_rate <= 0 ||
        first_frame->ch_layout.nb_channels <= 0) {
        fprintf(stderr, "ERROR: invalid audio frame format\n");
        return -1;
    }

    writer = calloc(1, sizeof(*writer));
    if (!writer)
        return -1;

    writer->stream_index = stream_index;
    writer->sample_rate = first_frame->sample_rate;
    writer->sample_fmt = first_frame->format;
    writer->channels = first_frame->ch_layout.nb_channels;

    writer->fds = malloc(sizeof(*writer->fds) * writer->channels);
    if (!writer->fds) {
        free(writer);
        return -1;
    }

    for (ch = 0; ch < writer->channels; ch++)
        writer->fds[ch] = -1;

    for (ch = 0; ch < writer->channels; ch++) {
        char path[4096];

        if (snprintf(path,
                     sizeof(path),
                     "%s/audio-%d-ch-%d.f32p",
                     work_dir,
                     stream_index,
                     ch) >= (int)sizeof(path)) {
            fprintf(stderr, "ERROR: audio work path too long\n");
            close_fds(writer);
            free(writer->fds);
            free(writer);
            return -1;
        }

        writer->fds[ch] =
            open(path, O_CREAT | O_TRUNC | O_RDWR, 0664);

        if (writer->fds[ch] < 0) {
            fprintf(stderr,
                    "ERROR: cannot open %s: %s\n",
                    path,
                    strerror(errno));
            close_fds(writer);
            free(writer->fds);
            free(writer);
            return -1;
        }
    }

    fprintf(stderr,
            "audio-writer: stream=%d rate=%d channels=%d format=%s\n",
            writer->stream_index,
            writer->sample_rate,
            writer->channels,
            av_get_sample_fmt_name(writer->sample_fmt));

    *writer_out = writer;
    return 0;
}

int audio_writer_accepts_frame(const AudioWriter *writer,
                               const AVFrame *frame)
{
    if (!writer || !frame)
        return 0;

    return frame->format == writer->sample_fmt &&
           frame->sample_rate == writer->sample_rate &&
           frame->ch_layout.nb_channels == writer->channels;
}

int audio_writer_write_samples(AudioWriter *writer,
                               int64_t target_sample,
                               const AVFrame *frame,
                               int source_sample,
                               int nb_samples)
{
    int ch;
    size_t bytes;
    size_t source_offset;
    off_t target_offset;

    if (!writer || !frame || target_sample < 0)
        return -1;

    if (frame->format != writer->sample_fmt ||
        frame->sample_rate != writer->sample_rate ||
        frame->ch_layout.nb_channels != writer->channels) {
        fprintf(stderr,
                "ERROR: audio frame format changed during decode: "
                "expected format=%s rate=%d channels=%d, "
                "got format=%s rate=%d channels=%d nb_samples=%d\n",
                av_get_sample_fmt_name(writer->sample_fmt),
                writer->sample_rate,
                writer->channels,
                av_get_sample_fmt_name(frame->format),
                frame->sample_rate,
                frame->ch_layout.nb_channels,
                frame->nb_samples);
        return -1;
    }

    if (source_sample < 0 ||
        nb_samples < 0 ||
        source_sample > frame->nb_samples ||
        nb_samples > frame->nb_samples - source_sample) {
        fprintf(stderr,
                "ERROR: invalid audio sample range: "
                "source_sample=%d nb_samples=%d frame_samples=%d\n",
                source_sample,
                nb_samples,
                frame->nb_samples);
        return -1;
    }

    if (nb_samples == 0)
        return 0;

    bytes = (size_t)nb_samples * sizeof(float);
    source_offset = (size_t)source_sample * sizeof(float);
    target_offset = (off_t)target_sample * (off_t)sizeof(float);

    for (ch = 0; ch < writer->channels; ch++) {
        const uint8_t *src = frame->extended_data[ch];
        size_t done = 0;

        if (!src) {
            fprintf(stderr,
                    "ERROR: missing audio plane %d\n",
                    ch);
            return -1;
        }

        src += source_offset;

        while (done < bytes) {
            ssize_t n =
                pwrite(writer->fds[ch],
                       src + done,
                       bytes - done,
                       target_offset + (off_t)done);

            if (n < 0) {
                if (errno == EINTR)
                    continue;

                fprintf(stderr,
                        "ERROR: pwrite audio stream=%d ch=%d: %s\n",
                        writer->stream_index,
                        ch,
                        strerror(errno));
                return -1;
            }

            if (n == 0) {
                fprintf(stderr,
                        "ERROR: zero-length pwrite\n");
                return -1;
            }

            done += (size_t)n;
        }
    }

    {
        int64_t end_sample =
            target_sample + nb_samples;

        if (end_sample > writer->max_written_sample)
            writer->max_written_sample = end_sample;
    }

    return 0;
}

int audio_writer_write(AudioWriter *writer,
                       int64_t target_sample,
                       const AVFrame *frame)
{
    if (!frame)
        return -1;

    return audio_writer_write_samples(writer,
                                      target_sample,
                                      frame,
                                      0,
                                      frame->nb_samples);
}

int64_t audio_writer_max_written_sample(const AudioWriter *writer)
{
    return writer ? writer->max_written_sample : 0;
}

void audio_writer_close(AudioWriter **writer_ptr)
{
    AudioWriter *writer;

    if (!writer_ptr || !*writer_ptr)
        return;

    writer = *writer_ptr;

    close_fds(writer);
    free(writer->fds);
    free(writer);

    *writer_ptr = NULL;
}

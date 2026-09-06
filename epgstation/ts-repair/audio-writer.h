#ifndef AUDIO_WRITER_H
#define AUDIO_WRITER_H

#include <stdint.h>

#include <libavutil/frame.h>

typedef struct AudioWriter AudioWriter;

int audio_writer_open(AudioWriter **writer,
                      const char *work_dir,
                      int stream_index,
                      const AVFrame *first_frame);

int audio_writer_write(AudioWriter *writer,
                       int64_t target_sample,
                       const AVFrame *frame);

int audio_writer_accepts_frame(const AudioWriter *writer,
                               const AVFrame *frame);

int64_t audio_writer_max_written_sample(const AudioWriter *writer);

void audio_writer_close(AudioWriter **writer);

#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <math.h>
#include <inttypes.h>

#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>

#include "audio-writer.h"

typedef struct {
    double src_pts;
    double repaired_time;
} TimelinePoint;

typedef struct {
    TimelinePoint *points;
    size_t count;
} TimelineMap;

typedef struct {
    int64_t decoded_frames;
    int64_t decoded_samples;

    int64_t before_frames;
    int64_t before_samples;
    int64_t after_frames;
    int64_t after_samples;

    int64_t mapped_frames;
    int64_t mapped_samples;

    int64_t overlap_events;
    int64_t overlap_samples;
    int64_t max_overlap;

    int64_t skipped_packets;
    int64_t decode_errors;

    int64_t last_end_sample;
    int have_last_end;
} Stats;

static int compare_timeline_point_by_src_pts(const void *lhs,
                                             const void *rhs)
{
    const TimelinePoint *a = lhs;
    const TimelinePoint *b = rhs;

    if (a->src_pts < b->src_pts)
        return -1;
    if (a->src_pts > b->src_pts)
        return 1;

    if (a->repaired_time < b->repaired_time)
        return -1;
    if (a->repaired_time > b->repaired_time)
        return 1;

    return 0;
}

static int load_timeline_map(const char *path, TimelineMap *map)
{
    FILE *fp = NULL;
    TimelinePoint *points = NULL;
    size_t count = 0;
    size_t capacity = 0;
    double src_pts;
    double repaired_time;

    memset(map, 0, sizeof(*map));

    fp = fopen(path, "r");
    if (!fp) {
        fprintf(stderr, "ERROR: cannot open map: %s: %s\n",
                path, strerror(errno));
        return -1;
    }

    while (fscanf(fp, "%lf %lf", &src_pts, &repaired_time) == 2) {
        if (count == capacity) {
            size_t new_capacity = capacity ? capacity * 2 : 4096;
            TimelinePoint *new_points =
                realloc(points, new_capacity * sizeof(*new_points));

            if (!new_points) {
                fprintf(stderr, "ERROR: out of memory loading map\n");
                free(points);
                fclose(fp);
                return -1;
            }

            points = new_points;
            capacity = new_capacity;
        }

        points[count].src_pts = src_pts;
        points[count].repaired_time = repaired_time;
        count++;
    }

    fclose(fp);

    if (count < 2) {
        fprintf(stderr, "ERROR: timeline map has too few points: %zu\n",
                count);
        free(points);
        return -1;
    }

    qsort(points,
          count,
          sizeof(*points),
          compare_timeline_point_by_src_pts);

    map->points = points;
    map->count = count;

    fprintf(stderr,
            "timeline: points=%zu src=[%.6f .. %.6f]\n",
            count,
            points[0].src_pts,
            points[count - 1].src_pts);

    return 0;
}

static int map_time(const TimelineMap *map,
                    double src_pts,
                    double *repaired_time)
{
    size_t lo;
    size_t hi;

    if (src_pts < map->points[0].src_pts ||
        src_pts > map->points[map->count - 1].src_pts)
        return -1;

    lo = 0;
    hi = map->count - 1;

    while (hi - lo > 1) {
        size_t mid = lo + (hi - lo) / 2;

        if (map->points[mid].src_pts <= src_pts)
            lo = mid;
        else
            hi = mid;
    }

    {
        const TimelinePoint *a = &map->points[lo];
        const TimelinePoint *b = &map->points[hi];
        double span = b->src_pts - a->src_pts;

        if (fabs(span) < 1e-12) {
            *repaired_time = a->repaired_time;
            return 0;
        }

        *repaired_time =
            a->repaired_time +
            (src_pts - a->src_pts) *
            (b->repaired_time - a->repaired_time) / span;
    }

    return 0;
}

static int process_frame(const TimelineMap *map,
                         const AVStream *stream,
                         const AVFrame *frame,
                         Stats *stats,
                         AudioWriter **writer,
                         const char *work_dir)
{
    int64_t ts;
    double src_pts;
    double repaired_time;
    int64_t target_sample;
    int64_t end_sample;

    stats->decoded_frames++;
    stats->decoded_samples += frame->nb_samples;

    ts = frame->best_effort_timestamp;
    if (ts == AV_NOPTS_VALUE) {
        fprintf(stderr,
                "ERROR: decoded audio frame has no timestamp\n");
        return -1;
    }

    src_pts = ts * av_q2d(stream->time_base);

    if (src_pts < map->points[0].src_pts) {
        stats->before_frames++;
        stats->before_samples += frame->nb_samples;
        return 0;
    }

    if (src_pts > map->points[map->count - 1].src_pts) {
        stats->after_frames++;
        stats->after_samples += frame->nb_samples;
        return 0;
    }

    if (map_time(map, src_pts, &repaired_time) < 0) {
        fprintf(stderr,
                "ERROR: cannot map audio timestamp %.6f\n",
                src_pts);
        return -1;
    }

    /*
     * Successful 3661 prototype placed each decoded audio frame at
     * its mapped position on the repaired video timeline.
     */
    target_sample =
        (int64_t)llround(repaired_time * frame->sample_rate);

    end_sample = target_sample + frame->nb_samples;

    if (!*writer) {
        if (audio_writer_open(writer,
                              work_dir,
                              stream->index,
                              frame) < 0) {
            fprintf(stderr, "ERROR: cannot open audio writer\n");
            return -1;
        }
    }

    if (!audio_writer_accepts_frame(*writer, frame)) {
        fprintf(stderr,
                "warning: skipping audio frame with changed format "
                "at src_pts=%.6f "
                "(format=%s rate=%d channels=%d samples=%d)\n",
                src_pts,
                av_get_sample_fmt_name(frame->format),
                frame->sample_rate,
                frame->ch_layout.nb_channels,
                frame->nb_samples);
        return 0;
    }

    if (audio_writer_write(*writer,
                           target_sample,
                           frame) < 0) {
        fprintf(stderr, "ERROR: cannot write mapped audio frame\n");
        return -1;
    }

    if (stats->have_last_end &&
        target_sample < stats->last_end_sample) {
        int64_t overlap = stats->last_end_sample - target_sample;

        if (overlap > frame->nb_samples)
            overlap = frame->nb_samples;

        stats->overlap_events++;
        stats->overlap_samples += overlap;

        if (overlap > stats->max_overlap)
            stats->max_overlap = overlap;
    }

    /*
     * This tracks the end of the most recently placed decoded frame,
     * not the maximum end ever seen. That matches overwrite-at-mapped-
     * position semantics when damaged timestamps move backwards.
     */
    stats->last_end_sample = end_sample;
    stats->have_last_end = 1;

    stats->mapped_frames++;
    stats->mapped_samples += frame->nb_samples;

    return 0;
}

static int drain_decoder(AVCodecContext *decoder,
                         const AVStream *stream,
                         const TimelineMap *map,
                         Stats *stats,
                         AudioWriter **writer,
                         const char *work_dir)
{
    AVFrame *frame = av_frame_alloc();
    int ret;

    if (!frame) {
        fprintf(stderr, "ERROR: cannot allocate audio frame\n");
        return AVERROR(ENOMEM);
    }

    for (;;) {
        ret = avcodec_receive_frame(decoder, frame);

        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) {
            av_frame_free(&frame);
            return ret;
        }

        if (ret < 0) {
            stats->decode_errors++;
            fprintf(stderr,
                    "warning: skipping undecodable audio data #%" PRId64
                    " (%s)\n",
                    stats->decode_errors,
                    av_err2str(ret));
            av_frame_free(&frame);
            return 0;
        }

        if (process_frame(map,
                          stream,
                          frame,
                          stats,
                          writer,
                          work_dir) < 0) {
            av_frame_free(&frame);
            return AVERROR_INVALIDDATA;
        }

        av_frame_unref(frame);
    }
}

int main(int argc, char **argv)
{
    AVFormatContext *fmt = NULL;
    AVCodecContext *decoder = NULL;
    const AVCodec *codec = NULL;
    AVPacket *pkt = NULL;
    AudioWriter *writer = NULL;
    TimelineMap map;
    Stats stats;
    int audio_index = -1;
    int ret = 1;
    unsigned int i;

    memset(&map, 0, sizeof(map));
    memset(&stats, 0, sizeof(stats));

    if (argc != 4) {
        fprintf(stderr,
                "Usage: %s input.ts video.map work-dir\n",
                argv[0]);
        return 2;
    }

    if (load_timeline_map(argv[2], &map) < 0)
        goto cleanup;

    if (avformat_open_input(&fmt, argv[1], NULL, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot open input: %s\n", argv[1]);
        goto cleanup;
    }

    if (avformat_find_stream_info(fmt, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot read stream information\n");
        goto cleanup;
    }

    for (i = 0; i < fmt->nb_streams; i++) {
        if (fmt->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
            audio_index = (int)i;
            break;
        }
    }

    if (audio_index < 0) {
        fprintf(stderr, "ERROR: no audio stream\n");
        goto cleanup;
    }

    codec = avcodec_find_decoder(
        fmt->streams[audio_index]->codecpar->codec_id);

    if (!codec) {
        fprintf(stderr, "ERROR: audio decoder not found\n");
        goto cleanup;
    }

    decoder = avcodec_alloc_context3(codec);
    if (!decoder) {
        fprintf(stderr, "ERROR: cannot allocate decoder\n");
        goto cleanup;
    }

    if (avcodec_parameters_to_context(
            decoder,
            fmt->streams[audio_index]->codecpar) < 0) {
        fprintf(stderr, "ERROR: cannot copy codec parameters\n");
        goto cleanup;
    }

    if (avcodec_open2(decoder, codec, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot open audio decoder\n");
        goto cleanup;
    }

    fprintf(stderr,
            "audio: stream=%d codec=%s rate=%d channels=%d\n",
            audio_index,
            codec->name,
            decoder->sample_rate,
            decoder->ch_layout.nb_channels);

    pkt = av_packet_alloc();
    if (!pkt) {
        fprintf(stderr, "ERROR: cannot allocate packet\n");
        goto cleanup;
    }

    while (av_read_frame(fmt, pkt) >= 0) {
        if (pkt->stream_index == audio_index) {
            int sendret = avcodec_send_packet(decoder, pkt);

            if (sendret == AVERROR(EAGAIN)) {
                int drainret =
                    drain_decoder(decoder,
                                  fmt->streams[audio_index],
                                  &map,
                                  &stats,
                                  &writer,
                                  argv[3]);

                if (drainret < 0 && drainret != AVERROR(EAGAIN))
                    goto cleanup;

                sendret = avcodec_send_packet(decoder, pkt);
            }

            if (sendret < 0) {
                stats.skipped_packets++;
                fprintf(stderr,
                        "warning: skipping undecodable audio packet #%" PRId64
                        " (%s)\n",
                        stats.skipped_packets,
                        av_err2str(sendret));
                av_packet_unref(pkt);
                continue;
            }

            {
                int drainret =
                    drain_decoder(decoder,
                                  fmt->streams[audio_index],
                                  &map,
                                  &stats,
                                  &writer,
                                  argv[3]);

                if (drainret < 0 &&
                    drainret != AVERROR(EAGAIN) &&
                    drainret != AVERROR_EOF)
                    goto cleanup;
            }
        }

        av_packet_unref(pkt);
    }

    if (avcodec_send_packet(decoder, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot flush audio decoder\n");
        goto cleanup;
    }

    for (;;) {
        int drainret =
            drain_decoder(decoder,
                          fmt->streams[audio_index],
                          &map,
                          &stats,
                          &writer,
                          argv[3]);

        if (drainret == AVERROR_EOF)
            break;

        if (drainret == AVERROR(EAGAIN))
            continue;

        if (drainret < 0)
            goto cleanup;
    }

    printf("SUMMARY\n");
    printf("decoded_frames=%" PRId64 "\n", stats.decoded_frames);
    printf("decoded_samples=%" PRId64 "\n", stats.decoded_samples);
    printf("before_frames=%" PRId64 "\n", stats.before_frames);
    printf("before_samples=%" PRId64 "\n", stats.before_samples);
    printf("after_frames=%" PRId64 "\n", stats.after_frames);
    printf("after_samples=%" PRId64 "\n", stats.after_samples);
    printf("mapped_frames=%" PRId64 "\n", stats.mapped_frames);
    printf("mapped_samples=%" PRId64 "\n", stats.mapped_samples);
    printf("overlap_events=%" PRId64 "\n", stats.overlap_events);
    printf("overlap_samples=%" PRId64 "\n", stats.overlap_samples);
    printf("max_overlap=%" PRId64 "\n", stats.max_overlap);
    printf("skipped_packets=%" PRId64 "\n", stats.skipped_packets);
    printf("decode_errors=%" PRId64 "\n", stats.decode_errors);
    printf("max_written_sample=%" PRId64 "\n",
           audio_writer_max_written_sample(writer));

    ret = 0;

cleanup:
    audio_writer_close(&writer);
    av_packet_free(&pkt);
    avcodec_free_context(&decoder);

    if (fmt)
        avformat_close_input(&fmt);

    free(map.points);

    return ret;
}

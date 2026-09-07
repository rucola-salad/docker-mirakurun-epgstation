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
#include <libavutil/opt.h>

#include "audio-writer.h"
#include "timeline-map.h"

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

    double last_src_pts;
    double last_repaired_time;
    int64_t last_target_sample;
    int have_last_frame;

    int64_t overlap_duplicate_pts;
    int64_t overlap_forward_target;
    int64_t overlap_backward_target;

    int64_t full_cut_frames;
    int64_t partial_trim_frames;
    int64_t cut_samples;

    int64_t written_chunks;
    int64_t written_samples;
} Stats;

typedef struct {
    int stream_index;
    AVStream *stream;
    AVCodecContext *decoder;
    AudioWriter *writer;
    Stats stats;
} AudioRepairStream;

static int64_t source_sample_from_pts(const TimelineMap *map,
                                      double src_pts,
                                      int sample_rate)
{
    return (int64_t)llround(
        (src_pts - map->points[0].src_pts) *
        sample_rate);
}

static void cut_sample_range(const TimelineMap *map,
                             size_t cut_index,
                             int sample_rate,
                             int64_t *start_sample,
                             int64_t *end_sample)
{
    const TimelineCut *cut = &map->cuts[cut_index];

    *start_sample =
        source_sample_from_pts(map,
                               cut->start_src_pts,
                               sample_rate);

    *end_sample =
        source_sample_from_pts(map,
                               cut->end_src_pts,
                               sample_rate);
}

static int64_t removed_samples_before(const TimelineMap *map,
                                      int64_t source_sample,
                                      int sample_rate)
{
    int64_t removed = 0;
    size_t i;

    for (i = 0; i < map->cut_count; i++) {
        int64_t cut_start;
        int64_t cut_end;

        cut_sample_range(map,
                         i,
                         sample_rate,
                         &cut_start,
                         &cut_end);

        if (cut_end <= cut_start)
            continue;

        if (source_sample <= cut_start)
            break;

        if (source_sample >= cut_end) {
            removed += cut_end - cut_start;
            continue;
        }

        removed += source_sample - cut_start;
        break;
    }

    return removed;
}

static int64_t map_source_sample(const TimelineMap *map,
                                 int64_t source_sample,
                                 int sample_rate)
{
    int64_t repaired_origin =
        (int64_t)llround(
            map->points[0].repaired_time *
            sample_rate);

    return repaired_origin +
           source_sample -
           removed_samples_before(map,
                                  source_sample,
                                  sample_rate);
}

static int write_audio_chunk(const TimelineMap *map,
                             const AVFrame *frame,
                             double src_pts,
                             int source_offset,
                             int nb_samples,
                             Stats *stats,
                             AudioWriter *writer)
{
    int64_t frame_source_sample;
    int64_t chunk_source_sample;
    int64_t target_sample;
    int64_t end_sample;
    double repaired_time;

    if (nb_samples <= 0)
        return 0;

    frame_source_sample =
        source_sample_from_pts(map,
                               src_pts,
                               frame->sample_rate);

    chunk_source_sample =
        frame_source_sample + source_offset;

    target_sample =
        map_source_sample(map,
                          chunk_source_sample,
                          frame->sample_rate);

    repaired_time =
        (double)target_sample /
        frame->sample_rate;

    end_sample = target_sample + nb_samples;

    if (audio_writer_write_samples(writer,
                                   target_sample,
                                   frame,
                                   source_offset,
                                   nb_samples) < 0) {
        fprintf(stderr,
                "ERROR: cannot write mapped audio samples\n");
        return -1;
    }

    if (stats->have_last_end &&
        target_sample < stats->last_end_sample) {
        int64_t overlap =
            stats->last_end_sample - target_sample;
        double src_delta = 0.0;
        double repaired_delta = 0.0;
        int64_t target_delta = 0;

        if (overlap > nb_samples)
            overlap = nb_samples;

        stats->overlap_events++;
        stats->overlap_samples += overlap;

        if (overlap > stats->max_overlap)
            stats->max_overlap = overlap;

        if (stats->have_last_frame) {
            src_delta =
                src_pts - stats->last_src_pts;

            repaired_delta =
                repaired_time -
                stats->last_repaired_time;

            target_delta =
                target_sample -
                stats->last_target_sample;

            if (fabs(src_delta) < 1e-9)
                stats->overlap_duplicate_pts++;
            else if (target_delta < 0)
                stats->overlap_backward_target++;
            else
                stats->overlap_forward_target++;

            fprintf(stderr,
                    "OVERLAP "
                    "src_prev=%.6f src=%.6f src_delta=%.6f "
                    "repaired_prev=%.9f repaired=%.9f "
                    "repaired_delta=%.9f "
                    "target_prev=%" PRId64 " target=%" PRId64 " "
                    "target_delta=%" PRId64 " "
                    "prev_end=%" PRId64 " overlap=%" PRId64 " "
                    "samples=%d source_offset=%d\n",
                    stats->last_src_pts,
                    src_pts,
                    src_delta,
                    stats->last_repaired_time,
                    repaired_time,
                    repaired_delta,
                    stats->last_target_sample,
                    target_sample,
                    target_delta,
                    stats->last_end_sample,
                    overlap,
                    nb_samples,
                    source_offset);
        }
    }

    stats->last_src_pts = src_pts;
    stats->last_repaired_time = repaired_time;
    stats->last_target_sample = target_sample;
    stats->have_last_frame = 1;

    stats->last_end_sample = end_sample;
    stats->have_last_end = 1;

    stats->written_chunks++;
    stats->written_samples += nb_samples;

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
    int64_t frame_source_start;
    int64_t frame_source_end;
    int pos = 0;
    int removed_in_frame = 0;
    size_t i;

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

    if (!*writer) {
        if (audio_writer_open(writer,
                              work_dir,
                              stream->index,
                              frame) < 0) {
            fprintf(stderr,
                    "ERROR: cannot open audio writer\n");
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

    frame_source_start =
        source_sample_from_pts(map,
                               src_pts,
                               frame->sample_rate);

    frame_source_end =
        frame_source_start + frame->nb_samples;

    /*
     * Intersect the decoded frame with CUT AT END intervals in the
     * same integer 48 kHz sample coordinate system used for mapping.
     *
     * This intentionally avoids independently rounding repaired
     * floating-point timestamps for every AAC frame.  The same cut
     * boundaries are therefore used both for trimming and shifting.
     */
    for (i = 0; i < map->cut_count; i++) {
        int64_t cut_start;
        int64_t cut_end;
        int64_t overlap_start;
        int64_t overlap_end;
        int remove_start;
        int remove_end;

        cut_sample_range(map,
                         i,
                         frame->sample_rate,
                         &cut_start,
                         &cut_end);

        if (cut_end <= frame_source_start)
            continue;

        if (cut_start >= frame_source_end)
            break;

        overlap_start =
            cut_start > frame_source_start
                ? cut_start
                : frame_source_start;

        overlap_end =
            cut_end < frame_source_end
                ? cut_end
                : frame_source_end;

        if (overlap_end <= overlap_start)
            continue;

        remove_start =
            (int)(overlap_start -
                  frame_source_start);

        remove_end =
            (int)(overlap_end -
                  frame_source_start);

        if (remove_start > pos) {
            if (write_audio_chunk(map,
                                  frame,
                                  src_pts,
                                  pos,
                                  remove_start - pos,
                                  stats,
                                  *writer) < 0)
                return -1;
        }

        if (remove_end > pos) {
            removed_in_frame +=
                remove_end -
                (remove_start > pos
                     ? remove_start
                     : pos);

            pos = remove_end;
        }
    }

    if (pos < frame->nb_samples) {
        if (write_audio_chunk(map,
                              frame,
                              src_pts,
                              pos,
                              frame->nb_samples - pos,
                              stats,
                              *writer) < 0)
            return -1;
    }

    if (removed_in_frame >= frame->nb_samples)
        stats->full_cut_frames++;
    else if (removed_in_frame > 0)
        stats->partial_trim_frames++;

    stats->cut_samples += removed_in_frame;

    /*
     * mapped_* remains a decoded-frame accounting counter.
     * written_* reports the actual surviving output after cuts.
     */
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
    AVPacket *pkt = NULL;
    AudioRepairStream *audio_streams = NULL;
    size_t audio_stream_count = 0;
    TimelineMap map;
    int ret = 1;
    unsigned int i;

    memset(&map, 0, sizeof(map));

    if (argc != 4) {
        fprintf(stderr,
                "Usage: %s input.ts video.map work-dir\n",
                argv[0]);
        return 2;
    }

    if (timeline_map_load(argv[2], &map) < 0)
        goto cleanup;

    if (avformat_open_input(&fmt, argv[1], NULL, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot open input: %s\n", argv[1]);
        goto cleanup;
    }

    if (avformat_find_stream_info(fmt, NULL) < 0) {
        fprintf(stderr, "ERROR: cannot read stream information\n");
        goto cleanup;
    }

    /*
     * Discover every audio stream.
     *
     * TS Repair must not silently discard secondary audio streams.
     */
    for (i = 0; i < fmt->nb_streams; i++) {
        if (fmt->streams[i]->codecpar->codec_type ==
            AVMEDIA_TYPE_AUDIO) {
            audio_stream_count++;
        }
    }

    if (audio_stream_count == 0) {
        fprintf(stderr, "ERROR: no audio stream\n");
        goto cleanup;
    }

    audio_streams =
        calloc(audio_stream_count, sizeof(*audio_streams));

    if (!audio_streams) {
        fprintf(stderr,
                "ERROR: cannot allocate audio stream contexts\n");
        goto cleanup;
    }

    /*
     * Create one decoder / writer / statistics context per
     * original audio stream.
     */
    {
        size_t a = 0;

        for (i = 0; i < fmt->nb_streams; i++) {
            AVStream *stream = fmt->streams[i];
            AudioRepairStream *ars;
            const AVCodec *codec;

            if (stream->codecpar->codec_type !=
                AVMEDIA_TYPE_AUDIO) {
                continue;
            }

            ars = &audio_streams[a++];
            ars->stream_index = (int)i;
            ars->stream = stream;

            codec =
                avcodec_find_decoder(stream->codecpar->codec_id);

            if (!codec) {
                fprintf(stderr,
                        "ERROR: audio decoder not found "
                        "for stream=%d\n",
                        ars->stream_index);
                goto cleanup;
            }

            ars->decoder = avcodec_alloc_context3(codec);

            if (!ars->decoder) {
                fprintf(stderr,
                        "ERROR: cannot allocate decoder "
                        "for stream=%d\n",
                        ars->stream_index);
                goto cleanup;
            }

            if (avcodec_parameters_to_context(
                    ars->decoder,
                    stream->codecpar) < 0) {
                fprintf(stderr,
                        "ERROR: cannot copy codec parameters "
                        "for stream=%d\n",
                        ars->stream_index);
                goto cleanup;
            }

            /*
             * Japanese broadcast AAC can carry dual-mono.
             *
             * Decode BOTH Main and Sub when the AAC decoder
             * supports the FFmpeg dual_mono_mode extension.
             * Failure to set it is non-fatal because ordinary AAC
             * streams do not require this option.
             */
            if (stream->codecpar->codec_id == AV_CODEC_ID_AAC &&
                ars->decoder->priv_data) {
                int optret =
                    av_opt_set(ars->decoder->priv_data,
                               "dual_mono_mode",
                               "both",
                               0);

                if (optret < 0) {
                    fprintf(stderr,
                            "warning: cannot set "
                            "dual_mono_mode=both "
                            "for stream=%d (%s)\n",
                            ars->stream_index,
                            av_err2str(optret));
                }
            }

            if (avcodec_open2(ars->decoder,
                              codec,
                              NULL) < 0) {
                fprintf(stderr,
                        "ERROR: cannot open audio decoder "
                        "for stream=%d\n",
                        ars->stream_index);
                goto cleanup;
            }

            fprintf(stderr,
                    "audio: stream=%d codec=%s "
                    "rate=%d channels=%d\n",
                    ars->stream_index,
                    codec->name,
                    ars->decoder->sample_rate,
                    ars->decoder->ch_layout.nb_channels);
        }
    }

    pkt = av_packet_alloc();

    if (!pkt) {
        fprintf(stderr, "ERROR: cannot allocate packet\n");
        goto cleanup;
    }

    /*
     * Read the TS once and dispatch each audio packet to the
     * matching decoder.
     */
    while (av_read_frame(fmt, pkt) >= 0) {
        size_t a;

        for (a = 0; a < audio_stream_count; a++) {
            AudioRepairStream *ars = &audio_streams[a];

            if (pkt->stream_index != ars->stream_index)
                continue;

            {
                int sendret =
                    avcodec_send_packet(ars->decoder, pkt);

                if (sendret == AVERROR(EAGAIN)) {
                    int drainret =
                        drain_decoder(ars->decoder,
                                      ars->stream,
                                      &map,
                                      &ars->stats,
                                      &ars->writer,
                                      argv[3]);

                    if (drainret < 0 &&
                        drainret != AVERROR(EAGAIN)) {
                        goto cleanup;
                    }

                    sendret =
                        avcodec_send_packet(ars->decoder, pkt);
                }

                if (sendret < 0) {
                    ars->stats.skipped_packets++;

                    fprintf(stderr,
                            "warning: skipping undecodable "
                            "audio packet stream=%d "
                            "#%" PRId64 " (%s)\n",
                            ars->stream_index,
                            ars->stats.skipped_packets,
                            av_err2str(sendret));

                    break;
                }

                {
                    int drainret =
                        drain_decoder(ars->decoder,
                                      ars->stream,
                                      &map,
                                      &ars->stats,
                                      &ars->writer,
                                      argv[3]);

                    if (drainret < 0 &&
                        drainret != AVERROR(EAGAIN) &&
                        drainret != AVERROR_EOF) {
                        goto cleanup;
                    }
                }
            }

            break;
        }

        av_packet_unref(pkt);
    }

    /*
     * Flush every audio decoder independently.
     */
    {
        size_t a;

        for (a = 0; a < audio_stream_count; a++) {
            AudioRepairStream *ars = &audio_streams[a];

            if (avcodec_send_packet(ars->decoder, NULL) < 0) {
                fprintf(stderr,
                        "ERROR: cannot flush audio decoder "
                        "stream=%d\n",
                        ars->stream_index);
                goto cleanup;
            }

            for (;;) {
                int drainret =
                    drain_decoder(ars->decoder,
                                  ars->stream,
                                  &map,
                                  &ars->stats,
                                  &ars->writer,
                                  argv[3]);

                if (drainret == AVERROR_EOF)
                    break;

                if (drainret == AVERROR(EAGAIN))
                    continue;

                if (drainret < 0)
                    goto cleanup;
            }
        }
    }

    /*
     * Report each original audio stream independently.
     */
    {
        size_t a;

        for (a = 0; a < audio_stream_count; a++) {
            AudioRepairStream *ars = &audio_streams[a];
            Stats *stats = &ars->stats;

            printf("SUMMARY stream=%d\n",
                   ars->stream_index);

            printf("decoded_frames=%" PRId64 "\n",
                   stats->decoded_frames);
            printf("decoded_samples=%" PRId64 "\n",
                   stats->decoded_samples);
            printf("before_frames=%" PRId64 "\n",
                   stats->before_frames);
            printf("before_samples=%" PRId64 "\n",
                   stats->before_samples);
            printf("after_frames=%" PRId64 "\n",
                   stats->after_frames);
            printf("after_samples=%" PRId64 "\n",
                   stats->after_samples);
            printf("mapped_frames=%" PRId64 "\n",
                   stats->mapped_frames);
            printf("mapped_samples=%" PRId64 "\n",
                   stats->mapped_samples);
            printf("overlap_events=%" PRId64 "\n",
                   stats->overlap_events);
            printf("overlap_samples=%" PRId64 "\n",
                   stats->overlap_samples);
            printf("max_overlap=%" PRId64 "\n",
                   stats->max_overlap);

            printf("overlap_duplicate_pts=%" PRId64 "\n",
                   stats->overlap_duplicate_pts);
            printf("overlap_forward_target=%" PRId64 "\n",
                   stats->overlap_forward_target);
            printf("overlap_backward_target=%" PRId64 "\n",
                   stats->overlap_backward_target);

            printf("full_cut_frames=%" PRId64 "\n",
                   stats->full_cut_frames);
            printf("partial_trim_frames=%" PRId64 "\n",
                   stats->partial_trim_frames);
            printf("cut_samples=%" PRId64 "\n",
                   stats->cut_samples);

            printf("written_chunks=%" PRId64 "\n",
                   stats->written_chunks);
            printf("written_samples=%" PRId64 "\n",
                   stats->written_samples);

            printf("skipped_packets=%" PRId64 "\n",
                   stats->skipped_packets);
            printf("decode_errors=%" PRId64 "\n",
                   stats->decode_errors);

            printf("max_written_sample=%" PRId64 "\n",
                   audio_writer_max_written_sample(
                       ars->writer));
        }
    }

    ret = 0;

cleanup:
    if (audio_streams) {
        size_t a;

        for (a = 0; a < audio_stream_count; a++) {
            audio_writer_close(
                &audio_streams[a].writer);

            avcodec_free_context(
                &audio_streams[a].decoder);
        }

        free(audio_streams);
    }

    av_packet_free(&pkt);

    if (fmt)
        avformat_close_input(&fmt);

    timeline_map_free(&map);

    return ret;
}

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <math.h>
#include <inttypes.h>

#include <libavformat/avformat.h>
#include <libavcodec/codec_par.h>
#include <libavutil/avutil.h>
#include <libavutil/mathematics.h>

typedef struct {
    double src_pts;
    double repaired_time;
} TimelinePoint;

typedef struct {
    TimelinePoint *points;
    size_t count;
} TimelineMap;

static void print_error(const char *what, int err)
{
    char buf[AV_ERROR_MAX_STRING_SIZE];
    av_strerror(err, buf, sizeof(buf));
    fprintf(stderr, "ERROR: %s: %s\n", what, buf);
}

static int compare_timeline_point_by_src_pts(const void *lhs,
                                             const void *rhs)
{
    const TimelinePoint *a = lhs;
    const TimelinePoint *b = rhs;

    if (a->src_pts < b->src_pts)
        return -1;
    if (a->src_pts > b->src_pts)
        return 1;

    /*
     * Damaged input may contain duplicate source PTS values.
     * Keep ordering deterministic by using repaired time as a tie-breaker.
     */
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

    /*
     * 3661-full-video-map.txt is in decoded video order.
     * Damaged TS timestamps can move backwards, while subtitle mapping needs
     * lookup by original PTS. Sort a private copy by source PTS.
     */
    qsort(points,
          count,
          sizeof(*points),
          compare_timeline_point_by_src_pts);

    map->points = points;
    map->count = count;

    fprintf(stderr,
            "timeline: points=%zu src=[%.6f .. %.6f] repaired=[%.6f .. %.6f]\n",
            count,
            points[0].src_pts,
            points[count - 1].src_pts,
            points[0].repaired_time,
            points[count - 1].repaired_time);

    return 0;
}

static int map_time(const TimelineMap *map,
                    double src_pts,
                    double *repaired_time)
{
    size_t lo;
    size_t hi;

    if (src_pts < map->points[0].src_pts ||
        src_pts > map->points[map->count - 1].src_pts) {
        return -1;
    }

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

static int find_first_video_pts(const char *path,
                                int64_t *video_pts,
                                AVRational *video_time_base)
{
    AVFormatContext *fmt = NULL;
    AVPacket *pkt = NULL;
    int video_index = -1;
    int ret;

    *video_pts = AV_NOPTS_VALUE;
    *video_time_base = (AVRational){0, 1};

    ret = avformat_open_input(&fmt, path, NULL, NULL);
    if (ret < 0) {
        print_error("open media for video PTS origin", ret);
        goto cleanup;
    }

    ret = avformat_find_stream_info(fmt, NULL);
    if (ret < 0) {
        print_error("find media stream info for video PTS origin", ret);
        goto cleanup;
    }

    for (unsigned int i = 0; i < fmt->nb_streams; i++) {
        if (fmt->streams[i]->codecpar->codec_type ==
            AVMEDIA_TYPE_VIDEO) {
            video_index = (int)i;
            break;
        }
    }

    if (video_index < 0) {
        fprintf(stderr, "ERROR: repaired media has no video stream\n");
        ret = AVERROR_STREAM_NOT_FOUND;
        goto cleanup;
    }

    pkt = av_packet_alloc();
    if (!pkt) {
        ret = AVERROR(ENOMEM);
        goto cleanup;
    }

    while ((ret = av_read_frame(fmt, pkt)) >= 0) {
        if (pkt->stream_index == video_index &&
            pkt->pts != AV_NOPTS_VALUE) {

            *video_pts = pkt->pts;
            *video_time_base =
                fmt->streams[video_index]->time_base;

            fprintf(stderr,
                    "media video origin:"
                    " stream=%d pts=%" PRId64
                    " time_base=%d/%d seconds=%.6f\n",
                    video_index,
                    *video_pts,
                    video_time_base->num,
                    video_time_base->den,
                    *video_pts * av_q2d(*video_time_base));

            ret = 0;
            goto cleanup;
        }

        av_packet_unref(pkt);
    }

    if (ret == AVERROR_EOF) {
        fprintf(stderr,
                "ERROR: repaired media has no video packet with PTS\n");
        ret = AVERROR_INVALIDDATA;
    } else {
        print_error("read media for video PTS origin", ret);
    }

cleanup:
    av_packet_free(&pkt);
    avformat_close_input(&fmt);
    return ret;
}

static int64_t map_timestamp(const TimelineMap *map,
                             int64_t ts,
                             AVRational tb,
                             int64_t video_origin_pts,
                             AVRational video_origin_tb,
                             int *mapped)
{
    double src_time;
    double dst_time;

    *mapped = 0;

    if (ts == AV_NOPTS_VALUE)
        return AV_NOPTS_VALUE;

    src_time = ts * av_q2d(tb);

    if (map_time(map, src_time, &dst_time) < 0)
        return AV_NOPTS_VALUE;

    *mapped = 1;

    return av_rescale_q(
               (int64_t)llround(dst_time * AV_TIME_BASE),
               AV_TIME_BASE_Q,
               tb)
         + av_rescale_q(
               video_origin_pts,
               video_origin_tb,
               tb);
}

static int copy_stream(AVFormatContext *out,
                       AVStream *in_stream,
                       AVStream **out_stream)
{
    AVStream *st;
    int ret;

    st = avformat_new_stream(out, NULL);
    if (!st)
        return AVERROR(ENOMEM);

    ret = avcodec_parameters_copy(st->codecpar, in_stream->codecpar);
    if (ret < 0)
        return ret;

    st->codecpar->codec_tag = 0;
    st->time_base = in_stream->time_base;

    *out_stream = st;
    return 0;
}

static void usage(const char *prog)
{
    fprintf(stderr,
        "Usage:\n"
        "  %s --media repaired-av.ts --source original.ts "
        "--map video-map.txt --output repaired-final.ts\n",
        prog);
}

int main(int argc, char **argv)
{
    const char *media_path = NULL;
    const char *source_path = NULL;
    const char *map_path = NULL;
    const char *output_path = NULL;

    AVFormatContext *media = NULL;
    AVFormatContext *source = NULL;
    AVFormatContext *out = NULL;

    int *media_stream_map = NULL;
    int subtitle_input_index = -1;
    int subtitle_output_index = -1;

    TimelineMap timeline = {0};

    int64_t media_video_origin_pts = AV_NOPTS_VALUE;
    AVRational media_video_origin_tb = {0, 1};

    int ret = 1;
    int avret;

    int64_t subtitle_packets = 0;
    int64_t subtitle_mapped = 0;
    int64_t subtitle_skipped = 0;
    int64_t subtitle_no_pts = 0;
    int64_t subtitle_backward = 0;
    int64_t last_subtitle_pts = AV_NOPTS_VALUE;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--media") && i + 1 < argc) {
            media_path = argv[++i];
        } else if (!strcmp(argv[i], "--source") && i + 1 < argc) {
            source_path = argv[++i];
        } else if (!strcmp(argv[i], "--map") && i + 1 < argc) {
            map_path = argv[++i];
        } else if (!strcmp(argv[i], "--output") && i + 1 < argc) {
            output_path = argv[++i];
        } else {
            usage(argv[0]);
            return 2;
        }
    }

    if (!media_path || !source_path || !map_path || !output_path) {
        usage(argv[0]);
        return 2;
    }

    if (load_timeline_map(map_path, &timeline) < 0)
        goto cleanup;

    avret = find_first_video_pts(
        media_path,
        &media_video_origin_pts,
        &media_video_origin_tb);
    if (avret < 0)
        goto cleanup;

    avret = avformat_open_input(&media, media_path, NULL, NULL);
    if (avret < 0) {
        print_error("open media", avret);
        goto cleanup;
    }

    avret = avformat_find_stream_info(media, NULL);
    if (avret < 0) {
        print_error("find media stream info", avret);
        goto cleanup;
    }

    avret = avformat_open_input(&source, source_path, NULL, NULL);
    if (avret < 0) {
        print_error("open source", avret);
        goto cleanup;
    }

    avret = avformat_find_stream_info(source, NULL);
    if (avret < 0) {
        print_error("find source stream info", avret);
        goto cleanup;
    }

    /*
     * First subtitle stream is used for this proof.
     * For 3661 this is ARIB caption Profile A.
     */
    for (unsigned int i = 0; i < source->nb_streams; i++) {
        if (source->streams[i]->codecpar->codec_type ==
            AVMEDIA_TYPE_SUBTITLE) {
            subtitle_input_index = (int)i;
            break;
        }
    }

    if (subtitle_input_index < 0) {
        fprintf(stderr, "ERROR: source has no subtitle stream\n");
        goto cleanup;
    }

    fprintf(stderr,
            "subtitle: input_stream=%d codec=%s time_base=%d/%d\n",
            subtitle_input_index,
            avcodec_get_name(
                source->streams[subtitle_input_index]->codecpar->codec_id),
            source->streams[subtitle_input_index]->time_base.num,
            source->streams[subtitle_input_index]->time_base.den);

    avret = avformat_alloc_output_context2(
        &out, NULL, "mpegts", output_path);
    if (avret < 0 || !out) {
        print_error("allocate output", avret);
        goto cleanup;
    }

    media_stream_map =
        malloc(media->nb_streams * sizeof(*media_stream_map));
    if (!media_stream_map) {
        fprintf(stderr, "ERROR: out of memory\n");
        goto cleanup;
    }

    for (unsigned int i = 0; i < media->nb_streams; i++)
        media_stream_map[i] = -1;

    /*
     * Preserve every stream already present in repaired media.
     */
    for (unsigned int i = 0; i < media->nb_streams; i++) {
        AVStream *out_stream = NULL;

        avret = copy_stream(out, media->streams[i], &out_stream);
        if (avret < 0) {
            print_error("copy media stream", avret);
            goto cleanup;
        }

        media_stream_map[i] = out_stream->index;

        fprintf(stderr,
                "media: input_stream=%u -> output_stream=%d codec=%s\n",
                i,
                out_stream->index,
                avcodec_get_name(media->streams[i]->codecpar->codec_id));
    }

    {
        AVStream *subtitle_out = NULL;

        avret = copy_stream(
            out,
            source->streams[subtitle_input_index],
            &subtitle_out);

        if (avret < 0) {
            print_error("copy subtitle stream", avret);
            goto cleanup;
        }

        subtitle_output_index = subtitle_out->index;
    }

    if (!(out->oformat->flags & AVFMT_NOFILE)) {
        avret = avio_open(&out->pb, output_path, AVIO_FLAG_WRITE);
        if (avret < 0) {
            print_error("open output", avret);
            goto cleanup;
        }
    }

    avret = avformat_write_header(out, NULL);
    if (avret < 0) {
        print_error("write header", avret);
        goto cleanup;
    }

    /*
     * Merge repaired media and mapped subtitle packets by output DTS.
     */
    {
        AVPacket *media_pkt = av_packet_alloc();
        AVPacket *subtitle_pkt = av_packet_alloc();

        AVStream *subtitle_in =
            source->streams[subtitle_input_index];
        AVStream *subtitle_out =
            out->streams[subtitle_output_index];

        int media_have = 0;
        int subtitle_have = 0;
        int media_eof = 0;
        int subtitle_eof = 0;

        if (!media_pkt || !subtitle_pkt) {
            fprintf(stderr, "ERROR: cannot allocate packet\n");
            av_packet_free(&media_pkt);
            av_packet_free(&subtitle_pkt);
            goto cleanup;
        }

        while (media_have || subtitle_have ||
               !media_eof || !subtitle_eof) {

            if (!media_have && !media_eof) {
                while ((avret =
                        av_read_frame(media, media_pkt)) >= 0) {

                    int in_index = media_pkt->stream_index;
                    int out_index;

                    if (in_index < 0 ||
                        (unsigned int)in_index >=
                            media->nb_streams ||
                        media_stream_map[in_index] < 0) {

                        av_packet_unref(media_pkt);
                        continue;
                    }

                    out_index = media_stream_map[in_index];

                    av_packet_rescale_ts(
                        media_pkt,
                        media->streams[in_index]->time_base,
                        out->streams[out_index]->time_base);

                    media_pkt->stream_index = out_index;
                    media_pkt->pos = -1;

                    media_have = 1;
                    break;
                }

                if (!media_have && avret < 0) {
                    if (avret == AVERROR_EOF) {
                        media_eof = 1;
                    } else {
                        print_error("read media", avret);
                        av_packet_free(&media_pkt);
                        av_packet_free(&subtitle_pkt);
                        goto cleanup;
                    }
                }
            }

            if (!subtitle_have && !subtitle_eof) {
                while ((avret =
                        av_read_frame(source, subtitle_pkt)) >= 0) {

                    int pts_mapped = 0;
                    int dts_mapped = 0;
                    int64_t new_pts;
                    int64_t new_dts;

                    if (subtitle_pkt->stream_index !=
                        subtitle_input_index) {
                        av_packet_unref(subtitle_pkt);
                        continue;
                    }

                    subtitle_packets++;

                    new_pts = map_timestamp(
                        &timeline,
                        subtitle_pkt->pts,
                        subtitle_in->time_base,
                        media_video_origin_pts,
                        media_video_origin_tb,
                        &pts_mapped);

                    new_dts = map_timestamp(
                        &timeline,
                        subtitle_pkt->dts,
                        subtitle_in->time_base,
                        media_video_origin_pts,
                        media_video_origin_tb,
                        &dts_mapped);

                    if (!pts_mapped && !dts_mapped) {
                        if (subtitle_pkt->pts ==
                                AV_NOPTS_VALUE &&
                            subtitle_pkt->dts ==
                                AV_NOPTS_VALUE)
                            subtitle_no_pts++;
                        else
                            subtitle_skipped++;

                        av_packet_unref(subtitle_pkt);
                        continue;
                    }

                    if (!pts_mapped)
                        new_pts = new_dts;

                    if (!dts_mapped)
                        new_dts = new_pts;

                    subtitle_pkt->pts = av_rescale_q(
                        new_pts,
                        subtitle_in->time_base,
                        subtitle_out->time_base);

                    subtitle_pkt->dts = av_rescale_q(
                        new_dts,
                        subtitle_in->time_base,
                        subtitle_out->time_base);

                    if (last_subtitle_pts !=
                            AV_NOPTS_VALUE &&
                        subtitle_pkt->pts <
                            last_subtitle_pts)
                        subtitle_backward++;

                    last_subtitle_pts =
                        subtitle_pkt->pts;

                    if (subtitle_pkt->duration > 0) {
                        subtitle_pkt->duration =
                            av_rescale_q(
                                subtitle_pkt->duration,
                                subtitle_in->time_base,
                                subtitle_out->time_base);
                    }

                    subtitle_pkt->stream_index =
                        subtitle_output_index;
                    subtitle_pkt->pos = -1;

                    subtitle_have = 1;
                    break;
                }

                if (!subtitle_have && avret < 0) {
                    if (avret == AVERROR_EOF) {
                        subtitle_eof = 1;
                    } else {
                        print_error("read source", avret);
                        av_packet_free(&media_pkt);
                        av_packet_free(&subtitle_pkt);
                        goto cleanup;
                    }
                }
            }

            if (!media_have && !subtitle_have)
                continue;

            {
                int write_media;

                if (media_have && !subtitle_have) {
                    write_media = 1;
                } else if (!media_have &&
                           subtitle_have) {
                    write_media = 0;
                } else {
                    int64_t media_ts =
                        media_pkt->dts != AV_NOPTS_VALUE
                        ? media_pkt->dts
                        : media_pkt->pts;

                    int64_t subtitle_ts =
                        subtitle_pkt->dts != AV_NOPTS_VALUE
                        ? subtitle_pkt->dts
                        : subtitle_pkt->pts;

                    if (media_ts == AV_NOPTS_VALUE &&
                        subtitle_ts == AV_NOPTS_VALUE) {
                        write_media = 1;
                    } else if (media_ts ==
                               AV_NOPTS_VALUE) {
                        write_media = 0;
                    } else if (subtitle_ts ==
                               AV_NOPTS_VALUE) {
                        write_media = 1;
                    } else {
                        write_media =
                            av_compare_ts(
                                media_ts,
                                out->streams[
                                    media_pkt->stream_index]
                                    ->time_base,
                                subtitle_ts,
                                out->streams[
                                    subtitle_pkt->stream_index]
                                    ->time_base) <= 0;
                    }
                }

                if (write_media) {
                    avret = av_interleaved_write_frame(
                        out, media_pkt);

                    if (avret < 0) {
                        print_error(
                            "write media packet", avret);
                        av_packet_free(&media_pkt);
                        av_packet_free(&subtitle_pkt);
                        goto cleanup;
                    }

                    av_packet_unref(media_pkt);
                    media_have = 0;
                } else {
                    avret = av_interleaved_write_frame(
                        out, subtitle_pkt);

                    if (avret < 0) {
                        print_error(
                            "write subtitle packet", avret);
                        av_packet_free(&media_pkt);
                        av_packet_free(&subtitle_pkt);
                        goto cleanup;
                    }

                    subtitle_mapped++;

                    av_packet_unref(subtitle_pkt);
                    subtitle_have = 0;
                }
            }
        }

        av_packet_free(&media_pkt);
        av_packet_free(&subtitle_pkt);
    }

    avret = av_write_trailer(out);
    if (avret < 0) {
        print_error("write trailer", avret);
        goto cleanup;
    }

    fprintf(stderr,
            "\nsubtitle summary:\n"
            "  packets   = %" PRId64 "\n"
            "  mapped    = %" PRId64 "\n"
            "  skipped   = %" PRId64 "\n"
            "  no_pts    = %" PRId64 "\n"
            "  backward  = %" PRId64 "\n",
            subtitle_packets,
            subtitle_mapped,
            subtitle_skipped,
            subtitle_no_pts,
            subtitle_backward);

    ret = 0;

cleanup:
    if (out && out->pb && !(out->oformat->flags & AVFMT_NOFILE))
        avio_closep(&out->pb);

    avformat_free_context(out);
    avformat_close_input(&source);
    avformat_close_input(&media);

    free(media_stream_map);
    free(timeline.points);

    return ret;
}

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/frame.h>
#include <libavutil/rational.h>

typedef struct {
    FILE *map_fp;

    AVFormatContext *output;
    AVCodecContext *encoder;
    AVStream *output_stream;
    AVPacket *encoded_packet;

    AVRational input_time_base;
    AVRational frame_rate;

    int64_t frame_count;
    int64_t encoded_packets;

    /*
     * Development / validation limit.
     * 0 means unlimited.
     */
    int64_t max_frames;
} VideoRepairWriter;

static void print_av_error(const char *what, int err)
{
    char buf[AV_ERROR_MAX_STRING_SIZE];

    av_strerror(err, buf, sizeof(buf));
    fprintf(stderr, "%s: %s\n", what, buf);
}

static int write_encoded_packets(VideoRepairWriter *writer)
{
    int ret;

    for (;;) {
        ret = avcodec_receive_packet(
            writer->encoder,
            writer->encoded_packet
        );

        if (ret == AVERROR(EAGAIN) ||
            ret == AVERROR_EOF) {
            return ret;
        }

        if (ret < 0) {
            return ret;
        }

        av_packet_rescale_ts(
            writer->encoded_packet,
            writer->encoder->time_base,
            writer->output_stream->time_base
        );

        writer->encoded_packet->stream_index =
            writer->output_stream->index;

        ret = av_interleaved_write_frame(
            writer->output,
            writer->encoded_packet
        );

        av_packet_unref(writer->encoded_packet);

        if (ret < 0) {
            return ret;
        }

        writer->encoded_packets++;
    }
}

static int write_frame(
    VideoRepairWriter *writer,
    AVFrame *frame
)
{
    int64_t source_ts;

    if (writer->max_frames > 0 &&
        writer->frame_count >= writer->max_frames) {
        return AVERROR_EOF;
    }
    double original_time;
    double repaired_time;
    int ret;

    source_ts = frame->best_effort_timestamp;

    if (source_ts == AV_NOPTS_VALUE) {
        fprintf(stderr,
                "decoded frame %" PRId64
                " has no best-effort timestamp\n",
                writer->frame_count);
        return AVERROR_INVALIDDATA;
    }

    original_time =
        source_ts *
        av_q2d(writer->input_time_base);

    repaired_time =
        writer->frame_count *
        av_q2d(av_inv_q(writer->frame_rate));

    /*
     * Repaired video uses one continuous frame clock.
     *
     * encoder->time_base == inverse frame rate, therefore
     * frame_count itself is the repaired PTS.
     */
    frame->pts = writer->frame_count;
    frame->duration = 1;

    /*
     * The source stream is 1440x1080i Top Field First.
     *
     * 3661 has one damaged decoded frame whose per-frame field
     * flags were lost.  The stream itself and all other usable
     * frames are TFF, so normalize repaired output to TFF.
     *
     * Do not deinterlace.
     */
    frame->flags |=
        AV_FRAME_FLAG_INTERLACED |
        AV_FRAME_FLAG_TOP_FIELD_FIRST;

    ret = avcodec_send_frame(
        writer->encoder,
        frame
    );

    if (ret < 0) {
        return ret;
    }

    /*
     * Record the map only after the encoder has accepted
     * exactly this frame.  This keeps repaired-video frame
     * membership and map membership identical.
     */
    if (fprintf(writer->map_fp,
                "%.6f %.9f\n",
                original_time,
                repaired_time) < 0) {
        return AVERROR(errno);
    }

    writer->frame_count++;

    ret = write_encoded_packets(writer);

    if (ret == AVERROR(EAGAIN) ||
        ret == AVERROR_EOF) {
        return 0;
    }

    return ret;
}

static int receive_decoded_frames(
    AVCodecContext *decoder,
    AVFrame *frame,
    VideoRepairWriter *writer
)
{
    int ret;

    for (;;) {
        ret = avcodec_receive_frame(
            decoder,
            frame
        );

        if (ret == AVERROR(EAGAIN) ||
            ret == AVERROR_EOF) {
            return ret;
        }

        if (ret < 0) {
            return ret;
        }

        ret = write_frame(
            writer,
            frame
        );

        av_frame_unref(frame);

        if (ret < 0) {
            return ret;
        }
    }
}

static int open_encoder(
    AVStream *input_stream,
    AVRational frame_rate,
    const char *output_path,
    VideoRepairWriter *writer
)
{
    const AVCodec *codec;
    AVCodecContext *encoder = NULL;
    AVStream *output_stream;
    int ret;

    codec = avcodec_find_encoder(
        AV_CODEC_ID_MPEG2VIDEO
    );

    if (!codec) {
        fprintf(stderr,
                "mpeg2video encoder not found\n");
        return AVERROR_ENCODER_NOT_FOUND;
    }

    ret = avformat_alloc_output_context2(
        &writer->output,
        NULL,
        "mpeg2video",
        output_path
    );

    if (ret < 0 || !writer->output) {
        if (ret < 0) {
            return ret;
        }

        return AVERROR_UNKNOWN;
    }

    encoder = avcodec_alloc_context3(codec);

    if (!encoder) {
        return AVERROR(ENOMEM);
    }

    encoder->codec_id = AV_CODEC_ID_MPEG2VIDEO;
    encoder->codec_type = AVMEDIA_TYPE_VIDEO;

    encoder->width =
        input_stream->codecpar->width;

    encoder->height =
        input_stream->codecpar->height;

    encoder->pix_fmt =
        input_stream->codecpar->format >= 0
            ? input_stream->codecpar->format
            : AV_PIX_FMT_YUV420P;

    encoder->time_base =
        av_inv_q(frame_rate);

    encoder->framerate =
        frame_rate;

    /*
     * Initial repair quality target.
     *
     * This is deliberately high enough to avoid turning repair
     * into an aggressive quality-reduction encode.  It can be
     * tuned after the repaired-video correctness test.
     */
    encoder->bit_rate = 15000000;

    encoder->gop_size = 15;
    encoder->max_b_frames = 2;

    encoder->sample_aspect_ratio =
        input_stream->codecpar->sample_aspect_ratio;

    encoder->color_range =
        input_stream->codecpar->color_range;

    encoder->color_primaries =
        input_stream->codecpar->color_primaries;

    encoder->color_trc =
        input_stream->codecpar->color_trc;

    encoder->colorspace =
        input_stream->codecpar->color_space;

    encoder->chroma_sample_location =
        input_stream->codecpar->chroma_location;

    /*
     * Equivalent intent to the validated CLI:
     *
     *   -vf setfield=tff
     *   -flags +ilme+ildct
     *
     * We do not use deprecated "-top 1".
     */
    encoder->flags |=
        AV_CODEC_FLAG_INTERLACED_DCT |
        AV_CODEC_FLAG_INTERLACED_ME;

    encoder->field_order = AV_FIELD_TT;

    ret = avcodec_open2(
        encoder,
        codec,
        NULL
    );

    if (ret < 0) {
        avcodec_free_context(&encoder);
        return ret;
    }

    output_stream =
        avformat_new_stream(
            writer->output,
            NULL
        );

    if (!output_stream) {
        avcodec_free_context(&encoder);
        return AVERROR(ENOMEM);
    }

    output_stream->time_base =
        encoder->time_base;

    output_stream->avg_frame_rate =
        frame_rate;

    output_stream->r_frame_rate =
        frame_rate;

    ret = avcodec_parameters_from_context(
        output_stream->codecpar,
        encoder
    );

    if (ret < 0) {
        avcodec_free_context(&encoder);
        return ret;
    }

    if (!(writer->output->oformat->flags &
          AVFMT_NOFILE)) {
        ret = avio_open(
            &writer->output->pb,
            output_path,
            AVIO_FLAG_WRITE
        );

        if (ret < 0) {
            avcodec_free_context(&encoder);
            return ret;
        }
    }

    ret = avformat_write_header(
        writer->output,
        NULL
    );

    if (ret < 0) {
        avcodec_free_context(&encoder);
        return ret;
    }

    writer->encoder = encoder;
    writer->output_stream = output_stream;

    return 0;
}

int main(int argc, char **argv)
{
    const char *input_path;
    const char *video_output_path;
    const char *map_output_path;

    AVFormatContext *format = NULL;
    AVCodecContext *decoder = NULL;
    const AVCodec *decoder_codec = NULL;

    AVPacket *packet = NULL;
    AVFrame *frame = NULL;
    AVStream *video_stream = NULL;

    VideoRepairWriter writer = {0};

    AVRational frame_rate;

    int video_index;
    int ret = 1;
    int ffret;
    int sendret;
    int recvret;

    if (argc != 4 && argc != 5) {
        fprintf(stderr,
                "Usage: %s input.ts repaired.m2v video.map [max-frames]\n",
                argv[0]);
        return 2;
    }

    input_path = argv[1];
    video_output_path = argv[2];
    map_output_path = argv[3];

    if (argc == 5) {
        char *end = NULL;
        long long value;

        errno = 0;
        value = strtoll(argv[4], &end, 10);

        if (errno != 0 ||
            !end ||
            *end != '\0' ||
            value <= 0) {
            fprintf(stderr,
                    "invalid max-frames: %s\n",
                    argv[4]);
            return 2;
        }

        writer.max_frames = value;
    }

    /*
     * Development safety:
     * never truncate an existing repair artifact.
     */
    if (access(video_output_path, F_OK) == 0) {
        fprintf(stderr,
                "output already exists: %s\n",
                video_output_path);
        return 1;
    }

    if (access(map_output_path, F_OK) == 0) {
        fprintf(stderr,
                "map already exists: %s\n",
                map_output_path);
        return 1;
    }

    ffret = avformat_open_input(
        &format,
        input_path,
        NULL,
        NULL
    );

    if (ffret < 0) {
        print_av_error(
            "avformat_open_input",
            ffret
        );
        goto cleanup;
    }

    ffret = avformat_find_stream_info(
        format,
        NULL
    );

    if (ffret < 0) {
        print_av_error(
            "avformat_find_stream_info",
            ffret
        );
        goto cleanup;
    }

    video_index = av_find_best_stream(
        format,
        AVMEDIA_TYPE_VIDEO,
        -1,
        -1,
        &decoder_codec,
        0
    );

    if (video_index < 0) {
        print_av_error(
            "video stream not found",
            video_index
        );
        goto cleanup;
    }

    video_stream =
        format->streams[video_index];

    frame_rate =
        video_stream->avg_frame_rate;

    if (frame_rate.num <= 0 ||
        frame_rate.den <= 0) {
        frame_rate =
            av_guess_frame_rate(
                format,
                video_stream,
                NULL
            );
    }

    if (frame_rate.num <= 0 ||
        frame_rate.den <= 0) {
        fprintf(stderr,
                "unable to determine video frame rate\n");
        goto cleanup;
    }

    decoder =
        avcodec_alloc_context3(
            decoder_codec
        );

    if (!decoder) {
        fprintf(stderr,
                "avcodec_alloc_context3 failed\n");
        goto cleanup;
    }

    ffret = avcodec_parameters_to_context(
        decoder,
        video_stream->codecpar
    );

    if (ffret < 0) {
        print_av_error(
            "avcodec_parameters_to_context",
            ffret
        );
        goto cleanup;
    }

    ffret = avcodec_open2(
        decoder,
        decoder_codec,
        NULL
    );

    if (ffret < 0) {
        print_av_error(
            "decoder avcodec_open2",
            ffret
        );
        goto cleanup;
    }

    writer.input_time_base =
        video_stream->time_base;

    writer.frame_rate =
        frame_rate;

    writer.map_fp =
        fopen(
            map_output_path,
            "wb"
        );

    if (!writer.map_fp) {
        perror(map_output_path);
        goto cleanup;
    }

    ffret = open_encoder(
        video_stream,
        frame_rate,
        video_output_path,
        &writer
    );

    if (ffret < 0) {
        print_av_error(
            "open MPEG-2 encoder",
            ffret
        );
        goto cleanup;
    }

    writer.encoded_packet =
        av_packet_alloc();

    packet = av_packet_alloc();
    frame = av_frame_alloc();

    if (!packet ||
        !frame ||
        !writer.encoded_packet) {
        fprintf(stderr,
                "packet/frame allocation failed\n");
        goto cleanup;
    }

    fprintf(stderr,
            "video: stream=%d codec=%s "
            "size=%dx%d rate=%d/%d "
            "sar=%d/%d\n",
            video_index,
            decoder_codec->name,
            decoder->width,
            decoder->height,
            frame_rate.num,
            frame_rate.den,
            writer.encoder->sample_aspect_ratio.num,
            writer.encoder->sample_aspect_ratio.den);

    while ((ffret =
                av_read_frame(
                    format,
                    packet)) >= 0) {

        if (packet->stream_index !=
            video_index) {
            av_packet_unref(packet);
            continue;
        }

        sendret =
            avcodec_send_packet(
                decoder,
                packet
            );

        av_packet_unref(packet);

        if (sendret ==
            AVERROR_INVALIDDATA) {
            fprintf(stderr,
                    "warning: skipping undecodable "
                    "video packet\n");
            continue;
        }

        if (sendret < 0) {
            print_av_error(
                "avcodec_send_packet",
                sendret
            );
            goto cleanup;
        }

        recvret =
            receive_decoded_frames(
                decoder,
                frame,
                &writer
            );

        if (recvret == AVERROR_EOF &&
            writer.max_frames > 0 &&
            writer.frame_count >= writer.max_frames) {
            break;
        }

        if (recvret < 0 &&
            recvret != AVERROR(EAGAIN) &&
            recvret != AVERROR_EOF) {
            print_av_error(
                "avcodec_receive_frame",
                recvret
            );
            goto cleanup;
        }
    }

    /*
     * Hitting max_frames is an intentional early stop.
     * Otherwise av_read_frame must have reached real EOF.
     */
    if (!(writer.max_frames > 0 &&
          writer.frame_count >= writer.max_frames) &&
        ffret != AVERROR_EOF) {
        print_av_error(
            "av_read_frame",
            ffret
        );
        goto cleanup;
    }

    if (!(writer.max_frames > 0 &&
          writer.frame_count >= writer.max_frames)) {
        ffret =
            avcodec_send_packet(
                decoder,
                NULL
            );

        if (ffret < 0 &&
            ffret != AVERROR_EOF) {
            print_av_error(
                "decoder flush",
                ffret
            );
            goto cleanup;
        }

        for (;;) {
            recvret =
                receive_decoded_frames(
                    decoder,
                    frame,
                    &writer
                );

            if (recvret ==
                AVERROR_EOF) {
                break;
            }

            if (recvret ==
                AVERROR(EAGAIN)) {
                fprintf(stderr,
                        "unexpected EAGAIN while "
                        "flushing decoder\n");
                goto cleanup;
            }

            if (recvret < 0) {
                print_av_error(
                    "decoder flush receive",
                    recvret
                );
                goto cleanup;
            }
        }
    }

    /*
     * Flush MPEG-2 encoder.
     */
    ffret =
        avcodec_send_frame(
            writer.encoder,
            NULL
        );

    if (ffret < 0 &&
        ffret != AVERROR_EOF) {
        print_av_error(
            "encoder flush",
            ffret
        );
        goto cleanup;
    }

    for (;;) {
        ffret =
            write_encoded_packets(
                &writer
            );

        if (ffret ==
            AVERROR_EOF) {
            break;
        }

        if (ffret ==
            AVERROR(EAGAIN)) {
            continue;
        }

        if (ffret < 0) {
            print_av_error(
                "encoder flush receive",
                ffret
            );
            goto cleanup;
        }
    }

    ffret =
        av_write_trailer(
            writer.output
        );

    if (ffret < 0) {
        print_av_error(
            "av_write_trailer",
            ffret
        );
        goto cleanup;
    }

    if (fflush(writer.map_fp) != 0) {
        perror("fflush map");
        goto cleanup;
    }

    fprintf(stderr,
            "SUMMARY\n"
            "video_stream=%d\n"
            "frame_rate=%d/%d\n"
            "frames=%" PRId64 "\n"
            "encoded_packets=%" PRId64 "\n"
            "max_frames=%" PRId64 "\n",
            video_index,
            frame_rate.num,
            frame_rate.den,
            writer.frame_count,
            writer.encoded_packets,
            writer.max_frames);

    ret = 0;

cleanup:
    if (writer.map_fp) {
        fclose(writer.map_fp);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
    av_packet_free(
        &writer.encoded_packet
    );

    if (writer.output) {
        if (!(writer.output->oformat->flags &
              AVFMT_NOFILE) &&
            writer.output->pb) {
            avio_closep(
                &writer.output->pb
            );
        }

        avformat_free_context(
            writer.output
        );
    }

    avcodec_free_context(
        &writer.encoder
    );

    avcodec_free_context(
        &decoder
    );

    avformat_close_input(
        &format
    );

    return ret;
}

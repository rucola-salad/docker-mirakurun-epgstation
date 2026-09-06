#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/rational.h>

typedef struct {
    FILE *fp;
    AVRational time_base;
    AVRational frame_rate;
    int64_t frame_count;
} TimelineWriter;

static void print_av_error(const char *what, int err)
{
    char buf[AV_ERROR_MAX_STRING_SIZE];

    av_strerror(err, buf, sizeof(buf));
    fprintf(stderr, "%s: %s\n", what, buf);
}

static int write_frame(TimelineWriter *writer, const AVFrame *frame)
{
    int64_t ts;
    double original_time;
    double repaired_time;

    ts = frame->best_effort_timestamp;
    if (ts == AV_NOPTS_VALUE) {
        fprintf(stderr,
                "decoded frame %" PRId64 " has no best-effort timestamp\n",
                writer->frame_count);
        return AVERROR_INVALIDDATA;
    }

    original_time =
        ts * av_q2d(writer->time_base);

    repaired_time =
        writer->frame_count *
        av_q2d(av_inv_q(writer->frame_rate));

    if (fprintf(writer->fp,
                "%.6f %.9f\n",
                original_time,
                repaired_time) < 0) {
        perror("write timeline");
        return AVERROR(errno);
    }

    writer->frame_count++;
    return 0;
}

static int receive_frames(
    AVCodecContext *decoder,
    AVFrame *frame,
    TimelineWriter *writer
)
{
    int ret;

    for (;;) {
        ret = avcodec_receive_frame(decoder, frame);

        if (ret == AVERROR(EAGAIN) ||
            ret == AVERROR_EOF) {
            return ret;
        }

        if (ret < 0) {
            return ret;
        }

        ret = write_frame(writer, frame);
        av_frame_unref(frame);

        if (ret < 0) {
            return ret;
        }
    }
}

int main(int argc, char **argv)
{
    const char *input_path;
    const char *output_path;
    char *temp_path = NULL;

    AVFormatContext *format = NULL;
    AVCodecContext *decoder = NULL;
    const AVCodec *codec = NULL;
    AVPacket *packet = NULL;
    AVFrame *frame = NULL;
    AVStream *video_stream = NULL;

    TimelineWriter writer = {0};

    int video_index;
    int ret = 1;
    int ffret;
    int sendret;
    int recvret;

    size_t temp_len;

    if (argc != 3) {
        fprintf(stderr,
                "Usage: %s input.ts output.map\n",
                argv[0]);
        return 2;
    }

    input_path = argv[1];
    output_path = argv[2];

    temp_len = strlen(output_path) + 5;
    temp_path = malloc(temp_len);
    if (!temp_path) {
        fprintf(stderr, "out of memory\n");
        goto cleanup;
    }

    snprintf(temp_path, temp_len, "%s.tmp", output_path);

    ffret = avformat_open_input(
        &format,
        input_path,
        NULL,
        NULL
    );
    if (ffret < 0) {
        print_av_error("avformat_open_input", ffret);
        goto cleanup;
    }

    ffret = avformat_find_stream_info(
        format,
        NULL
    );
    if (ffret < 0) {
        print_av_error("avformat_find_stream_info", ffret);
        goto cleanup;
    }

    video_index = av_find_best_stream(
        format,
        AVMEDIA_TYPE_VIDEO,
        -1,
        -1,
        &codec,
        0
    );
    if (video_index < 0) {
        print_av_error("video stream not found", video_index);
        goto cleanup;
    }

    video_stream = format->streams[video_index];

    writer.frame_rate =
        video_stream->avg_frame_rate;

    if (writer.frame_rate.num <= 0 ||
        writer.frame_rate.den <= 0) {
        writer.frame_rate =
            av_guess_frame_rate(
                format,
                video_stream,
                NULL
            );
    }

    if (writer.frame_rate.num <= 0 ||
        writer.frame_rate.den <= 0) {
        fprintf(stderr,
                "unable to determine video frame rate\n");
        goto cleanup;
    }

    writer.time_base =
        video_stream->time_base;

    decoder = avcodec_alloc_context3(codec);
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
        codec,
        NULL
    );
    if (ffret < 0) {
        print_av_error("avcodec_open2", ffret);
        goto cleanup;
    }

    packet = av_packet_alloc();
    frame = av_frame_alloc();

    if (!packet || !frame) {
        fprintf(stderr,
                "packet/frame allocation failed\n");
        goto cleanup;
    }

    writer.fp = fopen(temp_path, "wb");
    if (!writer.fp) {
        perror(temp_path);
        goto cleanup;
    }

    while ((ffret = av_read_frame(format, packet)) >= 0) {
        if (packet->stream_index != video_index) {
            av_packet_unref(packet);
            continue;
        }

        sendret = avcodec_send_packet(
            decoder,
            packet
        );
        av_packet_unref(packet);

        if (sendret == AVERROR_INVALIDDATA) {
            fprintf(stderr,
                    "warning: skipping undecodable video packet\n");
            continue;
        }

        if (sendret < 0) {
            print_av_error(
                "avcodec_send_packet",
                sendret
            );
            goto cleanup;
        }

        recvret = receive_frames(
            decoder,
            frame,
            &writer
        );

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

    if (ffret != AVERROR_EOF) {
        print_av_error("av_read_frame", ffret);
        goto cleanup;
    }

    ffret = avcodec_send_packet(
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
        recvret = receive_frames(
            decoder,
            frame,
            &writer
        );

        if (recvret == AVERROR_EOF) {
            break;
        }

        if (recvret == AVERROR(EAGAIN)) {
            fprintf(stderr,
                    "unexpected EAGAIN while flushing decoder\n");
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

    if (writer.frame_count == 0) {
        fprintf(stderr,
                "no video frames decoded\n");
        goto cleanup;
    }

    if (fflush(writer.fp) != 0) {
        perror("fflush");
        goto cleanup;
    }

    if (fclose(writer.fp) != 0) {
        writer.fp = NULL;
        perror("fclose");
        goto cleanup;
    }
    writer.fp = NULL;

    if (rename(temp_path, output_path) != 0) {
        perror("rename output");
        goto cleanup;
    }

    fprintf(stderr,
            "video_stream=%d frame_rate=%d/%d frames=%" PRId64 "\n",
            video_index,
            writer.frame_rate.num,
            writer.frame_rate.den,
            writer.frame_count);

    ret = 0;

cleanup:
    if (writer.fp) {
        fclose(writer.fp);
    }

    /*
     * A failed run must not leave a partial map behind.
     * This only removes our own temporary output.
     */
    if (ret != 0 && temp_path) {
        remove(temp_path);
    }

    av_frame_free(&frame);
    av_packet_free(&packet);
    avcodec_free_context(&decoder);
    avformat_close_input(&format);
    free(temp_path);

    return ret;
}

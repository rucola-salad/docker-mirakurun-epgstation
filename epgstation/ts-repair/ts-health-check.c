#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libavformat/avformat.h>
#include <libavutil/avutil.h>

#define TS_PACKET_SIZE 188
#define TS_PID_COUNT 8192

typedef struct {
    int seen;
    int last_cc;

    int pcr_seen;
    uint64_t last_pcr_base;
} PidState;

typedef struct {
    uint64_t packets;
    uint64_t sync_errors;
    uint64_t transport_errors;
    uint64_t continuity_errors;
    uint64_t discontinuity_signals;

    uint64_t pcr_packets;
    uint64_t pcr_forward_jumps;
    uint64_t pcr_backward_jumps;
    double pcr_max_forward_jump;
    double pcr_max_backward_jump;
} TransportMetrics;

typedef struct {
    uint64_t packets;

    uint64_t pts_missing;
    uint64_t pts_forward_jumps;
    uint64_t pts_backward_jumps;
    double pts_max_forward_jump;
    double pts_max_backward_jump;

    uint64_t dts_missing;
    uint64_t dts_forward_jumps;
    uint64_t dts_backward_jumps;
    double dts_max_forward_jump;
    double dts_max_backward_jump;

    int pts_seen;
    int dts_seen;
    double first_pts;
    double last_pts;
    double last_dts;
} StreamMetrics;

static void update_timestamp(
    int64_t timestamp,
    AVRational time_base,
    int *seen,
    double *last,
    uint64_t *missing,
    uint64_t *forward_jumps,
    uint64_t *backward_jumps,
    double *max_forward_jump,
    double *max_backward_jump
)
{
    double current;
    double delta;

    if (timestamp == AV_NOPTS_VALUE) {
        (*missing)++;
        return;
    }

    current = timestamp * av_q2d(time_base);

    if (*seen) {
        delta = current - *last;

        if (delta > 0.5) {
            (*forward_jumps)++;
            if (delta > *max_forward_jump) {
                *max_forward_jump = delta;
            }
        }

        if (delta < -0.5) {
            (*backward_jumps)++;
            if (delta < *max_backward_jump) {
                *max_backward_jump = delta;
            }
        }
    }

    *seen = 1;
    *last = current;
}

static void update_pcr(
    PidState *state,
    uint64_t pcr_base,
    TransportMetrics *m
)
{
    const uint64_t wrap = UINT64_C(1) << 33;
    int64_t delta_ticks;
    double delta;

    m->pcr_packets++;

    if (!state->pcr_seen) {
        state->pcr_seen = 1;
        state->last_pcr_base = pcr_base;
        return;
    }

    delta_ticks =
        (int64_t)pcr_base -
        (int64_t)state->last_pcr_base;

    /*
     * PCR_base is a 33-bit counter. Normalize a genuine
     * wraparound to the shortest signed distance.
     */
    if (delta_ticks < -(int64_t)(wrap / 2)) {
        delta_ticks += (int64_t)wrap;
    } else if (delta_ticks > (int64_t)(wrap / 2)) {
        delta_ticks -= (int64_t)wrap;
    }

    delta = (double)delta_ticks / 90000.0;

    if (delta > 0.5) {
        m->pcr_forward_jumps++;

        if (delta > m->pcr_max_forward_jump) {
            m->pcr_max_forward_jump = delta;
        }
    }

    if (delta < -0.5) {
        m->pcr_backward_jumps++;

        if (delta < m->pcr_max_backward_jump) {
            m->pcr_max_backward_jump = delta;
        }
    }

    state->last_pcr_base = pcr_base;
}

static int scan_transport(
    const char *path,
    TransportMetrics *m
)
{
    FILE *fp;
    uint8_t packet[TS_PACKET_SIZE];
    PidState pid_state[TS_PID_COUNT];

    memset(m, 0, sizeof(*m));
    memset(pid_state, 0, sizeof(pid_state));

    fp = fopen(path, "rb");
    if (fp == NULL) {
        fprintf(
            stderr,
            "cannot open %s: %s\n",
            path,
            strerror(errno)
        );
        return -1;
    }

    while (fread(packet, 1, sizeof(packet), fp) == sizeof(packet)) {
        int pid;
        int adaptation_field_control;
        int continuity_counter;
        int has_payload;
        int has_adaptation;
        int discontinuity = 0;

        m->packets++;

        if (packet[0] != 0x47) {
            m->sync_errors++;
            continue;
        }

        if (packet[1] & 0x80) {
            m->transport_errors++;
        }

        pid =
            ((packet[1] & 0x1f) << 8) |
            packet[2];

        adaptation_field_control =
            (packet[3] >> 4) & 0x03;

        continuity_counter =
            packet[3] & 0x0f;

        has_payload =
            adaptation_field_control == 1 ||
            adaptation_field_control == 3;

        has_adaptation =
            adaptation_field_control == 2 ||
            adaptation_field_control == 3;

        if (has_adaptation) {
            int adaptation_length = packet[4];

            if (adaptation_length > 0 &&
                adaptation_length <= 183) {
                uint8_t flags = packet[5];

                if (flags & 0x80) {
                    discontinuity = 1;
                    m->discontinuity_signals++;

                    /*
                     * A discontinuity_indicator explicitly permits
                     * a PCR discontinuity on this PID.
                     */
                    pid_state[pid].pcr_seen = 0;
                }

                if ((flags & 0x10) &&
                    adaptation_length >= 7) {
                    uint64_t pcr_base;

                    pcr_base =
                        ((uint64_t)packet[6] << 25) |
                        ((uint64_t)packet[7] << 17) |
                        ((uint64_t)packet[8] << 9) |
                        ((uint64_t)packet[9] << 1) |
                        ((uint64_t)packet[10] >> 7);

                    update_pcr(
                        &pid_state[pid],
                        pcr_base,
                        m
                    );
                }
            }
        }

        /*
         * CC is advanced only for packets carrying payload.
         *
         * A discontinuity_indicator explicitly permits a CC
         * discontinuity, so reset the comparison at that point.
         *
         * PID 0x1fff is the null-packet PID and is ignored.
         */
        if (pid != 0x1fff && has_payload) {
            if (discontinuity) {
                pid_state[pid].seen = 0;
            }

            if (pid_state[pid].seen) {
                int expected =
                    (pid_state[pid].last_cc + 1) & 0x0f;

                if (continuity_counter != expected) {
                    m->continuity_errors++;
                }
            }

            pid_state[pid].seen = 1;
            pid_state[pid].last_cc =
                continuity_counter;
        }
    }

    if (ferror(fp)) {
        fprintf(
            stderr,
            "read error %s: %s\n",
            path,
            strerror(errno)
        );
        fclose(fp);
        return -1;
    }

    fclose(fp);
    return 0;
}

static int scan_media_timestamps(
    const char *path,
    StreamMetrics *video,
    StreamMetrics **audios_out,
    int **audio_stream_indexes_out,
    int *audio_count_out
)
{
    AVFormatContext *fmt = NULL;
    AVPacket *pkt = NULL;
    StreamMetrics *audios = NULL;
    int *audio_stream_indexes = NULL;
    int video_stream_index = -1;
    int audio_count = 0;
    int ret;
    unsigned int i;

    memset(video, 0, sizeof(*video));
    *audios_out = NULL;
    *audio_stream_indexes_out = NULL;
    *audio_count_out = 0;

    ret = avformat_open_input(&fmt, path, NULL, NULL);
    if (ret < 0) {
        fprintf(stderr, "avformat_open_input failed: %s\n", path);
        return -1;
    }

    ret = avformat_find_stream_info(fmt, NULL);
    if (ret < 0) {
        fprintf(stderr, "avformat_find_stream_info failed: %s\n", path);
        avformat_close_input(&fmt);
        return -1;
    }

    for (i = 0; i < fmt->nb_streams; i++) {
        enum AVMediaType type = fmt->streams[i]->codecpar->codec_type;

        if (type == AVMEDIA_TYPE_VIDEO &&
            video_stream_index < 0) {
            video_stream_index = (int)i;
        }

        if (type == AVMEDIA_TYPE_AUDIO) {
            audio_count++;
        }
    }

    if (video_stream_index < 0) {
        fprintf(stderr, "no video stream: %s\n", path);
        avformat_close_input(&fmt);
        return -1;
    }

    if (audio_count > 0) {
        int n = 0;

        audios = calloc(
            (size_t)audio_count,
            sizeof(*audios)
        );
        audio_stream_indexes = malloc(
            (size_t)audio_count *
            sizeof(*audio_stream_indexes)
        );

        if (audios == NULL ||
            audio_stream_indexes == NULL) {
            fprintf(stderr, "out of memory\n");
            free(audios);
            free(audio_stream_indexes);
            avformat_close_input(&fmt);
            return -1;
        }

        for (i = 0; i < fmt->nb_streams; i++) {
            if (fmt->streams[i]->codecpar->codec_type ==
                AVMEDIA_TYPE_AUDIO) {
                audio_stream_indexes[n++] = (int)i;
            }
        }
    }

    pkt = av_packet_alloc();
    if (pkt == NULL) {
        fprintf(stderr, "av_packet_alloc failed\n");
        free(audios);
        free(audio_stream_indexes);
        avformat_close_input(&fmt);
        return -1;
    }

    while ((ret = av_read_frame(fmt, pkt)) >= 0) {
        StreamMetrics *m = NULL;
        AVRational time_base;
        int n;

        if (pkt->stream_index == video_stream_index) {
            m = video;
        } else {
            for (n = 0; n < audio_count; n++) {
                if (pkt->stream_index ==
                    audio_stream_indexes[n]) {
                    m = &audios[n];
                    break;
                }
            }
        }

        if (m != NULL) {
            time_base =
                fmt->streams[pkt->stream_index]->time_base;

            m->packets++;

            if (pkt->pts != AV_NOPTS_VALUE &&
                !m->pts_seen) {
                m->first_pts =
                    pkt->pts * av_q2d(time_base);
            }

            update_timestamp(
                pkt->pts,
                time_base,
                &m->pts_seen,
                &m->last_pts,
                &m->pts_missing,
                &m->pts_forward_jumps,
                &m->pts_backward_jumps,
                &m->pts_max_forward_jump,
                &m->pts_max_backward_jump
            );

            update_timestamp(
                pkt->dts,
                time_base,
                &m->dts_seen,
                &m->last_dts,
                &m->dts_missing,
                &m->dts_forward_jumps,
                &m->dts_backward_jumps,
                &m->dts_max_forward_jump,
                &m->dts_max_backward_jump
            );
        }

        av_packet_unref(pkt);
    }

    av_packet_free(&pkt);
    avformat_close_input(&fmt);

    *audios_out = audios;
    *audio_stream_indexes_out = audio_stream_indexes;
    *audio_count_out = audio_count;

    return 0;
}

static const char *classify_health(
    const TransportMetrics *transport,
    const StreamMetrics *video,
    const StreamMetrics *audios,
    int audio_count
)
{
    int i;
    int strong_timeline_damage = 0;

    /*
     * Insufficient information:
     * we require video, at least one audio stream, and PCR.
     */
    if (!video->pts_seen ||
        audio_count <= 0 ||
        transport->pcr_packets == 0) {
        return "unknown";
    }

    for (i = 0; i < audio_count; i++) {
        if (!audios[i].pts_seen) {
            return "unknown";
        }
    }

    /*
     * Strong timeline discontinuity.
     *
     * update_timestamp()/update_pcr() count candidates at 0.5 s,
     * but classification deliberately uses a much stronger 2.0 s
     * threshold so a single small discontinuity does not immediately
     * make a recording repair-worthy.
     */
    if (transport->pcr_max_forward_jump > 2.0 ||
        transport->pcr_max_backward_jump < -2.0 ||
        video->pts_max_forward_jump > 2.0 ||
        video->pts_max_backward_jump < -2.0 ||
        video->dts_max_forward_jump > 2.0 ||
        video->dts_max_backward_jump < -2.0) {
        strong_timeline_damage = 1;
    }

    for (i = 0; i < audio_count; i++) {
        if (audios[i].pts_max_forward_jump > 2.0 ||
            audios[i].pts_max_backward_jump < -2.0 ||
            audios[i].dts_max_forward_jump > 2.0 ||
            audios[i].dts_max_backward_jump < -2.0) {
            strong_timeline_damage = 1;
        }
    }

    if (strong_timeline_damage) {
        return "damaged";
    }

    return "normal";
}

int main(int argc, char **argv)
{
    TransportMetrics transport;
    StreamMetrics video;
    StreamMetrics *audios = NULL;
    int *audio_stream_indexes = NULL;
    int audio_count = 0;
    double video_pts_span = 0.0;
    const char *status;
    int i;

    if (argc != 2) {
        fprintf(
            stderr,
            "Usage: %s input.ts\n",
            argv[0]
        );
        return 2;
    }

    if (scan_transport(argv[1], &transport) != 0) {
        printf(
            "{\"status\":\"unknown\","
            "\"error\":\"transport_scan_failed\"}\n"
        );
        return 1;
    }

    if (scan_media_timestamps(
            argv[1],
            &video,
            &audios,
            &audio_stream_indexes,
            &audio_count
        ) != 0) {
        printf(
            "{\"status\":\"unknown\","
            "\"error\":\"media_scan_failed\"}\n"
        );
        return 1;
    }

    if (video.pts_seen) {
        video_pts_span =
            video.last_pts - video.first_pts;
    }

    status = classify_health(
        &transport,
        &video,
        audios,
        audio_count
    );

    printf(
        "{"
        "\"status\":\"%s\","
        "\"transport\":{"
        "\"packets\":%llu,"
        "\"sync_errors\":%llu,"
        "\"transport_errors\":%llu,"
        "\"continuity_errors\":%llu,"
        "\"discontinuity_signals\":%llu,"
        "\"pcr_packets\":%llu,"
        "\"pcr_forward_jumps\":%llu,"
        "\"pcr_backward_jumps\":%llu,"
        "\"pcr_max_forward_jump\":%.6f,"
        "\"pcr_max_backward_jump\":%.6f"
        "},",
        status,
        (unsigned long long)transport.packets,
        (unsigned long long)transport.sync_errors,
        (unsigned long long)transport.transport_errors,
        (unsigned long long)transport.continuity_errors,
        (unsigned long long)transport.discontinuity_signals,
        (unsigned long long)transport.pcr_packets,
        (unsigned long long)transport.pcr_forward_jumps,
        (unsigned long long)transport.pcr_backward_jumps,
        transport.pcr_max_forward_jump,
        transport.pcr_max_backward_jump
    );

    printf(
        "\"video\":{"
        "\"packets\":%llu,"
        "\"pts_missing\":%llu,"
        "\"pts_forward_jumps\":%llu,"
        "\"pts_backward_jumps\":%llu,"
        "\"pts_max_forward_jump\":%.6f,"
        "\"pts_max_backward_jump\":%.6f,"
        "\"pts_first\":%.6f,"
        "\"pts_last\":%.6f,"
        "\"pts_span\":%.6f,"
        "\"dts_missing\":%llu,"
        "\"dts_forward_jumps\":%llu,"
        "\"dts_backward_jumps\":%llu,"
        "\"dts_max_forward_jump\":%.6f,"
        "\"dts_max_backward_jump\":%.6f"
        "},",
        (unsigned long long)video.packets,
        (unsigned long long)video.pts_missing,
        (unsigned long long)video.pts_forward_jumps,
        (unsigned long long)video.pts_backward_jumps,
        video.pts_max_forward_jump,
        video.pts_max_backward_jump,
        video.first_pts,
        video.last_pts,
        video_pts_span,
        (unsigned long long)video.dts_missing,
        (unsigned long long)video.dts_forward_jumps,
        (unsigned long long)video.dts_backward_jumps,
        video.dts_max_forward_jump,
        video.dts_max_backward_jump
    );

    printf("\"audio\":[");

    for (i = 0; i < audio_count; i++) {
        StreamMetrics *a = &audios[i];
        double audio_pts_span = 0.0;
        double av_span_divergence = 0.0;

        if (a->pts_seen) {
            audio_pts_span =
                a->last_pts - a->first_pts;

            if (video.pts_seen) {
                av_span_divergence =
                    audio_pts_span - video_pts_span;
            }
        }

        if (i > 0) {
            printf(",");
        }

        printf(
            "{"
            "\"stream_index\":%d,"
            "\"packets\":%llu,"
            "\"pts_missing\":%llu,"
            "\"pts_forward_jumps\":%llu,"
            "\"pts_backward_jumps\":%llu,"
            "\"pts_max_forward_jump\":%.6f,"
            "\"pts_max_backward_jump\":%.6f,"
            "\"pts_first\":%.6f,"
            "\"pts_last\":%.6f,"
            "\"pts_span\":%.6f,"
            "\"av_span_divergence\":%.6f,"
            "\"dts_missing\":%llu,"
            "\"dts_forward_jumps\":%llu,"
            "\"dts_backward_jumps\":%llu,"
            "\"dts_max_forward_jump\":%.6f,"
            "\"dts_max_backward_jump\":%.6f"
            "}",
            audio_stream_indexes[i],
            (unsigned long long)a->packets,
            (unsigned long long)a->pts_missing,
            (unsigned long long)a->pts_forward_jumps,
            (unsigned long long)a->pts_backward_jumps,
            a->pts_max_forward_jump,
            a->pts_max_backward_jump,
            a->first_pts,
            a->last_pts,
            audio_pts_span,
            av_span_divergence,
            (unsigned long long)a->dts_missing,
            (unsigned long long)a->dts_forward_jumps,
            (unsigned long long)a->dts_backward_jumps,
            a->dts_max_forward_jump,
            a->dts_max_backward_jump
        );
    }

    printf("]}\n");

    free(audios);
    free(audio_stream_indexes);

    return 0;
}

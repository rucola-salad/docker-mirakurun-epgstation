#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#include "timeline-map.h"

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

void timeline_map_free(TimelineMap *map)
{
    if (!map)
        return;

    free(map->cuts);
    free(map->points);

    memset(map, 0, sizeof(*map));
}

int timeline_map_load(const char *path, TimelineMap *map)
{
    FILE *fp = NULL;
    TimelinePoint *points = NULL;
    size_t count = 0;
    size_t capacity = 0;
    double src_pts;
    double repaired_time;

    if (!map)
        return -1;

    memset(map, 0, sizeof(*map));

    fp = fopen(path, "r");
    if (!fp) {
        fprintf(stderr,
                "ERROR: cannot open map: %s: %s\n",
                path,
                strerror(errno));
        return -1;
    }

    while (fscanf(fp, "%lf %lf",
                  &src_pts,
                  &repaired_time) == 2) {
        if (count == capacity) {
            size_t new_capacity =
                capacity ? capacity * 2 : 4096;

            TimelinePoint *new_points =
                realloc(points,
                        new_capacity * sizeof(*new_points));

            if (!new_points) {
                fprintf(stderr,
                        "ERROR: out of memory loading map\n");
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
        fprintf(stderr,
                "ERROR: timeline map has too few points: %zu\n",
                count);
        free(points);
        return -1;
    }

    /*
     * Remove an isolated source-PTS regression while preserving
     * decoded/repaired frame order.
     */
    {
        size_t read_index;
        size_t write_index = 0;
        size_t filtered_count = 0;

        for (read_index = 0;
             read_index < count;
             read_index++) {
            int isolated_backward_point = 0;

            if (read_index > 0 &&
                read_index + 1 < count &&
                points[read_index].src_pts <=
                    points[read_index - 1].src_pts &&
                points[read_index + 1].src_pts >
                    points[read_index - 1].src_pts &&
                points[read_index].repaired_time >
                    points[read_index - 1].repaired_time &&
                points[read_index + 1].repaired_time >
                    points[read_index].repaired_time) {
                isolated_backward_point = 1;
            }

            if (isolated_backward_point) {
                fprintf(stderr,
                        "timeline: filtering isolated backward PTS "
                        "src=%.6f repaired=%.9f\n",
                        points[read_index].src_pts,
                        points[read_index].repaired_time);
                filtered_count++;
                continue;
            }

            if (write_index != read_index)
                points[write_index] = points[read_index];

            write_index++;
        }

        count = write_index;

        fprintf(stderr,
                "timeline: filtered isolated backward points=%zu\n",
                filtered_count);
    }

    if (count < 2) {
        fprintf(stderr,
                "ERROR: timeline map has too few points "
                "after filtering: %zu\n",
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

    /*
     * Build CUT AT END intervals.
     *
     * For adjacent surviving video frames A and B:
     *
     * keep: [A.src, A.src + repaired_delta)
     * cut : [A.src + repaired_delta, B.src)
     */
    {
        TimelineCut *cuts;
        size_t i;
        size_t cut_count = 0;

        cuts = calloc(count - 1, sizeof(*cuts));
        if (!cuts) {
            fprintf(stderr,
                    "ERROR: out of memory building timeline cuts\n");
            timeline_map_free(map);
            return -1;
        }

        for (i = 1; i < count; i++) {
            const TimelinePoint *a = &points[i - 1];
            const TimelinePoint *b = &points[i];

            double src_delta =
                b->src_pts - a->src_pts;

            double repaired_delta =
                b->repaired_time - a->repaired_time;

            double excess =
                src_delta - repaired_delta;

            if (src_delta <= 0.0 ||
                repaired_delta <= 0.0 ||
                excess <= 0.005) {
                continue;
            }

            cuts[cut_count].start_src_pts =
                a->src_pts + repaired_delta;

            cuts[cut_count].end_src_pts =
                b->src_pts;

            cut_count++;
        }

        map->cuts = cuts;
        map->cut_count = cut_count;
    }

    fprintf(stderr,
            "timeline: points=%zu cuts=%zu "
            "src=[%.6f .. %.6f]\n",
            map->count,
            map->cut_count,
            map->points[0].src_pts,
            map->points[map->count - 1].src_pts);

    return 0;
}

int timeline_map_is_cut(const TimelineMap *map,
                        double src_time)
{
    size_t i;

    if (!map)
        return 0;

    for (i = 0; i < map->cut_count; i++) {
        const TimelineCut *cut = &map->cuts[i];

        if (src_time < cut->start_src_pts)
            break;

        if (src_time >= cut->start_src_pts &&
            src_time < cut->end_src_pts) {
            return 1;
        }
    }

    return 0;
}

int timeline_map_time(const TimelineMap *map,
                      double src_time,
                      double *repaired_time)
{
    double removed = 0.0;
    size_t i;

    if (!map ||
        !repaired_time ||
        map->count < 2) {
        return -1;
    }

    if (src_time < map->points[0].src_pts ||
        src_time > map->points[map->count - 1].src_pts) {
        return -1;
    }

    for (i = 0; i < map->cut_count; i++) {
        const TimelineCut *cut = &map->cuts[i];

        if (src_time < cut->start_src_pts)
            break;

        if (src_time < cut->end_src_pts)
            return 1;

        removed +=
            cut->end_src_pts -
            cut->start_src_pts;
    }

    *repaired_time =
        map->points[0].repaired_time +
        (src_time - map->points[0].src_pts) -
        removed;

    return 0;
}

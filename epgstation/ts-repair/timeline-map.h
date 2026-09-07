#ifndef TS_REPAIR_TIMELINE_MAP_H
#define TS_REPAIR_TIMELINE_MAP_H

#include <stddef.h>

typedef struct {
    double src_pts;
    double repaired_time;
} TimelinePoint;

typedef struct {
    double start_src_pts;
    double end_src_pts;
} TimelineCut;

typedef struct {
    TimelinePoint *points;
    size_t count;

    TimelineCut *cuts;
    size_t cut_count;
} TimelineMap;

/*
 * Load the video repair timeline.
 *
 * - filters isolated backward source PTS points
 * - sorts by source PTS
 * - constructs CUT AT END intervals
 */
int timeline_map_load(const char *path, TimelineMap *map);

/*
 * Release all memory owned by a TimelineMap.
 */
void timeline_map_free(TimelineMap *map);

/*
 * Returns non-zero when src_time lies inside a removed CUT AT END
 * interval.
 *
 * Intervals are:
 *
 *     [start_src_pts, end_src_pts)
 */
int timeline_map_is_cut(const TimelineMap *map, double src_time);

/*
 * Convert surviving source time to repaired timeline time.
 *
 * Returns:
 *   0  mapped successfully
 *   1  source time is inside a cut interval
 *  -1  source time is outside the usable timeline
 */
int timeline_map_time(const TimelineMap *map,
                      double src_time,
                      double *repaired_time);

#endif

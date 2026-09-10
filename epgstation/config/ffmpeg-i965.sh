#!/bin/bash
export LIBVA_DRIVER_NAME=i965
exec /opt/ffmpeg-7.0.2/bin/ffmpeg "$@"

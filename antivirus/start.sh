#!/bin/sh
# clamd and freshclam are started by the base image's own entrypoint, which stays in the
# background. The HTTP front is the container's main process, so if it dies the container does
# and the platform restarts the pair together.
#
# clamd needs a minute or so to load its signatures. Until it answers, /health reports 503 and
# /scan refuses, which is the right way round: the API treats a scan it cannot get as a refusal.
/init &
exec node /opt/scanner/index.ts

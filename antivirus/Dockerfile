# The vault scanner: ClamAV's daemon and the small HTTP front in src/, in one image, so there
# is one service to deploy rather than two processes to keep pointed at each other.
#
# The base image ships its signature database baked in, so a fresh container is scanning within
# about a minute of boot and freshclam only fetches the daily diffs after that.
FROM clamav/clamav:1.4

# Node is here only for the HTTP front. Alpine 3.24 carries v24, which runs the TypeScript
# sources directly -- same as server/, no build step.
RUN apk add --no-cache nodejs

# Pinned rather than raised: 1.4 already defaults to exactly these, but its own clamd.conf.sample
# still documents StreamMaxLength as 25M, well under a 70 MB vault, and the largest uploads
# silently failing is not something to leave to a default. StreamMaxLength is what one upload may
# be, MaxFileSize covers the archive and its largest member, and MaxScanSize is the total it will
# decompress before giving up on a zip bomb. The base image's entrypoint applies CLAMD_CONF_*.
ENV CLAMD_CONF_StreamMaxLength=100M \
    CLAMD_CONF_MaxFileSize=100M \
    CLAMD_CONF_MaxScanSize=400M \
    PORT=8080 \
    # Node is PID 1 here rather than the base image's tini, so tini reaps as a subreaper instead.
    TINI_SUBREAPER=1

COPY src/ /opt/scanner/
COPY start.sh /opt/scanner/start.sh
RUN chmod +x /opt/scanner/start.sh

EXPOSE 8080
ENTRYPOINT ["/opt/scanner/start.sh"]

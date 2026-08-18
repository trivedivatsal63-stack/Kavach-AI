# Thin wrapper around the upstream image. On hosts where antivirus SSL
# scanning intercepts HTTPS (historically Avast Web/Mail Shield), drop the
# scanner's root CA as a PEM into extra-certs/ so this container trusts it.
# extra-certs/ may be empty — COPY of an empty dir is valid, so a fresh
# clone does not fail the build.
#
# The upstream image's entrypoint.sh already runs update-ca-certificates on
# every start (it starts as root), so dropping a .crt in extra-certs/ is
# enough — no extra RUN step needed here.
FROM searxng/searxng:latest

COPY extra-certs/ /usr/local/share/ca-certificates/

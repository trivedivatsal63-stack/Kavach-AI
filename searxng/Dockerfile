# Thin wrapper around the upstream image — only exists to fix outbound HTTPS
# on this host. Avast's Web/Mail Shield transparently intercepts and
# re-signs outbound TLS traffic for its "SSL scanning" feature; Windows (and
# therefore host processes like the backend) already trusts that root CA,
# but this container's own trust store doesn't, so every request SearXNG
# made to an upstream search engine failed certificate verification.
#
# avast-root-ca.crt is exported directly from this machine's own Windows
# trust store (Cert:\LocalMachine\Root) — this doesn't weaken verification,
# it just extends the container's trust to a CA the host OS already trusts.
# The upstream image's entrypoint.sh already runs update-ca-certificates on
# every start (it starts as root), so dropping the cert in the right place
# is enough — no extra RUN step needed here.
FROM searxng/searxng:latest

COPY avast-root-ca.crt /usr/local/share/ca-certificates/avast-root-ca.crt

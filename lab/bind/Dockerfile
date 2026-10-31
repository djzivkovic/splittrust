# BIND 9 (Debian package) used twice: as the lab's public authoritative server
# (target "bind") and, with the engine binary and the bootstrap script added, as
# the one-shot lab generator (target "bootstrap").
FROM golang:1.26-bookworm AS gobuild
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/splittrust ./cmd/splittrust

FROM debian:bookworm-slim AS bind
RUN apt-get update \
 && apt-get install -y --no-install-recommends bind9 bind9-utils bind9-dnsutils openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM bind AS bootstrap
COPY --from=gobuild /out/splittrust /usr/local/bin/splittrust
COPY lab/bootstrap/bootstrap.sh /bootstrap/bootstrap.sh
COPY lab/bootstrap/zones /bootstrap/zones
COPY lab/external/unbound.conf.tmpl /bootstrap/unbound.conf.tmpl
COPY lab/local-dot/Corefile /bootstrap/conf/local-dot.Corefile
COPY lab/hotel-dot/Corefile /bootstrap/conf/hotel-dot.Corefile
COPY lab/pvd/nginx.conf /bootstrap/conf/nginx.conf
ENTRYPOINT ["bash", "/bootstrap/bootstrap.sh"]

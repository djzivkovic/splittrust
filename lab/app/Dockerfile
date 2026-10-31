# SplitTrust engine: CLI + API + console (React, built in the first stage and
# embedded into the Go binary). Always compiled with the in-process libunbound
# validator (cgo, -tags libunbound).
#
# Why libunbound is built from source here:
#   * Debian's libunbound is linked against nettle and has no TLS, so a
#     TLS-authenticated forward to the network's resolver (RFC 9704 Figure 4)
#     fails with "initialization failure".
#   * Alpine's is OpenSSL-backed, but musl's 128 KiB default thread stacks
#     overflow inside ub_resolve() with TLS (SIGSEGV during cgo execution).
#   glibc + OpenSSL-backed unbound (pinned release, checksum verified) works.
FROM node:22-alpine AS webbuild
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-bookworm AS builder
ARG UNBOUND_VERSION=1.26.1
ARG UNBOUND_SHA256=35a6dc0e425a9282c3426d9a3043144011bf0534aed4b73ab62c52aee0af1503
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential libssl-dev libexpat1-dev libevent-dev curl ca-certificates dns-root-data \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /tmp/unbound.tar.gz "https://nlnetlabs.nl/downloads/unbound/unbound-${UNBOUND_VERSION}.tar.gz" \
  && echo "${UNBOUND_SHA256}  /tmp/unbound.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/unbound.tar.gz -C /tmp \
  && cd "/tmp/unbound-${UNBOUND_VERSION}" \
  && ./configure --prefix=/usr/local --with-ssl --with-libexpat=/usr --with-libevent --with-pthreads --disable-flto --disable-static >/dev/null \
  && make -j"$(nproc)" >/dev/null \
  && make install >/dev/null \
  && ldconfig \
  && rm -rf /tmp/unbound*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=webbuild /src/internal/api/web/dist internal/api/web/dist
RUN go build -tags libunbound -o /out/splittrust ./cmd/splittrust

FROM debian:bookworm-slim AS runtime
# dns-root-data provides /usr/share/dns/root.key, the IANA root trust anchor used
# by the one scenario that validates against the real DNS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3 libexpat1 libevent-2.1-7 ca-certificates dns-root-data \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/lib/libunbound.so* /usr/local/lib/
RUN ldconfig
COPY --from=builder /out/splittrust /usr/local/bin/splittrust
ENV SPLITTRUST_MANIFEST=/gen/client/manifest.json
ENTRYPOINT ["splittrust"]

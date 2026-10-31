FROM alpine:3.20
RUN apk add --no-cache unbound ca-certificates
ENTRYPOINT ["unbound", "-d", "-c", "/gen/external/unbound.conf"]

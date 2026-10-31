# A plain client: no SplitTrust code inside. Whatever it resolves, it resolves
# through the DNS server Docker hands it (the SplitTrust proxy, or the hotel's
# resolver for the naive twin).
FROM alpine:3.22
RUN apk add --no-cache curl bind-tools
CMD ["sleep", "infinity"]

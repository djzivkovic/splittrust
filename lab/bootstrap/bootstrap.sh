#!/usr/bin/env bash
# SplitTrust lab bootstrap: runs once per `docker compose up` and fills the
# shared volume (/gen) with everything the lab needs. Signatures are relative to
# now, so the lab never rots; nothing here is ever committed.
#
#   /gen/work        lab-init output (claims, TXT lines, PvD docs, local zones, manifest)
#   /gen/public-dns  BIND: signed root, lab and parent zones + named.conf
#   /gen/local-dot   CoreDNS hybrid resolver of the legitimate networks (DoT)
#   /gen/hotel-dot   CoreDNS hybrid resolver of the hotel (honest and forging views)
#   /gen/pvd         nginx: PvD documents + certificate
#   /gen/external    unbound "quad9.lab": validating resolver over the lab root
#   /gen/client      what the device was provisioned with: CA, trust anchor, hints, manifest
set -euo pipefail

GEN=${GEN:-/gen}
PUB=172.30.97.10 LOCAL=172.30.97.20 HOTEL=172.30.97.21 PVD=172.30.97.30 BANKWWW=172.30.97.80
TPL=/bootstrap/zones
WORK=$GEN/work
KEYS=$GEN/work/keys

log() { printf '[bootstrap] %s\n' "$*"; }

# Reuse a recent generation. Every `docker compose up` runs this container, but
# the servers only load their zones and certificates at start; regenerating
# underneath them would desynchronise the client's trust anchor from what BIND
# serves. Regenerate when nothing exists, when the generation is older than
# MAX_AGE_HOURS (signatures are valid for 48 h), or when FORCE=1 is set.
# `docker compose down -v` is the documented way to start from scratch.
MAX_AGE_HOURS=${MAX_AGE_HOURS:-20}
if [ -f "$GEN/client/manifest.json" ] && [ "${FORCE:-0}" != "1" ]; then
  age=$(( ( $(date +%s) - $(stat -c %Y "$GEN/client/manifest.json") ) / 3600 ))
  if [ "$age" -lt "$MAX_AGE_HOURS" ]; then
    log "reusing the generation from ${age}h ago (set FORCE=1 or run 'docker compose down -v' to regenerate)"
    cat "$GEN/client/summary.txt"
    exit 0
  fi
  log "generation is ${age}h old; regenerating"
fi

rm -rf "$GEN"/work "$GEN"/public-dns "$GEN"/local-dot "$GEN"/hotel-dot "$GEN"/pvd "$GEN"/external "$GEN"/client
mkdir -p "$WORK" "$KEYS" "$GEN"/public-dns "$GEN"/local-dot "$GEN"/hotel-dot "$GEN"/pvd/docs "$GEN"/external "$GEN"/client/claims

log "engine artefacts (salts, tokens, PvD documents, local zones)"
splittrust lab-init --out "$WORK"

# ---------------------------------------------------------------- certificates
CADIR=$WORK/ca; mkdir -p "$CADIR"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3 -sha256 \
  -keyout "$CADIR/ca.key" -out "$CADIR/ca.pem" -subj "/CN=SplitTrust Lab CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1

# mkcert OUTDIR CN SAN[,SAN...]
mkcert() {
  local out=$1 cn=$2 sans=$3
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$out/key.pem" -out "$out/req.csr" -subj "/CN=$cn" >/dev/null 2>&1
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$sans" > "$out/ext.cnf"
  openssl x509 -req -in "$out/req.csr" -CA "$CADIR/ca.pem" -CAkey "$CADIR/ca.key" -CAcreateserial \
    -days 2 -sha256 -extfile "$out/ext.cnf" -out "$out/cert.pem" >/dev/null 2>&1
  rm -f "$out/req.csr" "$out/ext.cnf"
}
log "certificates"
mkcert "$GEN/local-dot" dns.corp.lab "DNS:dns.corp.lab,DNS:dns2.corp.lab,DNS:dns.stale.lab,DNS:dns.expired.lab,DNS:dns.unsigned.lab,DNS:dns.wrongds.lab,DNS:dns.splittrust.zivkovic.me"
mkcert "$GEN/hotel-dot" dns.hotel.lab "DNS:dns.hotel.lab"
mkcert "$GEN/pvd"       pvd.corp.lab  "DNS:pvd.corp.lab,DNS:pvd.hotel.lab,DNS:replay.hotel.lab,DNS:pvd.stale.lab,DNS:pvd.expired.lab,DNS:pvd.unsigned.lab,DNS:pvd.wrongds.lab"
mkcert "$GEN/external"  quad9.lab     "DNS:quad9.lab"
cp "$CADIR/ca.pem" "$GEN/client/ca.pem"
# For the real-DNS scenario: the lab CA (announced resolver) plus the public CAs (dns.quad9.net).
cat "$CADIR/ca.pem" /etc/ssl/certs/ca-certificates.crt > "$GEN/client/ca-real.pem"

# ---------------------------------------------------------------- public DNSSEC hierarchy
render() { # render ZONE TEMPLATE -> $WORK/zones/ZONE.zone (plus TXT lines when present)
  local zone=$1 tpl=$2 out=$WORK/zones/$1.zone
  mkdir -p "$WORK/zones"
  sed -e "s/@PUB@/$PUB/g" -e "s/@LOCAL@/$LOCAL/g" -e "s/@HOTEL@/$HOTEL/g" -e "s/@PVD@/$PVD/g" -e "s/@BANKWWW@/$BANKWWW/g" "$tpl" > "$out"
  if [ -f "$WORK/txt/$zone.txt" ]; then
    { echo "; RFC 9704 Verification Records"; cat "$WORK/txt/$zone.txt"; } >> "$out"
  fi
}
keygen() { # keygen ZONE
  dnssec-keygen -K "$KEYS" -q -a ECDSAP256SHA256 -f KSK -n ZONE "$1" >/dev/null
  dnssec-keygen -K "$KEYS" -q -a ECDSAP256SHA256 -n ZONE "$1" >/dev/null
}
ksk_file() { grep -l ' 257 3 13 ' "$KEYS"/K"${1%.}".+013+*.key | head -n1; }   # K.+013+N for the root, Kcorp.lab.+013+N otherwise
signzone() { # signzone ZONE FILEBASE START END [extra signzone args]
  local zone=$1 base=$2 start=$3 end=$4; shift 4
  dnssec-signzone -q -S -K "$KEYS" -o "$zone" -s "$start" -e "$end" -N unixtime \
    -f "$GEN/public-dns/$base.zone.signed" "$@" "$WORK/zones/$base.zone" >/dev/null
}
ds_line() { dnssec-dsfromkey -2 "$(ksk_file "$1")"; }

START=now-300 END=now+172800
PARENTS="corp.lab banka.lab stale.lab expired.lab unsigned.lab wrongds.lab hotel.lab"

log "parent zones"
for z in $PARENTS; do render "$z" "$TPL/$z.tmpl"; done
for z in $PARENTS; do
  case $z in
    unsigned.lab) cp "$WORK/zones/$z.zone" "$GEN/public-dns/$z.zone" ;;            # stays unsigned, no DS in lab
    expired.lab)  keygen "$z"; signzone "$z" "$z" now-7200 now-3600 -P ;;          # signatures already expired; -P skips post-sign verification
    *)            keygen "$z"; signzone "$z" "$z" "$START" "$END" ;;
  esac
done

log "lab TLD and root"
render lab "$TPL/lab.tmpl"
for z in $PARENTS; do
  [ "$z" = unsigned.lab ] && continue
  ds_line "$z" >> "$WORK/zones/lab.zone"
done
keygen lab
signzone lab lab "$START" "$END"

render root "$TPL/root.tmpl"
ds_line lab >> "$WORK/zones/root.zone"
keygen .
signzone . root "$START" "$END"

# Trust anchor: the lab root KSK. Root hints: the lab root server.
cp "$(ksk_file .)" "$GEN/client/trust-anchor.key"
cp "$GEN/client/trust-anchor.key" "$GEN/external/trust-anchor.key"
printf '.\t3600000\tIN\tNS\tns.lab.\nns.lab.\t3600000\tIN\tA\t%s\n' "$PUB" | tee "$GEN/client/root.hints" > "$GEN/external/root.hints"

cat > "$GEN/public-dns/named.conf" <<EOF
options {
  directory "/var/cache/bind";
  listen-on { any; };
  listen-on-v6 { none; };
  recursion no;
  allow-query { any; };
  allow-transfer { none; };
  dnssec-validation no;
  minimal-responses no;
};
zone "." { type primary; file "/gen/public-dns/root.zone.signed"; };
zone "lab" { type primary; file "/gen/public-dns/lab.zone.signed"; };
zone "unsigned.lab" { type primary; file "/gen/public-dns/unsigned.lab.zone"; };
EOF
for z in $PARENTS; do
  [ "$z" = unsigned.lab ] && continue
  echo "zone \"$z\" { type primary; file \"/gen/public-dns/$z.zone.signed\"; };" >> "$GEN/public-dns/named.conf"
done
named-checkconf "$GEN/public-dns/named.conf"

# ---------------------------------------------------------------- local resolvers, PvD, external, client
cp "$WORK"/local-dot/*.zone "$GEN/local-dot/"
cp "$WORK"/hotel-dot/banka.lab.fake "$WORK"/hotel-dot/hosts "$GEN/hotel-dot/"
cp "$WORK"/pvd/*.json "$GEN/pvd/docs/"
sed -e "s#@GEN@#$GEN#g" /bootstrap/unbound.conf.tmpl > "$GEN/external/unbound.conf"
cp /bootstrap/conf/local-dot.Corefile "$GEN/local-dot/Corefile"
cp /bootstrap/conf/hotel-dot.Corefile "$GEN/hotel-dot/Corefile"
cp /bootstrap/conf/nginx.conf "$GEN/pvd/nginx.conf"
cp "$WORK/client/manifest.json" "$GEN/client/manifest.json"
cp "$WORK"/client/claims/*.json "$GEN/client/claims/"
cp "$WORK/summary.txt" "$GEN/client/summary.txt"

# Everything the runtime containers read must be world-readable (they run as
# unprivileged users); private keys stay inside the volume only.
chmod -R a+rX "$GEN"/public-dns "$GEN"/local-dot "$GEN"/hotel-dot "$GEN"/pvd "$GEN"/external "$GEN"/client
chmod 644 "$GEN"/*/key.pem

log "done"
cat "$GEN/client/summary.txt"

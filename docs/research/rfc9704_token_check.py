#!/usr/bin/env python3
"""RFC 9704 verification-token calculator and test-vector seed (stdlib only).

Implements Section 5 of RFC 9704 literally:
  1. canonical form (lowercase, wire format) + canonical order (RFC 4034 s6.1)
  2. replace the parent-zone suffix with a single zero octet
  3. X = concatenation of the resulting pseudo-FQDNs
  4. len(salt) as one octet
  5. TOKEN = hash(len(salt) || salt || X), hash from the ZONEMD registry (1=SHA384, 2=SHA512)

Run it to see the forensics of the broken example in RFC 9704 s5.1 and to dump
the first test vectors as JSON:  python3 rfc9704_token_check.py [--json]
"""
import base64
import hashlib
import json
import sys

ZONEMD_HASHES = {"SHA384": "sha384", "SHA512": "sha512"}  # RFC 8976 s5.3 mnemonics


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def labels_of(name: str) -> list[bytes]:
    """Lowercase A-labels of a name (IDN U-labels are converted with IDNA 2003 as a first cut)."""
    name = name.rstrip(".")
    if not name:
        return []
    return [label.encode("idna").lower() for label in name.split(".")]


def canonical_key(labels: list[bytes]) -> list[bytes]:
    # RFC 4034 s6.1: compare rightmost label first; a missing label sorts before any octet.
    return list(reversed(labels))


def wire(labels: list[bytes]) -> bytes:
    return b"".join(bytes([len(label)]) + label for label in labels)


def pseudo_fqdns(parent: str, subdomains: list[str]) -> tuple[bytes, list[str]]:
    """Return X and the subdomains in canonical order (as relative names)."""
    parent_labels = labels_of(parent)
    relative = []
    for sub in subdomains:
        labels = labels_of(sub)
        if labels[-len(parent_labels) :] == parent_labels and len(labels) > len(
            parent_labels
        ):
            labels = labels[: -len(parent_labels)]  # absolute form -> relative
        if sub == "*":
            labels = [
                b"*"
            ]  # whole-zone claim: '*' kept as a literal label (RFC 4034 s6.2 item 4)
        if not labels:
            raise ValueError(
                f"subdomain {sub!r} equals the parent; use '*' to claim the whole zone"
            )
        relative.append(labels)
    relative.sort(key=canonical_key)
    x = b"".join(wire(labels) + b"\x00" for labels in relative)
    return x, [b".".join(labels).decode() for labels in relative]


def token(
    parent: str, subdomains: list[str], salt: bytes, algorithm: str = "SHA384"
) -> tuple[str, bytes]:
    if not 0 <= len(salt) <= 255:
        raise ValueError("salt must be 0..255 octets")
    x, _ = pseudo_fqdns(parent, subdomains)
    digest = hashlib.new(
        ZONEMD_HASHES[algorithm], bytes([len(salt)]) + salt + x
    ).digest()
    return b64url(digest), x


def record_name(adn: str, parent: str) -> str:
    return f"{adn.rstrip('.')}._splitdns-challenge.{parent.rstrip('.')}."


def main() -> None:
    vectors = []

    def add(name, parent, subs, salt, alg="SHA384", note=""):
        tok, x = token(parent, subs, salt, alg)
        _, order = pseudo_fqdns(parent, subs)
        vectors.append(
            {
                "name": name,
                "parent": parent,
                "subdomains_input": subs,
                "subdomains_canonical": order,
                "algorithm": alg,
                "salt_b64url": b64url(salt),
                "salt_len": len(salt),
                "X_hex": x.hex(),
                "token": tok,
                "note": note,
            }
        )
        return tok

    rfc_printed = "z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR-KJDv2eFwfJcWQM"
    rfc_subs = ["payroll.parent.example", "secret.project.parent.example"]
    t_octets = add(
        "rfc9704-5.1-as-printed-salt",
        "parent.example",
        rfc_subs,
        b"example salt octets (should be random)",
        note="salt string as printed in RFC 9704",
    )
    t_bytes = add(
        "rfc9704-5.1-draft07-salt",
        "parent.example",
        rfc_subs,
        b"example salt bytes (should be random)",
        note="salt string used in draft-07; first 40 chars match the token printed in the RFC",
    )
    add(
        "guide-firma.rs",
        "firma.rs",
        ["mail.firma.rs", "intranet.firma.rs"],
        bytes.fromhex("567de4436afd6d7cf4a4b9b862df301c"),
        note="example from the study guide",
    )
    add(
        "canonical-vs-alphabetical",
        "firma.rs",
        ["intranet", "mail", "vpn.intranet"],
        bytes.fromhex("567de4436afd6d7cf4a4b9b862df301c"),
        note="canonical order is intranet, vpn.intranet, mail (not alphabetical)",
    )
    add(
        "uppercase-normalised",
        "Firma.RS",
        ["INTRANET", "Mail"],
        bytes.fromhex("567de4436afd6d7cf4a4b9b862df301c"),
        note="must equal guide-firma.rs",
    )
    add(
        "whole-zone-star",
        "banka.lab",
        ["*"],
        bytes(range(16)),
        note="implementation choice: '*' hashed as literal label \\x01*\\x00",
    )
    add(
        "sha512",
        "firma.rs",
        ["intranet", "mail"],
        bytes.fromhex("567de4436afd6d7cf4a4b9b862df301c"),
        "SHA512",
    )
    add(
        "idn-srb",
        "фирма.срб",
        ["интранет"],
        bytes(range(16)),
        note="U-labels hashed as A-labels (xn--)",
    )
    add(
        "empty-salt",
        "firma.rs",
        ["intranet"],
        b"",
        note="allowed by the text; verifier should warn",
    )

    if "--json" in sys.argv:
        print(json.dumps(vectors, indent=2, ensure_ascii=False))
        return

    print("RFC 9704 s5.1 forensics")
    print(
        f"  printed in RFC          : {rfc_printed}  ({len(rfc_printed)} chars, "
        f"{len(b64url_decode(rfc_printed))} bytes decoded; SHA-384 is 48 bytes = 64 chars)"
    )
    print(f"  salt 'octets' (RFC text): {t_octets}")
    common = next(
        (i for i, (a, b) in enumerate(zip(t_bytes, rfc_printed)) if a != b),
        len(rfc_printed),
    )
    print(
        f"  salt 'bytes' (draft-07) : {t_bytes}  <- {common} leading chars ({common * 6 // 8} bytes) match the RFC"
    )
    draft07_salt = b"example salt bytes (should be random)"
    digest_bytes = hashlib.sha384(
        bytes([len(draft07_salt)])
        + draft07_salt
        + pseudo_fqdns("parent.example", rfc_subs)[0]
    ).digest()
    nul_positions = [i for i, b in enumerate(digest_bytes) if b == 0]
    stripped = b64url(digest_bytes.replace(b"\x00", b""))
    print(f"  same digest, NUL byte(s) at {nul_positions} removed -> {stripped}")
    print(
        f"  ... identical to the printed token: {stripped == rfc_printed}  "
        "(explains both the 47-byte length and the garbled tail)"
    )
    print(
        f"  record name             : {record_name('resolver17.parent.example', 'parent.example')}"
    )
    print()
    for v in vectors:
        print(f"{v['name']:28s} {v['algorithm']:6s} {v['token']}")
        print(f"{'':28s} order={v['subdomains_canonical']} X={v['X_hex']} {v['note']}")


if __name__ == "__main__":
    main()

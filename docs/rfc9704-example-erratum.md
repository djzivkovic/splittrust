# RFC 9704: erratum report (draft) and implementer notes

Status: **draft, not yet filed.** Team NXDOMAIN, DNS SEC(urity) Hackathon 2026. Per the hackathon
rules this goes to the organisers first; filing at <https://www.rfc-editor.org/errata.php> follows.
Reproduction: `splittrust vectors` (Go) and `docs/research/rfc9704_token_check.py` (stdlib Python)
agree on every value below.

## Erratum 1: Section 5.1, the worked example cannot be reproduced (Technical)

**Section 5.1 says:**

```
   *  Salt = "example salt octets (should be random)"
   ...
     resolver17.parent.example._splitdns-challenge.parent.example. \
     IN TXT "token=z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR\
     -KJDv2eFwfJcWQM"
```

**Observation.** The printed token has 63 base64url characters and decodes to 47 octets. SHA-384,
the hash algorithm of the example, always produces 48 octets (64 characters). The token therefore
cannot be the output of the procedure in Section 5 for *any* input.

**What happened.** The example can be reconstructed exactly from the document's history:

1. In draft-ietf-add-split-horizon-authority-07 the salt read `"example salt bytes (should be
   random)"`. Computing Section 5 literally for that salt gives the 48-octet digest

   `cf5ab22bb416c103e44fe666556fad0106ec37261e9d33413e9e6881807c004b5c1eb15091f8a243bf6785c1f25c5903`

   whose base64url form is `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8AEtcHrFQkfiiQ79nhcHyXFkD`.
2. That digest contains a single `0x00` octet at offset 30. Removing it and encoding the remaining
   47 octets yields **exactly** the printed token `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR-KJDv2eFwfJcWQM`.
   The helper that produced the example evidently handled the digest as a NUL-terminated string.
3. In draft-10 the salt text was reworded from "bytes" to "octets" (the same revision changed "zero
   byte" to "zero octet" in step 2 of the procedure). The token was not recomputed.

Both facts are independent: even with the original salt the token is wrong (missing octet), and
even without the missing octet the salt no longer matches.

**It should say** (either consistent fix):

- keep the printed salt and replace the token with
  `wA1lI3Tdnm2z3rbjAa6A998luwSDTU9LU45SoruhsTBtmcdL5BhalHS2v5UCSzal`; or
- restore `Salt = "example salt bytes (should be random)"` and replace the token with
  `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8AEtcHrFQkfiiQ79nhcHyXFkD`.

For either choice, the intermediate values an implementer needs are:

```
canonical order      payroll.parent.example, secret.project.parent.example
X                    07 7061 79 72 6f 6c 6c 00  06 73 65 63 72 65 74 07 70 72 6f 6a 65 63 74 00
                     = \x07payroll\x00 \x06secret\x07project\x00
len(salt)            0x26 (38) for "…octets…"   /   0x25 (37) for "…bytes…"
token input          len(salt) || salt || X
```

**Why it matters.** This is the only worked example in the specification and the only thing an
implementer can test against. A wrong example is worse than none: an implementation that
*matches* it is broken, and one that does not cannot tell whether it or the document is wrong.

## Erratum 2: Section 7, Figure 1, the NSEC record (Editorial/Technical, lower priority)

**Figure 1 says:** `@ IN NSEC subdomain.parent.example. NS`

**Problem.** RFC 4035 §2.3 requires the type bit map of every NSEC record in a signed zone to include
NSEC and RRSIG, and the apex also holds SOA and DNSKEY. More importantly, the proof that
`subdomain.parent.example` is an *insecure* delegation is the NSEC record **at the delegation
point**, with the NS bit set and the DS bit clear, not an NSEC at the apex pointing to it. The
delegation itself (`subdomain IN NS …`) is also missing from the figure.

**It should say** (illustratively):

```
   subdomain IN NS ns.subdomain.parent.example.
   subdomain IN NSEC <next-name>.parent.example. NS RRSIG NSEC
```

## Observation 3: Section 5.1's names are Special-Use (Editorial)

The example uses `parent.example`. `.example` is in the IANA Special-Use Domain Names registry
(RFC 6761), and Section 3 says Special-Use Domain Names "MUST NOT be validated using the mechanism
described in this document". A strictly conformant verifier therefore refuses the specification's
own example claim. The example is still useful for token computation (SplitTrust flags the name and
continues for inspection, and rejects it in verification), but a name under a documentation TLD that
is *not* special-use, or an explicit note, would avoid the contradiction.

## Implementer notes: what RFC 9704 leaves to the implementation

Each of these produced a decision and a test vector in SplitTrust. They are offered as input to the
ADD working group, not as errata.

1. **Encoding of `*` in `$X`.** Section 5 says the whole zone is claimed with `"*"`, and the token
   procedure converts "all subdomains into canonical form". Is the pseudo-FQDN `\x01*\x00` (the
   literal label, as RFC 4034 §6.2 item 4 keeps wildcards) or `\x00` (the parent itself)? SplitTrust
   uses `\x01*\x00`; it is also the only form the DHCP encoding can carry. Two implementations that
   choose differently will never agree on a token.
2. **Key/value delimiter in the Verification Record.** Only shown by example (`"token=abc...,ds=QWE..."`).
   SplitTrust accepts comma-separated pairs, concatenates character-strings *within* one RR only,
   ignores unknown keys, and treats duplicate `token` keys in one RR as invalid.
3. **One claim per DHCP message.** Section 5.2.1 says "each authorization claim is encoded as a
   DHCP Authentication option", but RFC 8415 §20.2 forbids more than one Authentication option per
   DHCPv6 message, and RFC 3396 (which §5.2.1 invokes) makes a DHCPv4 client concatenate repeated
   option 90 instances, and `$X` is not self-delimiting. In practice DHCP carries exactly one claim;
   PvD carries any number.
4. **Replay Detection field.** Section 5.2.1 fixes RDM to 0 but never says what the 64-bit field
   holds. RFC 3118 / RFC 8415 §20.3 require a strictly increasing counter for RDM 0 and oblige a
   client to reject a message whose value is not greater than the previous one from that server.
   A server that sends a constant breaks on its second message.
5. **`ds=` digest owner name.** A DS digest is computed over an owner name. Section 7 says the DS
   "authorizes a DNSKEY whose owner name is resolver.arpa.", which implies the digest is over
   `resolver.arpa.`; an operator who pastes `dnssec-dsfromkey` output computed for the child zone's
   apex produces a value that never matches. SplitTrust computes over `resolver.arpa.`.
6. **IDNA.** PvD JSON may carry U-labels (`интранет.фирма.срб`). The document does not say to
   convert to A-labels before hashing; SplitTrust does.
7. **Canonical order in PvD.** Section 5.2.2 requires the network to send subdomains "in canonical
   order", but a client that trusts that order and one that re-sorts compute different tokens when
   the network gets it wrong. SplitTrust always re-sorts and warns.
8. **Insecure and the external path.** Section 6.1 applies "only if the client is already
   configured" with an external encrypted resolver. SplitTrust models this as a property of the
   device, not of the verification run; the lab shows the same unsigned zone rejected by a
   validating device and accepted, visibly weaker, by a device whose default resolver is external.

## Implementation status wording

"We found no public implementation of RFC 9704; the authors reported zero known implementations at
DNS-OARC 44 (February 2025)." SplitTrust does not claim to be the first; it claims to be testable.

/* Presentation metadata for the simulated devices. Verdicts come from the API; this file only
   knows how to introduce each device to a human. */

import type { Device } from "./api";

export interface DeviceCard { id: Device; name: string; short: string; blurb: string }

export const DEVICES: DeviceCard[] = [
  { id: "validating-stub", name: "Laptop", short: "validates DNSSEC itself",
    blurb: "Checks every DNSSEC signature itself. The network's resolver is only a forwarder. If a zone is unsigned there is nothing to check, so nothing is trusted." },
  { id: "private-dns", name: "Phone", short: "Private DNS via Quad9",
    blurb: "Sends all queries to Quad9 over TLS and verifies the owner's record through it. Its safety rests on Quad9. RFC 9704 section 6.1 calls this the external-resolver path." },
  { id: "hybrid", name: "Hybrid", short: "validates, falls back to Quad9",
    blurb: "Validates like the laptop. Only when a zone is provably unsigned does it ask Quad9 instead (RFC 9704 section 6.2, the recommended retry)." },
];

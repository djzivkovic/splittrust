/* The demo as a sequence of scenes. Each scene is one lab network told as a real situation,
   with the device the story starts on and the name the person tries to open. Presenter notes
   are what to say; the screens show what is true. */

import type { Device } from "./api";

export interface Scene {
  id: string;            // scenario id
  title: string;         // short, for the strip
  situation: string;     // one or two sentences, plain language, present tense
  device: Device;        // where the story starts
  name: string;          // the name the person opens
  announces: string;     // what the network says, in words
  world: string;         // what is actually true
  notes: string[];       // presenter notes per step (situation, announced, checks, verdict, proof)
  talk?: boolean;        // part of the five-minute talk
}

export const SCENES: Scene[] = [
  {
    id: "hotel-forged", title: "Hotel: forged record", talk: true, device: "validating-stub", name: "www.banka.lab",
    situation: "You check into a hotel and join its Wi-Fi. The network tells your laptop that its own resolver answers for your bank's domain. You open the bank.",
    announces: "dns.hotel.lab answers for everything under banka.lab.",
    world: "The hotel's resolver serves its own copy of banka.lab, including a Verification Record with the correct token. It wrote the claim, so it knows the token. The bank's zone never signed any of it.",
    notes: [
      "A hotel Wi-Fi tells your laptop: I answer for the bank. Nothing today lets the laptop check whether the bank agreed. Encrypting DNS does not help: you are talking to the wrong server, encrypted.",
      "This is the claim as the network actually sent it: resolver name, parent domain, the names it wants, a salt. RFC 9704 turns this into a token the domain owner would have to publish.",
      "The hotel publishes a record with the correct token. The token matches. But the record comes from the hotel's own copy of the zone, and the bank's signatures are missing. The device says: bogus.",
      "The token is not the proof. The owner's DNSSEC signature is. Nothing under banka.lab is sent to the hotel's resolver.",
      "Same Wi-Fi, two devices. Without SplitTrust: the hotel's fake bank. With SplitTrust: the name does not resolve. Failing safely is the feature.",
    ],
  },
  {
    id: "legit", title: "Office: the intranet", talk: true, device: "validating-stub", name: "host.internal.corp.lab",
    situation: "You are on your company's Wi-Fi with a company laptop. The network says its resolver answers for the internal domain. You open an intranet host that does not exist in the public DNS.",
    announces: "dns.corp.lab answers for internal.corp.lab; dns2.corp.lab answers for mail.corp.lab.",
    world: "corp.lab is DNSSEC-signed and publishes both Verification Records. The first also delegates a DNSSEC key to the company resolver.",
    notes: [
      "The legitimate case: split-horizon DNS that the domain owner actually agreed to. Same mechanism, opposite outcome.",
      "Two claims this time. Each is verified on its own.",
      "The record exists, is signed from the root down, and carries the expected token. The owner also delegated a key, so the device can validate the company resolver's own answers.",
      "Authority established. Queries for internal.corp.lab go to dns.corp.lab over authenticated TLS and every answer is validated under the delegated key.",
      "A plain client, no SplitTrust code inside, with the SplitTrust proxy as its DNS server: the intranet page loads and the answer carries the AD flag.",
    ],
  },
  {
    id: "hotel", title: "Hotel: plain hijack", talk: true, device: "validating-stub", name: "www.banka.lab",
    situation: "The same hotel, without the forgery. The network still claims the bank, and its resolver simply answers www.banka.lab with its own address.",
    announces: "dns.hotel.lab answers for everything under banka.lab.",
    world: "The bank never published a Verification Record. The hotel relays the bank's signed denial unchanged and overrides www.banka.lab for its guests.",
    notes: [
      "The hotel does not bother to forge anything. It just answers the bank's name with its own server.",
      "Same claim as before.",
      "The device asks for the owner's record through the hotel. The bank's zone answers, signed: there is no such record. The hotel cannot hide a signed denial.",
      "Rejected: the owner published nothing. The device keeps its normal path for the bank.",
      "Now switch the device to the phone with Private DNS: it gets the real bank through Quad9. The device without SplitTrust gets the fake page either way.",
    ],
  },
  {
    id: "unsigned", title: "Cafe: unsigned zone", talk: true, device: "validating-stub", name: "host.internal.unsigned.lab",
    situation: "A small company runs a cafe network. Its claim is honest and its record is correct, but it never signed its zone with DNSSEC.",
    announces: "dns.unsigned.lab answers for internal.unsigned.lab.",
    world: "The record is published and correct, but unsigned.lab has no DNSSEC. There is no signature chain to check.",
    notes: [
      "An honest network with a correct record, and still a problem: the zone is not signed.",
      "The claim is fine. The owner did publish the matching record.",
      "A device that validates DNSSEC gets a provably unsigned answer. Without a signature there is no proof, and the RFC says a validating device with nobody else to ask must treat this as failed.",
      "Press 2 for the phone with Private DNS: it asks Quad9, Quad9 says the record exists, and the device accepts. Yellow: this authority rests entirely on Quad9. The fix is to sign the zone.",
      "The laptop cannot resolve the internal host at all. The phone can. Both are correct under the RFC.",
    ],
  },
  {
    id: "replay", title: "Hotel: replayed claim", device: "validating-stub", name: "host.internal.corp.lab",
    situation: "The hotel copies the company's claim word for word and announces its own resolver under the company's resolver name.",
    announces: "dns.corp.lab answers for internal.corp.lab (the company's claim, copied).",
    world: "The hotel's resolver sits at the announced address, but its certificate is for dns.hotel.lab.",
    notes: [
      "Can an attacker replay a legitimate claim? The record in the company's zone is public, after all.",
      "The claim is a perfect copy of the company's.",
      "Before any DNS query the device makes the resolver prove its name over TLS. The certificate says dns.hotel.lab, not dns.corp.lab.",
      "Rejected before a single DNS query. A copied claim is worthless without the resolver's certificate.",
      "Nothing to resolve: the device never used that resolver.",
    ],
  },
  {
    id: "hotel-blocks-external", title: "Hotel: Quad9 blocked", device: "private-dns", name: "www.banka.lab",
    situation: "The hotel claims the bank and blocks port 853 to Quad9, so a phone with Private DNS cannot reach its own resolver.",
    announces: "dns.hotel.lab answers for everything under banka.lab.",
    world: "Port 853 to Quad9 is black-holed.",
    notes: [
      "What if the attacker blocks the external resolver a phone relies on?",
      "Same claim.",
      "The phone tries Quad9 and gets nothing.",
      "No answer means verification failed, per the RFC. The hotel achieved a denial of service, not a redirect.",
      "The phone keeps its defaults and cannot reach Quad9 at all on this network.",
    ],
  },
  {
    id: "stale-salt", title: "Branch: stale record", device: "validating-stub", name: "host.internal.stale.lab",
    situation: "A branch office changed the salt in its claim but did not update the record in the zone.",
    announces: "dns.stale.lab answers for internal.stale.lab (with a new salt).",
    world: "The zone still carries the record for the old salt.",
    notes: ["An honest operational mistake.", "The claim carries a new salt.", "The owner's record is valid and signed, but it was computed for the old salt.", "Rejected: tokens differ. RFC 9704 section 11: publish the new record before changing the claim.", "The internal host does not resolve on the laptop until the record is updated."],
  },
  {
    id: "expired-signature", title: "Branch: expired signatures", device: "validating-stub", name: "host.internal.expired.lab",
    situation: "A branch office signed its zone but let the signatures expire.",
    announces: "dns.expired.lab answers for internal.expired.lab.",
    world: "Every RRSIG in expired.lab expired an hour ago.",
    notes: ["Signatures have lifetimes.", "The claim is fine.", "The chain of trust fails on the expired signatures.", "Rejected as bogus. Monitor your signer.", "The internal host does not resolve."],
  },
  {
    id: "wrong-ds", title: "Branch: wrong key", device: "validating-stub", name: "host.internal.wrongds.lab",
    situation: "A branch office published a record that delegates a DNSSEC key, but the resolver holds a different key.",
    announces: "dns.wrongds.lab answers for internal.wrongds.lab.",
    world: "The record's ds value does not match any key the resolver presents for resolver.arpa.",
    notes: ["The owner can delegate a key to the resolver so local answers can be validated.", "The record carries a ds value.", "Everything checks out until the key comparison.", "Rejected. The device does not quietly downgrade to token-only authority.", "The internal host does not resolve."],
  },
  {
    id: "special-use", title: "Home: home.arpa", device: "validating-stub", name: "printers.home.arpa",
    situation: "A home router claims authority over home.arpa.",
    announces: "dns.corp.lab answers for printers.home.arpa.",
    world: "home.arpa is a Special-Use Domain Name (RFC 6761).",
    notes: ["Not everything is verifiable.", "The claim names a Special-Use domain.", "RFC 9704 section 3: such names must not be verified this way. The device stops without sending anything.", "Rejected with zero network traffic.", "home.arpa names are handled by the local network as always."],
  },
  {
    id: "real-zivkovic", title: "Real Internet: zivkovic.me", device: "validating-stub", name: "host.internal.splittrust.zivkovic.me",
    situation: "Our own domain on the real Internet. The zone is hosted at Cloudflare, DNSSEC-signed, with the DS record at the .me registry.",
    announces: "dns.splittrust.zivkovic.me answers for internal.splittrust.zivkovic.me.",
    world: "A real Verification Record, validated under the IANA root trust anchor, from the lab's only Internet-connected container.",
    notes: ["Is this only a lab trick?", "The same claim format, in a real zone.", "The verification runs from a terminal because the console's container has no Internet access.", "Accepted under the real root. Through the real dns.quad9.net: accepted as well.", "The lab names are not reachable from this container."],
  },
];

export const STEP_NAMES = ["Situation", "What the network sent", "What the device checks", "Verdict and evidence", "Proof: two devices"];

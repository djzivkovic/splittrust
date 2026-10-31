/* The demo: two companies in the same situations. Alfa adopted RFC 9704 with SplitTrust; its zone is
   the real, DNSSEC-signed zivkovic.me. Beta did not; its devices use whatever resolver the network
   hands them. Every Alfa verdict is computed live against the real DNS. */


export interface Company {
  name: string;
  domain: string;
  adopted: boolean;
  intranet: string;     // the internal host an employee opens
  publicSite: string;   // the company's public site (exists in the real DNS)
  naiveDNS: string;     // the resolver a device without SplitTrust uses on this scene's network
}

export interface Scene {
  id: string;             // Alfa's verification scenario on this network
  title: string;
  when: string;           // one line: where and when
  situation: string;      // what happens, plain language
  alfa: Company;
  beta: Company;
  withoutTool: string;    // what Beta's device does
  withTool: string;       // what Alfa's device does
  lesson: string;         // the takeaway for a company deciding whether to adopt
  check: string;          // one command anyone in the room can run
  notes: string[];        // presenter notes: story, verification, result
}

const ALFA_OFFICE: Company = { name: "Alfa", domain: "zivkovic.me", adopted: true, intranet: "host.internal.splittrust.zivkovic.me", publicSite: "zivkovic.me", naiveDNS: "172.30.97.20:53" };
const BETA_OFFICE: Company = { name: "Beta", domain: "beta.example", adopted: false, intranet: "intranet.beta.example", publicSite: "beta.example", naiveDNS: "172.30.97.20:53" };
const ALFA_HOTEL: Company = { ...ALFA_OFFICE, naiveDNS: "172.30.97.21:53" };
const BETA_HOTEL: Company = { ...BETA_OFFICE, naiveDNS: "172.30.97.21:53" };

export const SCENES: Scene[] = [
  {
    id: "real-office", title: "1. Monday: at the office",
    when: "Both employees are at their own company's office, on the company Wi-Fi.",
    situation: "Each office network hands out a resolver that knows the company's internal hosts, which do not exist in the public DNS. Both employees open their intranet.",
    alfa: ALFA_OFFICE, beta: BETA_OFFICE,
    withoutTool: "Beta's laptop uses the resolver the network gave it. The intranet loads. Nothing was checked; nothing needed checking today.",
    withTool: "Alfa's laptop first verifies the network's claim: it fetches Alfa's Verification Record from the real zivkovic.me zone, validates the DNSSEC chain from the root, and makes the office resolver prove its name. Only then does it use that resolver for internal.splittrust.zivkovic.me.",
    lesson: "On a trusted network both companies work the same. The difference is invisible on Monday.",
    check: "dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me",
    notes: [
      "Two companies, same job: an internal site that only the office resolver knows. Alfa published one TXT record in its real zone and runs the SplitTrust resolver on its laptops. Beta did neither.",
      "Alfa's laptop does what RFC 9704 asks before trusting the office resolver with those names: token, TLS identity, the owner's record validated from the real root down. Accepted. This is live against the real DNS; the dig command on the left works from your laptop too.",
      "Both intranets load. Alfa's answer is marked as coming from a resolver the domain owner authorised; Beta's is just an answer.",
    ],
  },
  {
    id: "real-hotel-forged", title: "2. Tuesday: at the hotel",
    when: "Both employees travel. They join the hotel Wi-Fi and open their intranet, as they do every day.",
    situation: "The hotel network announces that its resolver answers for both companies' domains, and that resolver serves its own copy of each zone: every name points at the hotel's page, and for Alfa's domain it even publishes a Verification Record with the correct token, because it wrote the claim.",
    alfa: ALFA_HOTEL, beta: BETA_HOTEL,
    withoutTool: "Beta's laptop uses the resolver the network gave it, exactly as on Monday. The intranet name resolves to the hotel's server. The page looks like the intranet login.",
    withTool: "Alfa's laptop verifies the hotel's claim against the real DNS. The token matches, but the record did not come from Cloudflare's signed zone: Bogus. The claim is rejected and the hotel's resolver is never used for zivkovic.me. The name fails to resolve instead of resolving to the wrong place.",
    lesson: "The same employee behaviour, the same Wi-Fi. Beta's credentials are on the hotel's server. Alfa's laptop failed safely, and Alfa's phone with Private DNS reaches the real zivkovic.me through Quad9.",
    check: "dig +short zivkovic.me @9.9.9.9   (the real addresses, not 172.30.97.66)",
    notes: [
      "Tuesday. Same employees, same habit, hostile Wi-Fi. The hotel claims both domains. For Alfa's it goes further and forges the owner's record with the right token.",
      "Alfa's laptop validates the record against the real DNSSEC chain: root, .me, Cloudflare. The hotel has the token but not Cloudflare's signatures. Bogus, rejected, resolver never used. The token is not the proof; the signature is.",
      "Beta's laptop gets the fake page. Alfa's laptop cannot resolve the name and stops. Press 2: Alfa's phone with Private DNS asks Quad9 and reaches the real site. That is the whole case for adopting this: the attack that works on Beta does not work on Alfa.",
    ],
  },
  {
    id: "real-replay", title: "3. What Alfa's IT did",
    when: "Back at the office, after the trip.",
    situation: "Alfa's record is public, so a hotel can copy Alfa's claim word for word and announce its own resolver under Alfa's resolver name. Beta's IT asks what it would take to be in Alfa's position.",
    alfa: ALFA_HOTEL, beta: BETA_HOTEL,
    withoutTool: "Beta has nothing to copy and nothing to check. Any network can claim beta.example.",
    withTool: "Alfa's laptop makes the resolver prove its name over TLS before any DNS query. The hotel's certificate is for dns.hotel.lab, not dns.splittrust.zivkovic.me. Rejected before a single query.",
    lesson: "Three things Alfa did: signed its zone (DNSSEC), published one TXT record for the claim, and pointed its devices at a resolver that checks. No change to applications, no new servers at the hotel's mercy.",
    check: "dig +short zivkovic.me DS   (the signed chain that makes the record provable)",
    notes: [
      "Last question: is this just a TXT record anyone can copy? The record is public.",
      "A copied claim is worthless without the resolver's certificate. Alfa's laptop rejects the hotel before the first DNS query.",
      "What Alfa did, in order: DNSSEC on the zone, one TXT record built with the owner tool, the SplitTrust resolver on devices. The live records below are the actual state of the real zone, right now.",
    ],
  },
];

export const STEP_NAMES = ["The story", "Alfa's device checks", "Both devices open the intranet"];

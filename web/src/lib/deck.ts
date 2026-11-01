/* Static teaching examples. These are not backend profiles or measured results. */

export type Place = "office" | "hotel";

export interface Scene {
  id: "real-office" | "real-hotel-forged" | "real-replay";
  place: Place;
  day: string;
  headline: string;
  sub: string;
  takeaway: string;
}

export const STORY = {
  company: "SecureCompany", parent: "corp.lab", name: "git.dev.corp.lab", scope: "dev.corp.lab",
  officeResolver: "dns.corp.lab", hotelResolver: "dns.hotel.lab",
  privateIP: "10.20.0.10", attackerIP: "172.30.97.66",
};

export const SCENES: Scene[] = [
  {
    id: "real-office", place: "office", day: "Example 1",
    headline: "At the office",
    sub: "A legitimate private DNS view.",
    takeaway: "Accept the company's private DNS view without blindly trusting network DNS for every name.",
  },
  {
    id: "real-hotel-forged", place: "hotel", day: "Example 2",
    headline: "At the hotel",
    sub: "Same bookmark. Corporate VPN off.",
    takeaway: "The hotel can supply DNS, but the company never authorized it to serve the private GitLab view.",
  },
  {
    id: "real-replay", place: "hotel", day: "Example 3",
    headline: "What the company configures",
    sub: "",
    takeaway: "Resolver TLS proves identity. The owner's record establishes authority over specific names.",
  },
];

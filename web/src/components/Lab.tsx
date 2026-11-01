import { Slide } from "./Slide";

export function LabSlide() {
  const checks = [
    ["Resolver identity", "Does the TLS certificate match the resolver name in the claim? A copied claim does not copy that identity."],
    ["Owner's permission", "Authenticate the owner's Verification Record and match its token to the exact resolver, names and salt."],
    ["Local DNSSEC key", "If the record delegates a key with ds, check that binding and validate local answers under the approved key."],
    ["Scope and lifetime", "Apply the grant only to its approved names, only while it is valid. It is not blanket trust in the network."],
  ];
  return (
    <Slide section="Trust rules" title="How the proxy decides" sub="A policy explanation, not a live status panel."
      takeaway="Rejecting a claim removes its authority. It does not make an untrusted default resolver safe.">
      <div className="flex flex-1 flex-col justify-center gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          {checks.map(([title, text], index) => (
            <div key={title} className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-xl font-bold"><span className="mr-3 text-blue-700">{index + 1}.</span>{title}</h3>
              <p className="mt-2 text-base text-slate-600">{text}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <h3 className="font-bold text-green-900">Valid grant + name in scope</h3>
            <p className="mt-2 text-sm text-green-900">Use the approved local resolver and the grant's local-answer validation rules.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold">No usable grant / name outside scope</h3>
            <p className="mt-2 text-sm text-slate-600">Use the device's normal DNS path. Do not accept the network's claimed authority.</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="font-bold text-red-900">DNSSEC-bogus answer</h3>
            <p className="mt-2 text-sm text-red-900">Refuse it with SERVFAIL and an Extended DNS Error rather than return the forged address.</p>
          </div>
        </div>
      </div>
    </Slide>
  );
}

/* What the employee sees: a browser frame with the real page result. */

import { motion } from "framer-motion";
import type { Lookup } from "../lib/api";

export function BrowserFrame({ who, url, l, tone }: { who: string; url: string; l: Lookup | null; tone: "beta" | "alfa" }) {
  const failed = !!l && (!!l.error || l.answers.length === 0);
  const fake = !!l?.page?.startsWith("FAKE");
  const real = !!l?.page_url?.startsWith("https://");
  const border = !l ? "border-slate-200" : failed ? "border-slate-300" : fake ? "border-red-400" : "border-green-400";
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className={`overflow-hidden rounded-xl border-2 bg-white shadow-md ${border}`}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="h-3 w-3 rounded-full bg-slate-300" /><span className="h-3 w-3 rounded-full bg-slate-300" /><span className="h-3 w-3 rounded-full bg-slate-300" />
        <div className="ml-2 flex-1 truncate rounded-md border border-slate-200 bg-white px-3 py-1 font-mono text-sm text-slate-700">{url}</div>
        <span className={`chip ${tone === "alfa" ? "chip-blue" : "chip-grey"}`}>{who}</span>
      </div>
      <div className="min-h-24 px-5 py-3">
        {!l ? (
          <div className="animate-pulse text-slate-400">Loading...</div>
        ) : failed ? (
          <div>
            <div className="text-lg font-semibold text-slate-700">This site can't be reached</div>
            <div className="mt-1 text-sm text-slate-500">The name did not resolve. Nothing was sent anywhere.</div>
            <div className="mt-2 truncate font-mono text-xs text-slate-400" title={l.ede ?? l.error ?? l.rcode}>{(l.ede ?? l.error ?? l.rcode)?.split(":")[0]}</div>
          </div>
        ) : fake ? (
          <div>
            <div className="text-lg font-semibold text-red-700">Intranet login</div>
            <div className="mt-1 text-sm text-slate-700">Username, password, sign in.</div>
            <div className="mt-2 font-mono text-xs text-red-600">served by {l.answers[0]}, the hotel's server</div>
          </div>
        ) : real ? (
          <div>
            <div className="text-lg font-semibold text-green-800">The real site</div>
            <div className="mt-1 truncate text-sm text-slate-700" title={l.page}>{l.page ?? l.page_error}</div>
            <div className="mt-2 font-mono text-xs text-slate-400">{l.answers[0]} via dns.quad9.net</div>
          </div>
        ) : (
          <div>
            <div className="text-lg font-semibold text-green-800">{l.page?.split(":")[0] ?? "Page"}</div>
            <div className="mt-1 truncate text-sm text-slate-700" title={l.page}>{l.page?.split(":").slice(1).join(":").trim() || l.page_error}</div>
            <div className="mt-2 font-mono text-xs text-slate-400">{l.answers[0]}{l.ad ? ", validated" : ""}</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

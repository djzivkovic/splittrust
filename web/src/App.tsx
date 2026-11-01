import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SCENES, STORY, type Scene } from "./lib/deck";
import { SceneArt } from "./components/SceneArt";
import { BuiltSlide, DeliverySlide, EvidenceSlide } from "./components/Built";
import { LabSlide } from "./components/Lab";
import { ClosingSlide, HowSlide, ProblemSlide, SplitHorizonSlide, TitleSlide } from "./components/Intro";
import { ImpactSlide, RoadmapSlide, SolutionSlide, OwnerRecordSlide, WhyNotSlide } from "./components/Content";
import { AudienceSlide, WhyNowSlide } from "./components/Pitch";
import { Slide } from "./components/Slide";
import { BLUE, Doc, GREEN, INK, Laptop, Lock, Mark, RED, Resolver, Shield } from "./components/Art";
import { Playground } from "./components/Playground";

export default function App() {
  return window.location.pathname.replace(/\/+$/, "") === "/demo" ? <Playground /> : <Presentation />;
}

function Presentation() {
  // the deck, in order
  type Kind = "title" | "split" | "problem" | "whynow" | "how" | "solution" | "scene" | "tryit" | "audience" | "whynot" | "impact" | "built" | "delivery" | "evidence" | "lab" | "roadmap" | "close";
  // Ten-slide pitch; history, detailed architecture and policy stay in the appendix.
  const order: Kind[] = ["title", "split", "problem", "how", ...SCENES.map(() => "scene" as const), "delivery", "evidence", "close",
    "whynow", "built", "lab", "solution", "audience", "whynot", "impact", "tryit", "roadmap"];
  const appendixFrom = order.indexOf("close") + 1;
  const total = order.length;
  const [slide, setSlide] = useState(() => window.location.hash === "#appendix" ? appendixFrom : 0);
  const sceneIndex = (n: number) => n - order.indexOf("scene");
  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(total - 1, n));
    setSlide(next);
    const hash = next >= appendixFrom ? "#appendix" : "";
    if (window.location.hash !== hash) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [total, appendixFrom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(slide + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(slide - 1);
      if (e.key === "Home") go(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slide, go]);

  const kind = order[slide];
  const scene = kind === "scene" ? SCENES[sceneIndex(slide)] : null;
  const content = scene ? <SceneSlide scene={scene} />
    : kind === "split" ? <SplitHorizonSlide /> : kind === "problem" ? <ProblemSlide /> : kind === "whynow" ? <WhyNowSlide /> : kind === "how" ? <HowSlide />
    : kind === "solution" ? <SolutionSlide /> : kind === "tryit" ? <OwnerRecordSlide />
    : kind === "audience" ? <AudienceSlide /> : kind === "whynot" ? <WhyNotSlide /> : kind === "impact" ? <ImpactSlide />
    : kind === "delivery" ? <DeliverySlide /> : kind === "evidence" ? <EvidenceSlide />
    : kind === "built" ? <BuiltSlide /> : kind === "lab" ? <LabSlide /> : kind === "roadmap" ? <RoadmapSlide />
    : kind === "close" ? <ClosingSlide /> : <TitleSlide />;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={slide} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }} className="h-full">
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="flex items-center gap-4 border-t border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">SplitTrust</span>
        <span className={`rounded px-2 py-0.5 font-semibold ${slide >= appendixFrom ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-800"}`}>{slide >= appendixFrom ? "Appendix" : "Main pitch"}</span>
        <span className="ml-auto">{slide < appendixFrom ? slide + 1 : slide - appendixFrom + 1} / {slide < appendixFrom ? appendixFrom : total - appendixFrom}<span className="kbd ml-4">←</span> <span className="kbd">→</span> slides{scene && <><span className="kbd ml-3">space</span> replay illustration</>}</span>
      </footer>
    </div>
  );
}

function SceneSlide({ scene }: { scene: Scene }) {
  const hotel = scene.place === "hotel";
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, button, a, [contenteditable]")) return;
      event.preventDefault();
      setReplay((value) => value + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Slide section={scene.day} title={scene.headline} sub={scene.sub} takeaway={scene.takeaway}
      right={<span className="inline-flex items-center gap-2">
        <span className="rounded bg-slate-200 px-2.5 py-1 text-sm text-slate-600">Illustration</span>
        <button onClick={() => setReplay((value) => value + 1)}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700">Replay illustration</button>
      </span>}>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
        <span className="font-semibold">Same employee, same GitLab bookmark</span>
        <code className="text-blue-800">{STORY.name}</code>
        <span>{scene.id === "real-replay" ? "The copied-claim case" : hotel ? "Hotel Wi-Fi / VPN off" : "Company network / private DNS view"}</span>
      </p>
      {scene.id === "real-replay" ? <Recipe key={replay} /> : <>
        <div className="mt-2 flex min-h-0 flex-1 items-center justify-center">
          <SceneArt key={`${scene.id}-${replay}`} place={scene.place} />
        </div>
        <div className="grid shrink-0 gap-4 pb-2 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-lg font-bold">Trust network DNS</h3>
            <p className="mt-2 text-base text-slate-700">{hotel
              ? "The hotel's answer points at an attacker-controlled IP and the laptop connects to it. What leaks depends on the application: plain-HTTP tools, clients that authenticate automatically to anything internal, scripts that skip certificate checks."
              : "Network DNS returns the private GitLab IP. It works, but that same policy would also accept the hotel's invented answer."}</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="text-lg font-bold">Verify the local exception</h3>
            <p className="mt-2 text-base text-slate-700">{hotel
              ? "An authenticated missing-record response means no grant. The client-side proxy then rejects the bogus GitLab answer on its normal DNS path."
              : `Authenticate the company's permission for ${STORY.scope}, validate the local answer, and retain normal DNS policy for every other name.`}</p>
          </div>
        </div>
        {hotel && <p className="pb-2 text-sm text-slate-500">HTTPS with a valid certificate stops the impersonation, not the connection; the fake login page is shown only in the separate HTTP lab. Reaching the private GitLab still needs office or VPN access: the check stops misdirection, it does not grant access.</p>}
      </>}
    </Slide>
  );
}

function Recipe() {
  const reducedMotion = useReducedMotion();
  const tile = (icon: React.ReactNode, title: string, text: string, index: number) => (
    <motion.div initial={reducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: reducedMotion ? 0 : index * 0.8 }}
      className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-5 text-center shadow-sm">
      <svg viewBox="-64 -56 128 112" className="h-20 w-24 lg:h-24 lg:w-28">{icon}</svg>
      <div className="mt-2 text-xl font-bold lg:text-2xl">{title}</div>
      <p className="mt-3 text-base text-slate-600">{text}</p>
    </motion.div>
  );
  return (
    <div className="mt-5 flex flex-1 flex-col">
      <div className="grid gap-4 md:grid-cols-3 lg:gap-6">
        {tile(<><g transform="translate(0,4) scale(1.6)"><Lock tone={GREEN} /></g><g transform="translate(26,-22)"><Mark ok size={10} /></g></>, "Signed the zone",
          "DNSSEC authenticates the company's public permission records. A token alone is not proof.", 0)}
        {tile(<g transform="scale(1.3)"><Doc tone={BLUE} /></g>, "Published one record",
          `${STORY.officeResolver} is authorized for ${STORY.scope}, not every name on the network.`, 1)}
        {tile(<><g transform="translate(-6,8) scale(0.9)"><Laptop tone={BLUE} /></g><g transform="translate(30,-18)"><Shield /></g></>, "Devices that check",
          "The client-side SplitTrust proxy checks identity and authority. GitLab keeps its own HTTPS protection.", 2)}
      </div>
      <motion.div initial={reducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reducedMotion ? 0 : 3 }}
        className="mt-5 flex items-center gap-6 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
        <svg viewBox="-160 -70 320 140" className="h-32 w-72 shrink-0 lg:h-36 lg:w-80">
          <g transform="translate(-40,0)"><Resolver hostile /></g>
          <text x={-40} y={-48} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK}>claims to be {STORY.officeResolver}</text>
          <text x={-40} y={46} textAnchor="middle" fontSize={12} fill={RED}>certificate: {STORY.hotelResolver}</text>
          <g transform="translate(80,-10)"><Mark ok={false} size={16} /></g>
        </svg>
        <div>
          <div className="text-xl font-bold lg:text-2xl">Copying the claim does not copy the resolver's identity</div>
          <p className="mt-2 text-base text-slate-700">The hotel reuses the company claim but cannot prove <code>{STORY.officeResolver}</code> with a certificate for <code>{STORY.hotelResolver}</code>. The proxy rejects the impersonation before querying that resolver.</p>
          <p className="mt-2 text-sm font-semibold text-blue-800">This is the DNS-over-TLS resolver certificate, not GitLab's HTTPS certificate.</p>
        </div>
      </motion.div>
    </div>
  );
}

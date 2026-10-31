/* Small vector drawings, each centred on (0,0), sized for a 1200 x 520 scene. */

export const INK = "#0f172a";
export const MUTED = "#64748b";
export const LINE = "#cbd5e1";
export const BLUE = "#1d4ed8";
export const GREEN = "#15803d";
export const RED = "#b91c1c";
export const AMBER = "#b45309";

export function Laptop({ tone = INK }: { tone?: string }) {
  return (
    <g>
      <rect x={-46} y={-34} width={92} height={58} rx={6} fill="#fff" stroke={tone} strokeWidth={3} />
      <rect x={-38} y={-26} width={76} height={42} rx={2} fill="#e2e8f0" />
      <rect x={-58} y={24} width={116} height={8} rx={4} fill={tone} />
    </g>
  );
}

export function Phone({ tone = INK }: { tone?: string }) {
  return (
    <g>
      <rect x={-22} y={-40} width={44} height={80} rx={8} fill="#fff" stroke={tone} strokeWidth={3} />
      <rect x={-17} y={-32} width={34} height={58} rx={2} fill="#e2e8f0" />
      <circle cx={0} cy={32} r={3} fill={tone} />
    </g>
  );
}

export function Router({ tone = INK }: { tone?: string }) {
  return (
    <g>
      <rect x={-44} y={6} width={88} height={22} rx={6} fill="#fff" stroke={tone} strokeWidth={3} />
      <circle cx={-28} cy={17} r={3} fill={GREEN} /><circle cx={-18} cy={17} r={3} fill={GREEN} />
      <path d="M -30 -6 A 42 42 0 0 1 30 -6" fill="none" stroke={tone} strokeWidth={3} strokeLinecap="round" />
      <path d="M -18 -20 A 26 26 0 0 1 18 -20" fill="none" stroke={tone} strokeWidth={3} strokeLinecap="round" />
      <circle cx={0} cy={-30} r={3.5} fill={tone} />
    </g>
  );
}

export function Server({ tone = INK, fill = "#fff" }: { tone?: string; fill?: string }) {
  return (
    <g>
      <rect x={-34} y={-38} width={68} height={76} rx={6} fill={fill} stroke={tone} strokeWidth={3} />
      <line x1={-34} y1={-12} x2={34} y2={-12} stroke={tone} strokeWidth={2} />
      <line x1={-34} y1={12} x2={34} y2={12} stroke={tone} strokeWidth={2} />
      <circle cx={22} cy={-25} r={3} fill={GREEN} /><circle cx={22} cy={0} r={3} fill={GREEN} /><circle cx={22} cy={25} r={3} fill={GREEN} />
    </g>
  );
}

export function Resolver({ tone = INK, hostile = false }: { tone?: string; hostile?: boolean }) {
  return (
    <g>
      <rect x={-54} y={-26} width={108} height={52} rx={10} fill="#fff" stroke={tone} strokeWidth={3} />
      <text x={0} y={5} textAnchor="middle" fontSize={14} fontWeight={700} fill={tone}>DNS</text>
      {hostile && <Mask x={40} y={-26} />}
    </g>
  );
}

export function Mask({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M -16 -4 Q 0 -14 16 -4 Q 16 10 0 12 Q -16 10 -16 -4 Z" fill={INK} />
      <ellipse cx={-6} cy={0} rx={4} ry={2.5} fill="#fff" /><ellipse cx={6} cy={0} rx={4} ry={2.5} fill="#fff" />
    </g>
  );
}

/* Roughly 230 x 110, centred; room for two lines of text inside. */
export function Cloud({ tone = INK }: { tone?: string }) {
  return (
    <path d="M -88 40 a 30 30 0 0 1 -12 -56 a 40 40 0 0 1 70 -30 a 44 44 0 0 1 78 6 a 34 34 0 0 1 50 30 a 28 28 0 0 1 -10 50 Z"
      fill="#fff" stroke={tone} strokeWidth={3} strokeLinejoin="round" />
  );
}

export function Lock({ tone = INK, open = false }: { tone?: string; open?: boolean }) {
  return (
    <g>
      <rect x={-14} y={-4} width={28} height={22} rx={4} fill={tone} />
      <path d={open ? "M -8 -4 V -12 A 8 8 0 0 1 8 -14" : "M -8 -4 V -12 A 8 8 0 0 1 8 -12 V -4"} fill="none" stroke={tone} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

export function Shield({ tone = GREEN }: { tone?: string }) {
  return (
    <g>
      <path d="M 0 -22 L 20 -14 V 0 Q 20 16 0 24 Q -20 16 -20 0 V -14 Z" fill={tone} />
      <path d="M -8 0 L -2 6 L 9 -7" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function Doc({ tone = INK }: { tone?: string }) {
  return (
    <g>
      <path d="M -22 -30 H 10 L 22 -18 V 30 H -22 Z" fill="#fff" stroke={tone} strokeWidth={3} strokeLinejoin="round" />
      <path d="M 10 -30 V -18 H 22" fill="none" stroke={tone} strokeWidth={3} strokeLinejoin="round" />
      <line x1={-12} y1={-4} x2={12} y2={-4} stroke={tone} strokeWidth={3} strokeLinecap="round" />
      <line x1={-12} y1={6} x2={12} y2={6} stroke={tone} strokeWidth={3} strokeLinecap="round" />
      <line x1={-12} y1={16} x2={4} y2={16} stroke={tone} strokeWidth={3} strokeLinecap="round" />
    </g>
  );
}

/* A verdict badge: tick or cross in a filled circle. */
export function Mark({ ok, size = 14 }: { ok: boolean; size?: number }) {
  return (
    <g>
      <circle r={size} fill={ok ? GREEN : RED} />
      {ok
        ? <path d={`M ${-size * 0.45} 0 L ${-size * 0.1} ${size * 0.4} L ${size * 0.5} ${-size * 0.4}`} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        : <path d={`M ${-size * 0.4} ${-size * 0.4} L ${size * 0.4} ${size * 0.4} M ${size * 0.4} ${-size * 0.4} L ${-size * 0.4} ${size * 0.4}`} stroke="#fff" strokeWidth={3} strokeLinecap="round" />}
    </g>
  );
}

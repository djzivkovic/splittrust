/* Shared slide chrome: section label, headline, optional sub line, body, optional takeaway. */

export function Slide({ section, title, sub, right, children, takeaway }: {
  section: string; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; takeaway?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col px-6 pt-4 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">{section}</span>
        <h2 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h2>
        {sub && <span className="text-base text-slate-500 lg:text-lg">{sub}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>
      {takeaway && <p className="py-3 text-center text-lg font-medium text-slate-800 lg:text-xl">{takeaway}</p>}
    </div>
  );
}

/* A drawing that scales to the space it is given. */
export function Canvas({ viewBox, label, children }: { viewBox: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <svg viewBox={viewBox} className="h-full w-full select-none" role="img" aria-label={label}>{children}</svg>
    </div>
  );
}

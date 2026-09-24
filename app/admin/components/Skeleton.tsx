/** Shared shimmer block used by the admin loading states. */
export function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-slate-200 rounded animate-pulse ${className}`} />;
}

/** Placeholder matching the shape of a list or table page. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      <Bar className="h-7 w-48 mb-2" />
      <Bar className="h-4 w-72 mb-6" />

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-24" />
            </div>
            <Bar className="h-4 w-40 hidden sm:block" />
            <Bar className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}

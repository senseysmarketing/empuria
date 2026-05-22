export function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`bg-admin-surface-2 animate-pulse rounded-2xl ${className}`} />;
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonBox className="h-10 w-64" />
      <div className="grid grid-cols-12 gap-4">
        <SkeletonBox className="col-span-12 lg:col-span-8 h-56" />
        <SkeletonBox className="col-span-12 lg:col-span-4 h-56" />
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="col-span-12 sm:col-span-6 lg:col-span-3 h-28" />
        ))}
        <SkeletonBox className="col-span-12 lg:col-span-8 h-64" />
        <SkeletonBox className="col-span-12 lg:col-span-4 h-64" />
      </div>
    </div>
  );
}

export function GridSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Array.from({ length: rows * 2 }).map((_, i) => (
        <SkeletonBox key={i} className="h-40" />
      ))}
    </div>
  );
}

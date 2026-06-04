export function SkeletonCard() {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5 overflow-hidden">
      <div className="h-1.5 skeleton rounded-t-[18px] -mt-5 -mx-5 mb-5 w-full" />
      <div className="flex items-center gap-3 mb-4">
        <div className="skeleton w-10 h-10 rounded-[10px] flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
        <div className="skeleton h-6 w-16 rounded-full" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
      <div className="flex gap-2 mb-4">
        <div className="skeleton h-6 w-24 rounded-lg" />
        <div className="skeleton h-6 w-20 rounded-lg" />
      </div>
      <div className="skeleton h-2 w-full rounded-full" />
    </div>
  )
}

export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  const widths = [32, 24, 16, 20, 16, 12]
  return (
    <tr className="border-b border-gray-50">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-3.5 rounded" style={{ width: `${(widths[i % widths.length]) * 4}px` }} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonKPI() {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-5 relative overflow-hidden">
      <div className="skeleton h-1 w-full absolute top-0 left-0 rounded-t-[18px]" />
      <div className="flex items-start justify-between mb-4">
        <div className="skeleton w-10 h-10 rounded-[12px]" />
        <div className="skeleton h-5 w-12 rounded-full" />
      </div>
      <div className="skeleton h-8 w-28 rounded mb-1" />
      <div className="skeleton h-4 w-20 rounded" />
    </div>
  )
}

import { useState, useEffect } from 'react'

export function useAnimatedCounter(target: number, duration = 1200): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (target === 0) { setCount(0); return }
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])

  return count
}

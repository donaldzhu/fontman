import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Options = {
  /** Minimum allowed cell width (px). */
  minCellWidthPx?: number
  /** Grid gap (px). Must match CSS. */
  gapPx?: number
  /** Approx non-text horizontal chrome inside a tile (padding + meta). */
  chromePx?: number
  /**
   * Debounce for sampleText changes only (ms).
   * Font size changes are handled in realtime via rAF throttling.
   */
  textDebounceMs?: number
}

type Result = {
  /** Fixed width of every cell in the grid (px). */
  cellWidthPx: number
  /** Computed number of columns that can fit at the current width (>= 1). */
  columns: number
  /** Global visual scale applied to ALL preview text to "fit" within capped row width (<= 1). */
  fitScale: number
  /** Register a preview element for measurement. Use as a React callback ref. */
  registerPreviewEl: (key: string) => (el: HTMLElement | null) => void
}

// Typeface-like behaviour implemented here:
// 1) Measure each visible preview's natural width (scrollWidth) at the *target* font-size.
// 2) Global cellWidth = max(scrollWidth) + chrome (clamped to container width).
// 3) If capped, compute global fitScale so widest preview fits: fitScale = 1 / maxRatio.
// 4) fitScale is applied via CSS transform on preview text container (does not affect layout).

export function useTypefaceCellSizing(
  containerRef: RefObject<HTMLElement>,
  deps: { sampleText: string; targetFontSizePx: number },
  options: Options = {}
): Result {
  const {
    minCellWidthPx = 320,
    gapPx = 12,
    chromePx = 64,
    textDebounceMs = 80,
  } = options

  // Map of visible tile preview elements. With virtualization this is naturally a subset.
  const previewElsRef = useRef<Map<string, HTMLElement>>(new Map())

  const [cellWidthPx, setCellWidthPx] = useState<number>(minCellWidthPx)
  const [columns, setColumns] = useState<number>(1)
  const [fitScale, setFitScale] = useState<number>(1)

  // rAF-throttle to keep interactive updates smooth (especially while dragging slider).
  const rafPendingRef = useRef<number | null>(null)
  const scheduleMeasure = useCallback(() => {
    if (rafPendingRef.current != null) return
    rafPendingRef.current = requestAnimationFrame(() => {
      rafPendingRef.current = null
      const container = containerRef.current
      if (!container) return

      const containerWidth = container.clientWidth
      if (!containerWidth || containerWidth <= 0) return

      // 1) Measure maximum natural scrollWidth across registered preview elements.
      let maxScrollWidth = 0
      for (const el of previewElsRef.current.values()) {
        // scrollWidth is layout width and is NOT affected by transform: scale().
        const w = el.scrollWidth
        if (w > maxScrollWidth) maxScrollWidth = w
      }

      // If nothing is registered yet, keep a sensible default.
      if (maxScrollWidth <= 0) {
        const cw = Math.min(Math.max(minCellWidthPx, 0), containerWidth)
        setCellWidthPx(cw)
        setColumns(1)
        setFitScale(1)
        return
      }

      // 2) Choose global cell width based on the largest preview.
      const desiredCellWidth = Math.max(minCellWidthPx, Math.ceil(maxScrollWidth + chromePx))
      const cappedCellWidth = Math.min(desiredCellWidth, containerWidth)

      // 3) Determine how many columns can fit.
      const cols = Math.max(1, Math.floor((containerWidth + gapPx) / (cappedCellWidth + gapPx)))

      // 4) Compute global fitScale only when overflow exists.
      const textRegionWidth = Math.max(1, cappedCellWidth - chromePx)
      let maxRatio = 1
      for (const el of previewElsRef.current.values()) {
        const ratio = el.scrollWidth / textRegionWidth
        if (ratio > maxRatio) maxRatio = ratio
      }
      const nextFitScale = maxRatio > 1 ? 1 / maxRatio : 1

      setCellWidthPx(cappedCellWidth)
      setColumns(cols)
      setFitScale(nextFitScale)
    })
  }, [containerRef, chromePx, gapPx, minCellWidthPx])

  // Register callback ref for preview elements.
  const registerPreviewEl = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      const map = previewElsRef.current
      if (!el) {
        map.delete(key)
      } else {
        map.set(key, el)
      }
      // As tiles mount/unmount (virtualization), re-measure promptly.
      scheduleMeasure()
    },
    [scheduleMeasure]
  )

  // Resize observer: recalc on container width changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const ro = new ResizeObserver(() => {
      scheduleMeasure()
    })
    ro.observe(container)

    scheduleMeasure()

    return () => {
      if (rafPendingRef.current != null) {
        cancelAnimationFrame(rafPendingRef.current)
        rafPendingRef.current = null
      }
      ro.disconnect()
    }
  }, [containerRef, scheduleMeasure])

  // Font size changes should update in realtime while dragging.
  useEffect(() => {
    // Wait one paint so DOM reflects new font-size, then measure.
    scheduleMeasure()
  }, [deps.targetFontSizePx, scheduleMeasure])

  // Sample text changes can be slightly debounced (typing).
  useEffect(() => {
    const t = window.setTimeout(() => {
      scheduleMeasure()
    }, textDebounceMs)
    return () => window.clearTimeout(t)
  }, [deps.sampleText, textDebounceMs, scheduleMeasure])

  const safeFitScale = useMemo(() => {
    if (!Number.isFinite(fitScale)) return 1
    return Math.max(0.05, Math.min(1, fitScale))
  }, [fitScale])

  return { cellWidthPx, columns, fitScale: safeFitScale, registerPreviewEl }
}

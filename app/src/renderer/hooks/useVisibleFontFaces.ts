import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

type FontFaceSpec = {
  id: string
  family: string
  sourceUrl: string
  weight?: string
  style?: string
}

type FamilyFontItem = {
  id: string
  previewFont?: FontFaceSpec
}

const MAX_CACHED_FONTS = 48
const OBSERVER_ROOT_MARGIN = '300px'

export const useVisibleFontFaces = (
  families: FamilyFontItem[],
  rootRef: RefObject<HTMLElement>,
) => {
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map())
  const visibleIdsRef = useRef<Set<string>>(new Set())
  const fontCacheRef = useRef<Map<string, FontFace>>(new Map())
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  const lruRef = useRef<string[]>([])
  const observerRef = useRef<IntersectionObserver | null>(null)
  const [visibleTick, setVisibleTick] = useState(0)

  const registerTileEl = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      const map = elementsRef.current
      if (el) {
        el.setAttribute('data-family-id', id)
        map.set(id, el)
        observerRef.current?.observe(el)
      } else {
        const existing = map.get(id)
        if (existing) {
          observerRef.current?.unobserve(existing)
        }
        map.delete(id)
      }
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !('FontFace' in window) || !rootRef.current) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let didChange = false
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-family-id')
          if (!id) continue
          if (entry.isIntersecting) {
            if (!visibleIdsRef.current.has(id)) {
              visibleIdsRef.current.add(id)
              didChange = true
            }
          } else {
            if (visibleIdsRef.current.delete(id)) {
              didChange = true
            }
          }
        }
        if (didChange) {
          setVisibleTick((value) => value + 1)
        }
      },
      { root: rootRef.current, rootMargin: OBSERVER_ROOT_MARGIN },
    )

    observerRef.current = observer
    for (const [id, el] of elementsRef.current.entries()) {
      el.setAttribute('data-family-id', id)
      observer.observe(el)
    }

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [rootRef])

  useEffect(() => {
    if (typeof window === 'undefined' || !('FontFace' in window)) {
      return
    }

    const visibleFonts = families
      .filter((item) => visibleIdsRef.current.has(item.id))
      .map((item) => item.previewFont)
      .filter((item): item is FontFaceSpec => Boolean(item))

    const markUsed = (id: string) => {
      const existing = lruRef.current.filter((entry) => entry !== id)
      existing.push(id)
      lruRef.current = existing
    }

    const ensureLoaded = (spec: FontFaceSpec) => {
      if (fontCacheRef.current.has(spec.id)) {
        markUsed(spec.id)
        return
      }
      if (inFlightRef.current.has(spec.id)) {
        return
      }
      const fontFace = new FontFace(
        spec.family,
        `url("${spec.sourceUrl}")`,
        spec.weight || spec.style ? { weight: spec.weight, style: spec.style } : undefined,
      )
      const loadPromise = fontFace
        .load()
        .then(() => {
          document.fonts.add(fontFace)
          fontCacheRef.current.set(spec.id, fontFace)
          markUsed(spec.id)
        })
        .finally(() => {
          inFlightRef.current.delete(spec.id)
        })
      inFlightRef.current.set(spec.id, loadPromise)
    }

    for (const spec of visibleFonts) {
      ensureLoaded(spec)
    }

    if (fontCacheRef.current.size <= MAX_CACHED_FONTS) {
      return
    }

    const visibleIds = new Set(visibleFonts.map((spec) => spec.id))
    while (fontCacheRef.current.size > MAX_CACHED_FONTS && lruRef.current.length > 0) {
      const oldest = lruRef.current.shift()
      if (!oldest || visibleIds.has(oldest)) {
        continue
      }
      const fontFace = fontCacheRef.current.get(oldest)
      if (fontFace) {
        document.fonts.delete(fontFace)
        fontCacheRef.current.delete(oldest)
      }
    }
  }, [families, visibleTick])

  return { registerTileEl }
}

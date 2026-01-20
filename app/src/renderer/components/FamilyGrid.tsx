import React, { useMemo, useRef, useState } from 'react'
import { useTypefaceCellSizing } from '../hooks/useTypefaceCellSizing'
import FamilyTile, { FamilyGridItem } from './FamilyTile'

type Props = {
  families: FamilyGridItem[]
  sampleText: string
  targetFontSizePx: number
}

export default function FamilyGrid({ families, sampleText, targetFontSizePx }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)

  // chromePx should approximate: padding + room for meta.
  const sizing = useTypefaceCellSizing(
    containerRef,
    { sampleText, targetFontSizePx },
    {
      minCellWidthPx: 320,
      gapPx: 12,
      chromePx: 64,
      textDebounceMs: 90, // typing debounce only
    }
  )

  const selectedFamily = useMemo(() => {
    if (!selected) return null
    return families.find((f) => f.id === selected) ?? null
  }, [families, selected])

  return (
    <div className="familyGridLayout">
      <div
        className="familyGrid"
        ref={containerRef}
        style={{ ['--cell-w' as any]: `${sizing.cellWidthPx}px` }}
      >
        {families.map((item) => (
          <FamilyTile
            key={item.id}
            item={item}
            sampleText={sampleText}
            targetFontSizePx={targetFontSizePx}
            fitScale={sizing.fitScale}
            registerPreviewEl={sizing.registerPreviewEl}
            onSelect={setSelected}
          />
        ))}
      </div>

      <aside className="familyInspector">
        <h3 className="familyInspector__title">Inspector</h3>
        {selectedFamily ? (
          <div className="familyInspector__body">
            <div className="familyInspector__row">
              <span className="familyInspector__label">Family</span>
              <span className="familyInspector__value">{selectedFamily.familyName}</span>
            </div>
            <div className="familyInspector__row">
              <span className="familyInspector__label">Faces</span>
              <span className="familyInspector__value">{selectedFamily.faceCount}</span>
            </div>
            <div className="familyInspector__row">
              <span className="familyInspector__label">Activation</span>
              <span className="familyInspector__value">{selectedFamily.activation}</span>
            </div>
            <div className="familyInspector__hint">
              This inspector is a placeholder. In your app, populate this with the face list for the selected family.
            </div>
          </div>
        ) : (
          <div className="familyInspector__empty">Select a family tile…</div>
        )}
      </aside>
    </div>
  )
}

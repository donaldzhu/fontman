import React from 'react'

export type ActivationState = 'inactive' | 'partial' | 'active'

export type FamilyGridItem = {
  id: string
  familyName: string
  faceCount: number
  /** CSS font-family name to use for preview. (In your app this should match loaded faces.) */
  cssFontFamily: string
  activation: ActivationState
}

type Props = {
  item: FamilyGridItem
  sampleText: string
  targetFontSizePx: number
  fitScale: number
  registerPreviewEl: (key: string) => (el: HTMLElement | null) => void
  onSelect?: (familyId: string) => void
}

function activationLabel(state: ActivationState): string {
  switch (state) {
    case 'active':
      return 'Activated'
    case 'partial':
      return 'Partially activated'
    default:
      return 'Not activated'
  }
}

export default function FamilyTile({
  item,
  sampleText,
  targetFontSizePx,
  fitScale,
  registerPreviewEl,
  onSelect,
}: Props) {
  return (
    <button
      type="button"
      className="familyTile"
      onClick={() => onSelect?.(item.id)}
      title={`${item.familyName} — ${item.faceCount} faces`}
    >
      <div className="familyTile__top">
        <div className="familyTile__nameRow">
          <span
            className={`familyTile__activationDot familyTile__activationDot--${item.activation}`}
            aria-label={activationLabel(item.activation)}
            title={activationLabel(item.activation)}
          />
          <span className="familyTile__familyName">{item.familyName}</span>
        </div>
        <span className="familyTile__faceCount">{item.faceCount}</span>
      </div>

      <div className="familyTile__previewClip">
        <div
          className="familyTile__preview"
          style={{
            fontFamily: item.cssFontFamily,
            fontSize: `${targetFontSizePx}px`,
            transform: `scale(${fitScale})`,
          }}
        >
          {/*
            IMPORTANT:
            - We measure scrollWidth on this span via registerPreviewEl.
            - scrollWidth is NOT affected by transform: scale(), which is exactly what we want.
          */}
          <span
            ref={registerPreviewEl(item.id)}
            className="familyTile__previewText"
          >
            {sampleText || ' '}
          </span>
        </div>
      </div>
    </button>
  )
}

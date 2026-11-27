import card from "../../home-art/draw.webp";

// The original pen strokes stay in the card asset. Key the blue ink away
// from the beige fabric so the same drawing can be printed onto another patch.
export const songbird = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="17 157 317 293" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="draw-songbird-crop"><rect x="20" y="166" width="311" height="280"/></clipPath>
    <filter id="draw-songbird-ink" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="
        0 0 0 0 .13
        0 0 0 0 .09
        0 0 0 0 .35
        -3.8 0 3.1 0 .59" />
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter>
  </defs>
  <image width="355" height="640" href="${card}" filter="url(#draw-songbird-ink)" clip-path="url(#draw-songbird-crop)" />
</svg>`;

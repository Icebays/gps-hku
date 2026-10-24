/* Category icons, so a place's kind reads at a glance and not by colour alone (white glyph on the category's colour),
   and the MTR mark for the MTR exits. Inline SVG, 24 x 24 view box. */
const GLYPH = {
  // star
  landmark: '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z"/>',
  // mortarboard
  academic: '<path d="M12 4.5L1.8 9.3 12 14.1l7.8-3.7v5.1h1.9V9.3zM5.7 12.6v3.3c1.5 1.5 3.8 2.5 6.3 2.5s4.8-1 6.3-2.5v-3.3L12 15.6z"/>',
  // open book
  library: '<path d="M3.5 5.7C5.6 4.7 8.6 4.8 11 6.3v12.9c-2.4-1.4-5.4-1.5-7.5-.6zM20.5 5.7c-2.1-1-5.1-.9-7.5.6v12.9c2.4-1.4 5.4-1.5 7.5-.6z"/>',
  // columns
  culture: '<path d="M12 3L3 7.3v1.6h18V7.3zM5 10.3h2.3v6.9H5zm5.85 0h2.3v6.9h-2.3zm5.85 0H19v6.9h-2.3zM3 18.4h18v2.4H3z"/>',
  // cup
  amenity: '<path d="M4.5 7.5h11v5.3a5 5 0 01-5 5h-1a5 5 0 01-5-5zM15.5 9h1.3a2.6 2.6 0 010 5.2h-1.3v-1.7h1.3a.9.9 0 000-1.8h-1.3zM4.5 19h11v1.8h-11z"/>',
  // bed
  hall: '<path d="M2.8 6h2v7.2H11V8.6h7.2A2.8 2.8 0 0121 11.4V19h-2v-2.4H4.8V19h-2zM8 12.4a2 2 0 100-4 2 2 0 000 4z"/>',
  // bus
  transport: '<path d="M6.5 3h11A2.5 2.5 0 0120 5.5v10.3a2 2 0 01-1 1.7V20h-2.4v-1.6H7.4V20H5v-2.5a2 2 0 01-1-1.7V5.5A2.5 2.5 0 016.5 3zM6 6.2v4.7h12V6.2zm1.6 7.1a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6zm8.8 0a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z"/>',
  other: '<circle cx="12" cy="12" r="4.2"/>',
};
// the MTR mark: two arcs bowing towards a vertical bar (white on MTR red)
const MTR_MARK = '<path d="M5.2 4.6Q12 11.4 18.8 4.6M5.2 19.4Q12 12.6 18.8 19.4M12 3.2v17.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
export const MTR_RED = '#e2231a';

export function catIcon(cat, color) {
  return `<svg class="ico" viewBox="0 0 24 24" style="background:${color}" aria-hidden="true">${GLYPH[cat] || GLYPH.other}</svg>`;
}
// a place's icon: the MTR mark for MTR exits, else its category's
export function placeIcon(p, cats) {
  if (p.icon === 'mtr') return `<svg class="ico" viewBox="0 0 24 24" style="background:${MTR_RED}" aria-hidden="true">${MTR_MARK}</svg>`;
  return catIcon(p.cat, cats[p.cat]?.color);
}

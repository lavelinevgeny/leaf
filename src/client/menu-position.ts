export interface MenuBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface MenuPlacement {
  top: number;
  left: number;
  side: 'below' | 'above';
}
const gap = 4;
const margin = 8;
// Right-aligned to the trigger, below by default, flipped above when the
// lower edge would leave the viewport, and always clamped inside it.
export function placeMenu(
  trigger: MenuBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const left = Math.min(Math.max(trigger.right - size.width, margin), maxLeft);
  const below = trigger.bottom + gap;
  const above = trigger.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const roomBelow = viewport.height - trigger.bottom;
  const side =
    fitsBelow || (!fitsAbove && roomBelow >= trigger.top) ? 'below' : 'above';
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  const top = Math.min(
    Math.max(side === 'below' ? below : above, margin),
    maxTop,
  );
  return { top, left, side };
}

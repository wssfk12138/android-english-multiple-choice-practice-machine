export type SwipeStart = { x: number; y: number; at: number; orientation: string }
export function swipeStep(start: SwipeStart, x: number, y: number, at: number, orientation: string): number {
  const dx=x-start.x, dy=y-start.y
  if (orientation !== start.orientation || at-start.at > 650 || at-start.at < 30 || Math.abs(dx)<64 || Math.abs(dx)<=Math.abs(dy)*1.5) return 0
  return dx < 0 ? 1 : -1
}

/**
 * Input layer: keyboard, mouse-drag, wheel, and gamepad. Rendering/camera code
 * reads from this; nothing here knows about the sim. Full rebinding UI is
 * Phase 9 (§17); Phase 0 exposes raw KeyboardEvent codes.
 */

export class Input {
  private held = new Set<string>()
  private pressedSinceLastFrame = new Set<string>()
  private dragging = false
  private mouseDX = 0
  private mouseDY = 0
  private wheelDelta = 0

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressedSinceLastFrame.add(e.code)
      this.held.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.held.delete(e.code))
    window.addEventListener('blur', () => {
      this.held.clear()
      this.dragging = false
    })

    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.dragging = true
    })
    window.addEventListener('mouseup', () => (this.dragging = false))
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.mouseDX += e.movementX
        this.mouseDY += e.movementY
      }
    })
    target.addEventListener('wheel', (e) => (this.wheelDelta += e.deltaY), {
      passive: true,
    })
  }

  isHeld(code: string): boolean {
    return this.held.has(code)
  }

  /** True once per physical key press, cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressedSinceLastFrame.has(code)
  }

  /** -1 | 0 | +1 from a pair of keys. */
  axis(positive: string, negative: string): number {
    return (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0)
  }

  /** Mouse drag delta since last call; consuming resets it. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY }
    this.mouseDX = 0
    this.mouseDY = 0
    return d
  }

  /** Wheel delta since last call; consuming resets it. */
  consumeWheel(): number {
    const w = this.wheelDelta
    this.wheelDelta = 0
    return w
  }

  /** First connected gamepad, if any (polled per frame per Gamepad API). */
  gamepad(): Gamepad | null {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (pad) return pad
    }
    return null
  }

  /** Call once at the end of every rendered frame. */
  endFrame(): void {
    this.pressedSinceLastFrame.clear()
  }
}

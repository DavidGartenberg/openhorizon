/**
 * Input layer: keyboard, mouse-drag, wheel, and gamepad. Rendering/camera code
 * reads from this; nothing here knows about the sim. Full rebinding UI is
 * Phase 9 (§17); Phase 0 exposes raw KeyboardEvent codes.
 */

export class Input {
  /** When false (e.g. a text box has focus), key events are ignored. */
  enabled = true
  private held = new Set<string>()
  private pressedSinceLastFrame = new Set<string>()
  private dragging = false
  private mouseDX = 0
  private mouseDY = 0
  private wheelDelta = 0
  /** Raw pointer position in target-element-local pixels (for 3D-panel
   *  raycasting — the cockpit click/drag system, Phase 3 Task 2d). Updated
   *  on every mousemove regardless of drag state, unlike mouseDX/mouseDY
   *  above which only accumulate while dragging (camera-look use case). */
  private ptrX = 0
  private ptrY = 0
  private mouseDownSinceLastFrame = false
  private mouseUpSinceLastFrame = false

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return
      if (!e.repeat) this.pressedSinceLastFrame.add(e.code)
      this.held.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.held.delete(e.code))
    window.addEventListener('blur', () => {
      this.held.clear()
      this.dragging = false
    })

    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.dragging = true
        this.mouseDownSinceLastFrame = true
      }
    })
    window.addEventListener('mouseup', () => {
      if (this.dragging) this.mouseUpSinceLastFrame = true
      this.dragging = false
    })
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.mouseDX += e.movementX
        this.mouseDY += e.movementY
      }
      const rect = target.getBoundingClientRect()
      this.ptrX = e.clientX - rect.left
      this.ptrY = e.clientY - rect.top
    })
    target.addEventListener('wheel', (e) => (this.wheelDelta += e.deltaY), {
      passive: true,
    })
  }

  private virtualHeld = new Set<string>()

  isHeld(code: string): boolean {
    return this.held.has(code) || this.virtualHeld.has(code)
  }

  /** True once per physical key press, cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressedSinceLastFrame.has(code)
  }

  /** Gamepad button → key alias (16a-b): a mapped button edge injects a
   *  one-frame press of its key code so every existing discrete-key
   *  handler (gear, flaps, spoilers, ATC panel, menu, camera, pause…)
   *  serves the stick without a second action table. */
  injectPress(code: string): void {
    this.pressedSinceLastFrame.add(code)
  }

  /** Held-type alias (brakes, throttle nudges): mirrors a button's held
   *  state into isHeld()/axis(). */
  setVirtualHeld(code: string, held: boolean): void {
    if (held) this.virtualHeld.add(code)
    else this.virtualHeld.delete(code)
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

  /** Pointer position in target-element-local pixels — for raycasting
   *  against 3D panel meshes (cockpit click/drag). */
  pointerPixels(): { x: number; y: number } {
    return { x: this.ptrX, y: this.ptrY }
  }

  /** Target element's current pixel size, for NDC conversion alongside
   *  `pointerPixels()`. */
  targetSize(): { w: number; h: number } {
    const rect = this.target.getBoundingClientRect()
    return { w: rect.width, h: rect.height }
  }

  /** True the one frame the left mouse button went down. */
  wasMousePressed(): boolean {
    return this.mouseDownSinceLastFrame
  }

  /** True the one frame the left mouse button was released. */
  wasMouseReleased(): boolean {
    return this.mouseUpSinceLastFrame
  }

  /** True while the left mouse button is held. */
  isMouseDown(): boolean {
    return this.dragging
  }

  /** Call once at the end of every rendered frame. */
  endFrame(): void {
    this.pressedSinceLastFrame.clear()
    this.mouseDownSinceLastFrame = false
    this.mouseUpSinceLastFrame = false
  }
}

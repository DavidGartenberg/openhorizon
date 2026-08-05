/**
 * Metronome worker (15e): page timers in hidden tabs get intensively
 * throttled (~1 wake/min after 5 min) which froze the sim whenever the
 * tab wasn't visible — worker clocks are exempt, so this thread ticks
 * the main thread's idle-stepper instead. Found running the standalone
 * 45-min soak.
 */
setInterval(() => {
  ;(self as unknown as Worker).postMessage(0)
}, 500)

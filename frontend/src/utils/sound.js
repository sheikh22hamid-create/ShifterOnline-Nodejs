// High-quality synthesized chimes using Web Audio API (0 external assets needed)

let audioCtx = null

function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      audioCtx = new AudioCtx()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export function playOrderChime() {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(587.33, now) // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12) // A5
    osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28) // D6

    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.65)
  } catch {
    // Audio autostart restricted or unavailable
  }
}

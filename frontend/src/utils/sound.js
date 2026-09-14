// Resilient, multi-harmonic synthesized order ring bell with auto-unlocking AudioContext

let audioCtx = null
let isUnlocked = false

function initAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      audioCtx = new AudioCtx()
    }
  }
  return audioCtx
}

// Auto-unlock AudioContext on the earliest user interaction
function setupAudioUnlock() {
  if (typeof window === 'undefined' || isUnlocked) return

  const unlock = () => {
    const ctx = initAudioContext()
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => {
        isUnlocked = true
      }).catch(() => {})
    } else if (ctx && ctx.state === 'running') {
      isUnlocked = true
    }
    window.removeEventListener('click', unlock, true)
    window.removeEventListener('touchstart', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }

  window.addEventListener('click', unlock, true)
  window.addEventListener('touchstart', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

setupAudioUnlock()

function playTone(ctx, freq, startTime, duration, maxGain = 0.5) {
  try {
    const osc = ctx.createOscillator()
    const harmonic = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, startTime)

    // Secondary subtle overtone for bell-like brilliance
    harmonic.type = 'triangle'
    harmonic.frequency.setValueAtTime(freq * 2, startTime)

    gain.gain.setValueAtTime(0.001, startTime)
    gain.gain.linearRampToValueAtTime(maxGain, startTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

    osc.connect(gain)
    harmonic.connect(gain)
    gain.connect(ctx.destination)

    osc.start(startTime)
    harmonic.start(startTime)
    osc.stop(startTime + duration)
    harmonic.stop(startTime + duration)
  } catch {
    // Tone play error suppressed
  }
}

/**
 * Plays a loud, crisp double "Ding-Dong, Ding-Dong" order notification chime.
 * Works seamlessly across Chrome, Edge, Safari, Firefox, iOS, and Android.
 */
export function playOrderChime() {
  try {
    const ctx = initAudioContext()
    if (!ctx) return

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    const t = ctx.currentTime + 0.05

    // First Ding-Dong (High ➔ Mid)
    playTone(ctx, 987.77, t + 0.00, 0.35, 0.6) // B5
    playTone(ctx, 783.99, t + 0.22, 0.45, 0.7) // G5

    // Second Ding-Dong (Higher Accent ➔ Resolution)
    playTone(ctx, 1174.66, t + 0.60, 0.35, 0.65) // D6
    playTone(ctx, 880.00, t + 0.82, 0.65, 0.8) // A5
  } catch {
    // Browser audio fallback
  }
}

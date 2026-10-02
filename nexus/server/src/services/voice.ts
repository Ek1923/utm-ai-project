import { spawn } from 'child_process';

// Change this to switch JARVIS's voice.
// Male British: bm_george, bm_lewis
// Male American: am_adam, am_michael
// Female British: bf_emma, bf_isabella
// Female American: af_bella, af_nicole, af_sky, af_sarah
const JARVIS_VOICE = 'bm_george';

const voiceCache = new Map<string, Buffer>();

export async function generateSpeech(text: string, speed = 1.0, voice = JARVIS_VOICE): Promise<Buffer> {
  const cacheKey = `${voice}:${speed}:${text}`;
  if (voiceCache.has(cacheKey)) {
    return voiceCache.get(cacheKey)!;
  }

  return new Promise((resolve, reject) => {
    const safeText = text.replace(/"""/g, "'''").replace(/\\/g, '\\\\');
    const pythonScript = `
import sys
try:
    from kokoro import synthesize
    text = """${safeText}"""
    audio = synthesize(text, voice="${voice}", speed=${speed})
    sys.stdout.buffer.write(audio.tobytes())
except TypeError:
    # Older kokoro version without voice param — fall back to default
    from kokoro import synthesize as syn
    audio = syn(text, speed=${speed})
    sys.stdout.buffer.write(audio.tobytes())
except ImportError:
    sys.stderr.write("kokoro-tts not installed. Run: pip install kokoro-tts\\n")
    sys.exit(1)
`;

    const proc = spawn('python', ['-c', pythonScript]);
    const chunks: Buffer[] = [];

    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.stderr.on('data', err => console.error('[VOICE]', err.toString().trim()));
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        const buffer = Buffer.concat(chunks);
        if (voiceCache.size >= 20) {
          const firstKey = voiceCache.keys().next().value;
          if (firstKey) voiceCache.delete(firstKey);
        }
        voiceCache.set(cacheKey, buffer);
        resolve(buffer);
      } else {
        reject(new Error(`Voice synthesis failed (exit ${code})`));
      }
    });
  });
}

export { JARVIS_VOICE };

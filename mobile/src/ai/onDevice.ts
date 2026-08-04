/**
 * On-device language model access (Apple Foundation Models).
 *
 * HARD ARCHITECTURAL RULE — read before extending this module:
 *
 *   The language model is DISPLAY-ONLY. It reads the verification engine's
 *   output and turns it into English. It must never feed back into scoring,
 *   thresholds, payout amounts, or any decision that moves money.
 *
 * Why the rule is absolute: a rubric can be audited. We can tell an insurer
 * "this threshold rejects 0.3% of honest rides, here is the validation set."
 * That sentence is impossible about a generative model. The first time an
 * LLM denies a rider their earnings for a reason nobody can reproduce, the
 * product is finished. Statistical classifiers with measured error rates may
 * judge a ride; language models may only narrate one.
 *
 * PRIVACY: Apple Foundation Models run entirely on-device. iOS 26 also
 * offers Private Cloud Compute routing — we deliberately do NOT opt into
 * it. Nothing here may ever be routed off the phone, and callers must pass
 * only DERIVED aggregates (distance, duration, flags), never raw geo or
 * motion samples. The privacy contract in verification/types.ts applies to
 * this module in full.
 *
 * AVAILABILITY: text generation needs iOS 26+ on Apple Intelligence
 * hardware (iPhone 15 Pro and newer). That is a minority of devices, so
 * every caller MUST have a hand-written fallback and treat the model as a
 * bonus. The app is fully functional with no model at all.
 */

declare const require: (m: string) => any;

let appleProvider: any = null;
let aiSdk: any = null;
try {
  appleProvider = require('@react-native-ai/apple')?.apple ?? null;
  aiSdk = require('ai') ?? null;
  if (typeof aiSdk?.generateText !== 'function') aiSdk = null;
} catch {
  appleProvider = null;
  aiSdk = null;
}

/**
 * Generation must never make a rider wait. If the model is slow we drop it
 * and show the deterministic copy instead — the fallback is always good
 * enough to ship on its own.
 */
const GENERATION_TIMEOUT_MS = 4000;

/** Cheap synchronous check: are the native pieces present at all? */
export function onDeviceModelPresent(): boolean {
  return !!appleProvider && !!aiSdk;
}

let _availability: boolean | null = null;

/**
 * Whether this device can actually generate text. Cached after the first
 * probe: the answer cannot change within a session, and re-probing on every
 * ride would be wasteful.
 *
 * Returns false on simulators, pre-iOS-26, non-Apple-Intelligence hardware,
 * and when the user has Apple Intelligence turned off. None of those are
 * error states — they are the common case.
 */
export async function onDeviceModelAvailable(): Promise<boolean> {
  if (_availability !== null) return _availability;
  if (!onDeviceModelPresent()) {
    _availability = false;
    return false;
  }
  try {
    // No stable capability API across versions, so we probe with the
    // cheapest possible generation rather than trusting a version check.
    const out: GenerateTextResult = await withTimeout(
      aiSdk.generateText({ model: appleProvider(), prompt: 'ok' }),
      GENERATION_TIMEOUT_MS,
    );
    _availability = typeof out?.text === 'string';
  } catch {
    _availability = false;
  }
  return _availability;
}

/** Shape we rely on from the AI SDK. Declared locally so this module keeps
 *  type-checking whether or not the optional packages are installed. */
interface GenerateTextResult {
  text?: unknown;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('on-device generation timed out')), ms),
    ),
  ]);
}

/**
 * Strip anything that looks like coordinates before it reaches the model.
 *
 * Belt and braces: callers are already required to pass derived aggregates
 * only, and the model is on-device anyway. But this module is exactly the
 * kind of place a future change quietly starts interpolating a route into a
 * prompt, so the guard is here rather than in a code review that might not
 * happen.
 */
function assertNoCoordinates(prompt: string): void {
  // Two signed decimals with 4+ places, near each other = a lat/lon pair.
  const coordPair = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/;
  if (coordPair.test(prompt)) {
    throw new Error('refusing to send coordinate-shaped data to the model');
  }
}

export interface GenerateOptions {
  /** Soft cap; the prompt also states it. Small models overshoot — callers
   *  should treat this as guidance and truncate defensively. */
  maxWords?: number;
}

/**
 * Generate a short piece of display copy, or null if anything at all goes
 * wrong. Null is a completely normal return value: it means "use the
 * deterministic text", which is always available.
 */
export async function generateLine(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string | null> {
  if (!(await onDeviceModelAvailable())) return null;
  try {
    assertNoCoordinates(prompt);
    const maxWords = opts.maxWords ?? 40;
    const out: GenerateTextResult = await withTimeout(
      aiSdk.generateText({
        model: appleProvider(),
        prompt: `${prompt}\n\nAnswer in at most ${maxWords} words. Plain sentences, no lists, no headings, no emoji.`,
      }),
      GENERATION_TIMEOUT_MS,
    );
    const text = typeof out?.text === 'string' ? out.text.trim() : '';
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

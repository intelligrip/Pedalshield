/**
 * Turn a verification result into something a rider can actually read.
 *
 * DIRECTION OF DATA IS ONE-WAY: this module consumes a
 * `RideVerificationResult` that the engine has already produced and returns
 * display text. Nothing here is an input to scoring. See onDevice.ts for why
 * that boundary is not negotiable.
 *
 * Two layers:
 *   1. `explainVerdict()` — deterministic, instant, always available. This
 *      is what most riders see, because most devices cannot run the model.
 *   2. `polishExplanation()` — optional. If the device has Apple
 *      Intelligence, rewrite layer 1 into something warmer. It is given the
 *      deterministic text as its source material and asked only to rephrase,
 *      so it cannot invent a reason the engine never found.
 */

import type { RideVerificationResult } from '../verification/types.ts';
import { FLAG_COPY, STATUS_COPY } from './verdictCopy.ts';
import { generateLine } from './onDevice.ts';

export interface VerdictExplanation {
  title: string;
  /** One or two sentences on the outcome. */
  summary: string;
  /** Ordered reasons, most severe first. Empty on a clean verified ride. */
  reasons: { what: string; why: string; fix: string | null }[];
  /** True when the rider can improve future scores by changing something. */
  hasActionableFix: boolean;
}

/**
 * Build the explanation. Pure, synchronous, dependency-free — safe to call
 * during render and trivially testable.
 *
 * Hard flags are listed before soft ones: if a ride was rejected outright,
 * the reason that zeroed it belongs at the top, not buried under advice
 * about phone placement.
 */
export function explainVerdict(result: RideVerificationResult): VerdictExplanation {
  const status = STATUS_COPY[result.status];

  const ordered = [...result.flags].sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'hard' ? -1 : 1;
  });

  const reasons = ordered
    .map((f) => FLAG_COPY[f.code])
    .filter((c): c is (typeof FLAG_COPY)[keyof typeof FLAG_COPY] => !!c)
    .map((c) => ({ what: c.what, why: c.why, fix: c.fix }));

  return {
    title: status.title,
    summary: status.body,
    reasons,
    hasActionableFix: reasons.some((r) => r.fix !== null),
  };
}

/**
 * Optionally rewrite the explanation with the on-device model.
 *
 * Returns null when unavailable, which is the common case and not an error —
 * callers render `explainVerdict()` directly and treat this as an upgrade.
 *
 * The prompt carries ONLY the deterministic copy plus the score. No route,
 * no coordinates, no timestamps, no sensor samples. The model is explicitly
 * instructed to rephrase rather than explain, so it cannot manufacture a
 * cause the engine did not actually detect — the failure mode that would
 * make this feature worse than no feature.
 */
export async function polishExplanation(
  explanation: VerdictExplanation,
  integrityScore: number,
): Promise<string | null> {
  const facts = [
    `Outcome: ${explanation.title}.`,
    `Summary: ${explanation.summary}`,
    ...explanation.reasons.map(
      (r, i) => `Reason ${i + 1}: ${r.what} ${r.why}${r.fix ? ` ${r.fix}` : ''}`,
    ),
    `Integrity score: ${integrityScore.toFixed(2)} out of 1.`,
  ].join('\n');

  return generateLine(
    [
      'You are explaining a bicycle ride verification result to the cyclist who rode it.',
      'Rewrite the facts below as two or three warm, plain sentences.',
      'Do not add any reason that is not listed. Do not speculate about cheating.',
      'Do not mention the numeric score. Never suggest the rider was dishonest.',
      '',
      facts,
    ].join('\n'),
    { maxWords: 60 },
  );
}

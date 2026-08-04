/**
 * Explains a verification result to the rider who just rode.
 *
 * REPLACES: a list of raw flag codes ("· sensor incoherent"). That told a
 * rider nothing except that a machine had judged them and they'd been paid
 * less. Two of the founder's own genuine rides were rejected in July, and it
 * took reading the engine source to understand why — riders will never have
 * that option.
 *
 * The deterministic copy in ai/verdictCopy.ts is the real feature and always
 * renders. If the device happens to have Apple Intelligence, the summary is
 * rewritten into something warmer; that's a bonus, not a dependency, and the
 * model is explicitly forbidden from inventing reasons the engine didn't find.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { theme } from '../app/theme.ts';
import { explainVerdict, polishExplanation } from '../ai/explainVerdict.ts';
import type { RideVerificationResult } from '../verification/types.ts';

export function VerdictCard({ result }: { result: RideVerificationResult }) {
  const explanation = explainVerdict(result);

  // Optional model-written summary. Null on most devices, which is fine.
  const [polished, setPolished] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void polishExplanation(explanation, result.integrityScore)
      .then((t) => {
        if (alive && t) setPolished(t);
      })
      .catch(() => {
        /* deterministic copy already on screen */
      });
    return () => {
      alive = false;
    };
    // Re-run only when the verdict itself changes.
  }, [result.rideId, result.status, result.flags.length]);

  // A clean verified ride needs no explanation — saying "nothing went wrong"
  // is noise on the one screen a rider is happy to be looking at.
  if (result.status === 'verified' && explanation.reasons.length === 0) {
    return null;
  }

  return (
    <Card>
      <Text style={styles.label}>WHY THIS RESULT</Text>
      <Text style={styles.title}>{explanation.title}</Text>
      <Text style={styles.summary}>{polished ?? explanation.summary}</Text>

      {explanation.reasons.map((r, i) => (
        <View key={i} style={styles.reason}>
          <Text style={styles.what}>{r.what}</Text>
          <Text style={styles.why}>{r.why}</Text>
          {r.fix ? <Text style={styles.fix}>{r.fix}</Text> : null}
        </View>
      ))}

      {/* Stated plainly because a rider whose ride was cut short by a GPS
          glitch deserves to know it wasn't a judgement about them. */}
      <Text style={styles.footnote}>
        Verification runs entirely on this phone. Nothing here was decided by
        a server, and nothing about your route was sent anywhere.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  title: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  summary: {
    color: theme.color.text,
    fontSize: 14,
    lineHeight: 20,
  },
  reason: {
    marginTop: theme.space.lg,
    paddingLeft: theme.space.md,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.border,
  },
  what: {
    color: theme.color.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
    marginBottom: 4,
  },
  why: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  fix: {
    color: theme.color.accent,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  footnote: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space.lg,
  },
});

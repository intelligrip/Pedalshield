/**
 * Eyes-free ride cues — haptics + optional spoken splits.
 *
 * A rider can't watch the screen, so the key moments (start, pause, resume,
 * finish, and each distance milestone) get a haptic buzz, and milestones can
 * also be spoken. All native modules are lazy-imported and every call is
 * best-effort: if expo-haptics / expo-speech aren't linked, cues silently
 * no-op rather than crashing the ride.
 *
 * Voice is opt-in via setVoiceCues(true) (default off — haptics always on).
 */

let voiceEnabled = false;

export function setVoiceCues(on: boolean): void {
  voiceEnabled = on;
}

async function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning',
): Promise<void> {
  try {
    const H = await import('expo-haptics');
    if (kind === 'success') {
      await H.notificationAsync(H.NotificationFeedbackType.Success);
    } else if (kind === 'warning') {
      await H.notificationAsync(H.NotificationFeedbackType.Warning);
    } else {
      const style =
        kind === 'heavy'
          ? H.ImpactFeedbackStyle.Heavy
          : kind === 'medium'
            ? H.ImpactFeedbackStyle.Medium
            : H.ImpactFeedbackStyle.Light;
      await H.impactAsync(style);
    }
  } catch {
    /* haptics not available — no-op */
  }
}

async function speak(text: string): Promise<void> {
  if (!voiceEnabled) return;
  try {
    const S = await import('expo-speech');
    S.speak(text, { rate: 1.0, pitch: 1.0 });
  } catch {
    /* speech not available — no-op */
  }
}

export function cueStart(): void {
  void haptic('medium');
}

export function cuePause(): void {
  void haptic('warning');
  void speak('Paused');
}

export function cueResume(): void {
  void haptic('light');
  void speak('Resumed');
}

export function cueFinish(): void {
  void haptic('success');
}

/** A distance milestone, e.g. cueSplit(3, 'mi') → buzz + "3 miles". */
export function cueSplit(n: number, unit: 'km' | 'mi'): void {
  void haptic('heavy');
  const word = unit === 'mi' ? 'mile' : 'kilometer';
  void speak(`${n} ${word}${n === 1 ? '' : 's'}`);
}

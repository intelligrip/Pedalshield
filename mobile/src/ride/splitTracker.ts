/**
 * Split tracker (pure, on-device).
 *
 * Watches cumulative distance and emits each whole-unit milestone crossed
 * (every km, or every mile) so the app can fire an eyes-free cue: a haptic
 * buzz and an optional spoken "3 miles." Deterministic and unit-tested.
 */

export class SplitTracker {
  /** Highest whole unit already announced. */
  private lastWhole = 0;

  /**
   * Feed the current cumulative distance (in the DISPLAY unit — km or mi).
   * Returns the list of new whole-unit milestones reached since the last
   * call (usually 0 or 1; a list guards against a big GPS jump). Empty when
   * nothing new was crossed.
   */
  update(distanceInUnit: number): number[] {
    const whole = Math.floor(distanceInUnit);
    if (whole <= this.lastWhole) return [];
    const crossed: number[] = [];
    for (let n = this.lastWhole + 1; n <= whole; n++) crossed.push(n);
    this.lastWhole = whole;
    return crossed;
  }

  reset(): void {
    this.lastWhole = 0;
  }
}

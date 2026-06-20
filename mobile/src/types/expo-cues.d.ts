/**
 * Minimal ambient declarations for the lazy-imported cue modules
 * (expo-haptics, expo-speech). Installed via
 * `npx expo install expo-haptics expo-speech` before the native build; these
 * stubs let tsc resolve them in the dev sandbox without the packages present.
 * Only the surface actually used in src/ride/cues.ts is declared.
 */
declare module 'expo-haptics' {
  export enum ImpactFeedbackStyle {
    Light = 'light',
    Medium = 'medium',
    Heavy = 'heavy',
  }
  export enum NotificationFeedbackType {
    Success = 'success',
    Warning = 'warning',
    Error = 'error',
  }
  export function impactAsync(style?: ImpactFeedbackStyle): Promise<void>;
  export function notificationAsync(
    type?: NotificationFeedbackType,
  ): Promise<void>;
}

declare module 'expo-speech' {
  export function speak(
    text: string,
    options?: { rate?: number; pitch?: number; language?: string },
  ): void;
}

/**
 * Minimal ambient declaration for expo-keep-awake. The module is lazy-imported
 * in realSensorSource and installed via `npx expo install expo-keep-awake`
 * before the native build; this lets tsc resolve it without the package being
 * present in the dev sandbox.
 */
declare module 'expo-keep-awake' {
  export function activateKeepAwakeAsync(tag?: string): Promise<void>;
  export function deactivateKeepAwake(tag?: string): Promise<void>;
}

// Minimal ambient declarations so `tsc --noEmit` and editor tooling work
// without `react-native`, `react`, or `@react-navigation/*` installed in
// the sandbox. At Expo build time the real packages shadow this shim.

declare module 'react' {
  export type ReactNode = unknown;
  export type ComponentType<P = unknown> = (props: P) => ReactNode;
  export function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  const React: {
    createElement(...args: any[]): any;
    Fragment: unknown;
  };
  export default React;
}

declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';

  export const NativeModules: Record<string, unknown>;
  export class NativeEventEmitter {
    constructor(nativeModule: unknown);
    addListener(event: string, listener: (data: unknown) => void): { remove(): void };
  }

  export interface ViewStyle { [k: string]: unknown }
  export interface TextStyle extends ViewStyle {}
  export interface ImageStyle extends ViewStyle {}
  export type StyleProp<T> = T | T[] | null | undefined | false;

  export interface ViewProps {
    children?: ReactNode;
    style?: StyleProp<ViewStyle>;
    [k: string]: unknown;
  }
  export const View: ComponentType<ViewProps>;
  export const SafeAreaView: ComponentType<ViewProps>;
  export const ScrollView: ComponentType<ViewProps & { contentContainerStyle?: StyleProp<ViewStyle> }>;

  export interface TextProps {
    children?: ReactNode;
    style?: StyleProp<TextStyle>;
    [k: string]: unknown;
  }
  export const Text: ComponentType<TextProps>;

  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    disabled?: boolean;
  }
  export const Pressable: ComponentType<PressableProps>;

  export const StatusBar: ComponentType<{
    barStyle?: string;
    backgroundColor?: string;
    translucent?: boolean;
  }>;

  export const StyleSheet: {
    create<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(s: T): T;
    flatten<T>(s: StyleProp<T>): T;
    absoluteFillObject: ViewStyle;
    hairlineWidth: number;
  };
}

declare module '@react-navigation/native' {
  export const NavigationContainer: any;
  export const useNavigation: any;
  export const DefaultTheme: any;
  export const DarkTheme: any;
}

declare module '@react-navigation/bottom-tabs' {
  export function createBottomTabNavigator(): any;
}

declare module '@react-navigation/native-stack' {
  export function createNativeStackNavigator(): any;
}

declare module 'expo-status-bar' {
  import type { ComponentType } from 'react';
  export const StatusBar: ComponentType<{ style?: string }>;
}

declare module 'react-native-gesture-handler' {
  // side-effect import only
}

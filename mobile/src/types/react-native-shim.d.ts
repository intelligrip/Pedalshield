// Minimal ambient declarations so `tsc --noEmit` and editor tooling work
// without `react-native`, `react`, or `@react-navigation/*` installed in
// the sandbox. At Expo build time the real packages shadow this shim.

declare module 'react' {
  export type ReactNode = any;
  export type ComponentType<P = unknown> = any;
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

  export interface ModalProps extends ViewProps {
    visible?: boolean;
    animationType?: 'none' | 'slide' | 'fade';
    transparent?: boolean;
    onRequestClose?: () => void;
  }
  export const Modal: ComponentType<ModalProps>;

  export const Dimensions: {
    get(dim: 'window' | 'screen'): { width: number; height: number; scale: number; fontScale: number };
  };

  export interface TextInputProps extends ViewProps {
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    placeholderTextColor?: string;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoCorrect?: boolean;
    multiline?: boolean;
    editable?: boolean;
    secureTextEntry?: boolean;
  }
  export const TextInput: ComponentType<TextInputProps>;

  export const ActivityIndicator: ComponentType<{
    size?: 'small' | 'large' | number;
    color?: string;
    style?: StyleProp<ViewStyle>;
  }>;

  export const Switch: ComponentType<{
    value?: boolean;
    onValueChange?: (value: boolean) => void;
    disabled?: boolean;
    trackColor?: { false?: string; true?: string };
    thumbColor?: string;
    ios_backgroundColor?: string;
    style?: StyleProp<ViewStyle>;
  }>;

  export const Linking: {
    openURL(url: string): Promise<void>;
    canOpenURL(url: string): Promise<boolean>;
  };

  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    select<T>(specifics: { [k: string]: T }): T;
  };

  export const Share: {
    share(content: {
      message?: string;
      url?: string;
      title?: string;
    }): Promise<{ action: string }>;
  };

  export namespace Animated {
    class Value {
      constructor(initial: number);
      addListener(cb: (state: { value: number }) => void): string;
      removeListener(id: string): void;
      setValue(v: number): void;
    }
    interface CompositeAnimation {
      start(cb?: (result: { finished: boolean }) => void): void;
      stop(): void;
    }
    function timing(
      value: Value,
      config: { toValue: number; duration?: number; delay?: number; useNativeDriver: boolean },
    ): CompositeAnimation;
    function spring(
      value: Value,
      config: { toValue: number; friction?: number; tension?: number; useNativeDriver: boolean },
    ): CompositeAnimation;
    function sequence(animations: CompositeAnimation[]): CompositeAnimation;
    const View: ComponentType<ViewProps & { style?: unknown }>;
    const Text: ComponentType<TextProps & { style?: unknown }>;
  }
}

declare module 'react-native-svg' {
  import type { ComponentType, ReactNode } from 'react';
  export interface SvgProps {
    width?: number | string;
    height?: number | string;
    viewBox?: string;
    children?: ReactNode;
    [k: string]: unknown;
  }
  const Svg: ComponentType<SvgProps>;
  export default Svg;
  export const Path: ComponentType<{ d?: string; [k: string]: unknown }>;
  export const Circle: ComponentType<{ cx?: number | string; cy?: number | string; r?: number | string; [k: string]: unknown }>;
  export const Line: ComponentType<{ x1?: number | string; y1?: number | string; x2?: number | string; y2?: number | string; [k: string]: unknown }>;
  export const Defs: ComponentType<{ children?: ReactNode }>;
  export const RadialGradient: ComponentType<{ id?: string; cx?: string; cy?: string; r?: string; children?: ReactNode }>;
  export const Stop: ComponentType<{ offset?: string; stopColor?: string; stopOpacity?: string | number }>;
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

declare module 'expo-location' {
  export enum Accuracy {
    Lowest = 1,
    Low = 2,
    Balanced = 3,
    High = 4,
    Highest = 5,
    BestForNavigation = 6,
  }
  export function requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  export interface LocationObject {
    coords: {
      latitude: number;
      longitude: number;
      altitude: number | null;
      accuracy: number | null;
      speed: number | null;
      heading: number | null;
    };
    timestamp: number;
  }
  export interface LocationSubscription {
    remove(): void;
  }
  export function watchPositionAsync(
    opts: { accuracy?: number; timeInterval?: number; distanceInterval?: number },
    cb: (loc: LocationObject) => void,
  ): Promise<LocationSubscription>;
  export function getCurrentPositionAsync(
    opts?: { accuracy?: number },
  ): Promise<LocationObject>;
}

declare module 'react-native-maps' {
  import type { ComponentType, ReactNode } from 'react';
  export interface Region {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }
  export interface MapViewProps {
    style?: unknown;
    initialRegion?: Region;
    region?: Region;
    showsUserLocation?: boolean;
    showsMyLocationButton?: boolean;
    provider?: string;
    children?: ReactNode;
    [k: string]: unknown;
  }
  const MapView: ComponentType<MapViewProps>;
  export default MapView;
  export const Marker: ComponentType<{
    coordinate: { latitude: number; longitude: number };
    title?: string;
    description?: string;
    pinColor?: string;
    onPress?: () => void;
    onCalloutPress?: () => void;
    children?: ReactNode;
  }>;
  export const Callout: ComponentType<{ children?: ReactNode; onPress?: () => void }>;
  export const PROVIDER_GOOGLE: string;
  export const PROVIDER_DEFAULT: string;
}

declare module 'expo-sensors' {
  export const Accelerometer: {
    setUpdateInterval(ms: number): void;
    addListener(cb: (d: { x: number; y: number; z: number }) => void): { remove(): void };
  };
}

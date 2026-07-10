import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Navigation } from './src/app/Navigation.tsx';
import { theme } from './src/app/theme.ts';
import { loadConnectedWallet } from './src/wallet/connectedWallet.ts';
import { loadUnitPreference } from './src/lib/units.ts';
import { loadRideHistory } from './src/ride/rideHistory.ts';
import { loadDataCoopPrefs } from './src/prefs/dataCoop.ts';
import {
  clearLastCrash,
  getLastCrash,
  installCrashRecorder,
  type CrashRecord,
} from './src/lib/crashLog.ts';

// Install as early as possible — before first render — so any fatal JS
// error from here on is persisted and shown on the next launch.
installCrashRecorder();

const navTheme = {
  dark: true,
  colors: {
    primary: theme.color.accent,
    background: theme.color.bg,
    card: theme.color.bgElev,
    text: theme.color.text,
    border: theme.color.border,
    notification: theme.color.accent,
  },
};

/**
 * Render-error boundary. A render exception in a release build is a hard
 * crash (RCTFatalException) — this catches it instead, records it, and
 * offers recovery, so a UI bug can never kill an active ride session
 * (ride data lives outside the React tree and survives).
 */
class CrashBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Reuse the recorder's storage so it shows in the same banner flow.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AS = require('@react-native-async-storage/async-storage').default;
      void AS.setItem(
        'pedalshield.lastCrash.v1',
        JSON.stringify({
          message: String(error?.message ?? error),
          stack: String(info?.componentStack ?? error?.stack ?? '').slice(0, 4000),
          isFatal: true,
          at: Date.now(),
          appState: 'render',
        }),
      );
    } catch {
      /* best effort */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.crash}>
        <Text style={styles.crashTitle}>Something broke — but your ride data is safe.</Text>
        <ScrollView style={styles.crashScroll}>
          <Text selectable style={styles.crashDetail}>
            {String(this.state.error?.message ?? this.state.error)}
          </Text>
        </ScrollView>
        <Pressable
          style={styles.crashBtn}
          onPress={() => this.setState({ error: null })}
        >
          <Text style={styles.crashBtnText}>Reload screen</Text>
        </Pressable>
      </View>
    );
  }
}

/** Banner shown after a previous session died — copyable error details. */
function CrashBanner() {
  const [crash, setCrash] = useState<CrashRecord | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    void getLastCrash().then(setCrash);
  }, []);
  if (!crash) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle}>
        Pedalshield crashed last time ({new Date(crash.at).toLocaleString()})
      </Text>
      <Text selectable style={styles.bannerMsg} numberOfLines={expanded ? 0 : 2}>
        {crash.message}
      </Text>
      {expanded ? (
        <Text selectable style={styles.bannerStack} numberOfLines={14}>
          {crash.stack}
        </Text>
      ) : null}
      <View style={styles.bannerRow}>
        <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8}>
          <Text style={styles.bannerAction}>
            {expanded ? 'Hide details' : 'Show details'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void clearLastCrash();
            setCrash(null);
          }}
          hitSlop={8}
        >
          <Text style={styles.bannerAction}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    // Pedalshield is non-custodial: there is no in-app wallet to boot. We
    // only restore the rider's connected (bring-your-own) Zcash address from
    // disk so the Home/Ride/Privacy screens know where payouts go before
    // anything renders. Best-effort: failure just means "not connected yet".
    void loadUnitPreference(); // restore mi/km choice before screens render
    void loadRideHistory(); // restore banked rides (history + YTD)
    void loadDataCoopPrefs(); // restore data co-op opt-in (defaults OFF)
    loadConnectedWallet()
      .catch((err) => {
        console.error('[boot] connected-wallet restore failed:', err);
        setBootError(String(err?.message ?? err));
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <StatusBar barStyle="light-content" backgroundColor={theme.color.bg} />
        <Text style={styles.bootText}>Pedalshield</Text>
        <Text style={styles.bootSub}>Ride private. Earn shielded.</Text>
        {bootError ? <Text style={styles.bootErr}>{bootError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.color.bg} />
      <CrashBoundary>
        <CrashBanner />
        <NavigationContainer theme={navTheme}>
          <Navigation />
        </NavigationContainer>
      </CrashBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.bg },
  boot: {
    flex: 1,
    backgroundColor: theme.color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bootText: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
  },
  bootSub: { color: theme.color.textDim, fontSize: 14 },
  bootErr: {
    color: '#ff6b6b',
    fontSize: 12,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  crash: {
    flex: 1,
    backgroundColor: theme.color.bg,
    padding: 24,
    paddingTop: 80,
    gap: 14,
  },
  crashTitle: {
    color: theme.color.text,
    fontSize: 20,
    fontWeight: '700',
  },
  crashScroll: { maxHeight: 220, flexGrow: 0 },
  crashDetail: { color: theme.color.danger, fontSize: 13, lineHeight: 19 },
  crashBtn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  crashBtnText: { color: '#0A0E1A', fontWeight: '700', fontSize: 15 },
  banner: {
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: theme.color.danger,
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 10,
    gap: 4,
  },
  bannerTitle: { color: theme.color.danger, fontSize: 12, fontWeight: '700' },
  bannerMsg: { color: theme.color.text, fontSize: 12 },
  bannerStack: { color: theme.color.textDim, fontSize: 10, lineHeight: 14 },
  bannerRow: { flexDirection: 'row', gap: 22, marginTop: 4 },
  bannerAction: {
    color: theme.color.accentSoft,
    fontSize: 12,
    fontWeight: '700',
  },
});

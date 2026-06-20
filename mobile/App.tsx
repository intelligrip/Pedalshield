import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Navigation } from './src/app/Navigation.tsx';
import { theme } from './src/app/theme.ts';
import { loadConnectedWallet } from './src/wallet/connectedWallet.ts';
import { loadUnitPreference } from './src/lib/units.ts';
import { loadRideHistory } from './src/ride/rideHistory.ts';

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
      <NavigationContainer theme={navTheme}>
        <Navigation />
      </NavigationContainer>
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
});

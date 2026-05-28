import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Navigation } from './src/app/Navigation.tsx';
import { theme } from './src/app/theme.ts';
import { MockWallet, setWallet, zecToZatoshi } from './src/wallet/index.ts';

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

  useEffect(() => {
    // Boot the wallet. MockWallet for simulator / dev; swap in
    // NativeWallet from ./src/wallet/nativeWallet for device builds.
    const wallet = new MockWallet({
      initialZatoshi: zecToZatoshi('0.0142'),
      syncTickMs: 50,
    });
    wallet
      .init({
        network: 'mainnet',
        lightwalletdHost: 'mainnet.lightwalletd.com:9067',
        seedPhrase: {
          words: [
            'abandon','abandon','abandon','abandon','abandon','abandon',
            'abandon','abandon','abandon','abandon','abandon','abandon',
            'abandon','abandon','abandon','abandon','abandon','abandon',
            'abandon','abandon','abandon','abandon','abandon','art',
          ],
          birthdayHeight: 2_800_000,
        },
        storageDir: '/tmp/pedalshield-mock',
      })
      .then(() => {
        setWallet(wallet);
        return wallet.startSync();
      })
      .then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <StatusBar barStyle="light-content" backgroundColor={theme.color.bg} />
        <Text style={styles.bootText}>Pedalshield</Text>
        <Text style={styles.bootSub}>booting shielded wallet...</Text>
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
});

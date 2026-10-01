import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen.tsx';
import { RideTrackerScreen } from '../screens/RideTrackerScreen.tsx';
import { LeaderboardScreen } from '../screens/LeaderboardScreen.tsx';
import { MarketScreen } from '../screens/MarketScreen.tsx';
import { PrivacyDashboardScreen } from '../screens/PrivacyDashboardScreen.tsx';
import { theme } from './theme.ts';
import { IS_FOGLINE } from '../lib/config.ts';
import { FogScreen } from '../fogline/FogScreen.tsx';
import { fog } from '../fogline/theme.ts';

const Tabs = createBottomTabNavigator();

export function Navigation() {
  return IS_FOGLINE ? <FoglineTabs /> : <PedalshieldTabs />;
}

/** Fogline: the fog and the ride. No feed, no leaderboard, no earn card. */
function FoglineTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: fog.bg,
          borderTopColor: fog.line,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: fog.clear,
        tabBarInactiveTintColor: fog.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
      }}
    >
      <Tabs.Screen name="Fog" component={FogScreen} />
      <Tabs.Screen name="Ride" component={RideTrackerScreen} />
    </Tabs.Navigator>
  );
}

function PedalshieldTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.bg },
        headerTintColor: theme.color.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.color.bgElev,
          borderTopColor: theme.color.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.textDim,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Ride" component={RideTrackerScreen} />
      <Tabs.Screen name="Leaders" component={LeaderboardScreen} />
      <Tabs.Screen name="Market" component={MarketScreen} />
      <Tabs.Screen name="Privacy" component={PrivacyDashboardScreen} />
    </Tabs.Navigator>
  );
}

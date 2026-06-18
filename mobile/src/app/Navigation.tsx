import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen.tsx';
import { RideTrackerScreen } from '../screens/RideTrackerScreen.tsx';
import { LeaderboardScreen } from '../screens/LeaderboardScreen.tsx';
import { PrivacyDashboardScreen } from '../screens/PrivacyDashboardScreen.tsx';
import { theme } from './theme.ts';

const Tabs = createBottomTabNavigator();

export function Navigation() {
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
      <Tabs.Screen name="Privacy" component={PrivacyDashboardScreen} />
    </Tabs.Navigator>
  );
}

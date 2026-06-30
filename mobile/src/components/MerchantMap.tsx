import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../app/theme.ts';
import { formatDistance, type LatLng, type SpendMerchant } from '../spend/geo.ts';

/**
 * Visual map of ZEC-accepting merchants. Uses react-native-maps (Apple Maps
 * on iOS — no API key). Loaded behind a runtime guard so a dev client without
 * the native module simply falls back to the list (same pattern as the
 * sensor sources). On an EAS build the module is present and the map renders.
 */

// Guarded require so merely importing this file never hard-crashes a client
// that lacks the native module.
declare const require: (m: string) => any;
let Maps: any = null;
try {
  Maps = require('react-native-maps');
} catch {
  Maps = null;
}

/** True when the native map module is linked and usable. */
export function mapAvailable(): boolean {
  return !!Maps?.default;
}

export function MerchantMap({
  center,
  merchants,
  onSelect,
}: {
  center: LatLng;
  merchants: SpendMerchant[];
  onSelect?: (m: SpendMerchant) => void;
}) {
  if (!Maps?.default) return null;
  const MapView = Maps.default;
  const Marker = Maps.Marker;

  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        showsUserLocation
        initialRegion={{
          latitude: center.lat,
          longitude: center.lon,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {merchants.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lon }}
            title={m.name}
            description={`${m.category}${
              m.distanceM != null ? ` · ${formatDistance(m.distanceM)}` : ''
            }${m.payUA ? ' · accepts ZEC in-app' : ''}`}
            pinColor={m.payUA ? theme.color.accent : theme.color.success}
            onCalloutPress={() => onSelect?.(m)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 340,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  map: { flex: 1 },
});

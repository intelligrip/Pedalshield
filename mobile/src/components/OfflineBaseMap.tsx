/**
 * OfflineBaseMap — real streets, zero network.
 *
 * Renders a MapLibre map whose only source is a locally downloaded PMTiles
 * region pack (see src/map/). The style has no glyphs, no sprite, no remote
 * tiles — after the one-time pack download, panning this map generates no
 * traffic at all. That is the whole point.
 *
 * @maplibre/maplibre-react-native is loaded behind a runtime guard (same
 * pattern as react-native-maps in MerchantMap) so a dev client without the
 * native module falls back cleanly — callers check offlineMapAvailable().
 *
 * Route + markers are drawn as GeoJSON layers (CircleLayer, LineLayer), not
 * symbol layers, so nothing here ever needs a sprite or font fetch either.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../app/theme.ts';
import { buildOfflineStyle } from '../map/basemapStyle.ts';

declare const require: (m: string) => any;

let ML: any = null;
try {
  const mod = require('@maplibre/maplibre-react-native');
  ML = mod?.default ?? mod;
  if (!ML?.MapView) ML = null;
} catch {
  ML = null;
}

/** True when the MapLibre native module is linked and usable. */
export function offlineMapAvailable(): boolean {
  return !!ML;
}

export interface Coord {
  lat: number;
  lon: number;
}

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** Circle color; defaults to theme success green. */
  color?: string;
}

interface Props {
  /** file:// URI of the downloaded .pmtiles pack. */
  packUri: string;
  /** Fit camera to these coords (route mode). Overrides center/zoom. */
  fitCoords?: ReadonlyArray<Coord>;
  center?: Coord;
  zoom?: number;
  route?: ReadonlyArray<Coord>;
  markers?: ReadonlyArray<MapMarker>;
  onMarkerPress?: (id: string) => void;
  /** Freeze gestures (live-ride mode keeps the camera on the rider). */
  interactive?: boolean;
  style?: object;
}

export function OfflineBaseMap({
  packUri,
  fitCoords,
  center,
  zoom = 13,
  route,
  markers,
  onMarkerPress,
  interactive = true,
  style,
}: Props) {
  if (!ML) return null;
  const { MapView, Camera, ShapeSource, LineLayer, CircleLayer } = ML;

  const mapStyle = useMemo(() => buildOfflineStyle(packUri), [packUri]);

  // Camera: either fit route bounds (with padding) or hold a center.
  const bounds = useMemo(() => {
    if (!fitCoords || fitCoords.length < 2) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of fitCoords) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    return { ne: [maxLon, maxLat], sw: [minLon, minLat] };
  }, [fitCoords]);

  const routeGeoJSON = useMemo(() => {
    if (!route || route.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: route.map((p) => [p.lon, p.lat]),
      },
    };
  }, [route]);

  const head = route && route.length > 0 ? route[route.length - 1] : null;

  const markersGeoJSON = useMemo(() => {
    if (!markers || markers.length === 0) return null;
    return {
      type: 'FeatureCollection' as const,
      features: markers.map((m) => ({
        type: 'Feature' as const,
        id: m.id,
        properties: { id: m.id, color: m.color ?? theme.color.success },
        geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
      })),
    };
  }, [markers]);

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        style={styles.map}
        mapStyle={mapStyle}
        logoEnabled={false}
        compassEnabled={false}
        attributionEnabled
        attributionPosition={{ bottom: 4, left: 4 }}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        <Camera
          bounds={bounds ?? undefined}
          centerCoordinate={
            !bounds && center ? [center.lon, center.lat] : undefined
          }
          zoomLevel={!bounds ? zoom : undefined}
          padding={{
            paddingTop: 40,
            paddingBottom: 40,
            paddingLeft: 40,
            paddingRight: 40,
          }}
          animationDuration={350}
        />

        {routeGeoJSON ? (
          <ShapeSource id="ps-route" shape={routeGeoJSON}>
            {/* glow under, sharp line over — mirrors the SVG renderer */}
            <LineLayer
              id="ps-route-glow"
              style={{
                lineColor: theme.color.accent,
                lineWidth: 9,
                lineOpacity: 0.18,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <LineLayer
              id="ps-route-line"
              style={{
                lineColor: theme.color.accent,
                lineWidth: 3,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        ) : null}

        {head ? (
          <ShapeSource
            id="ps-head"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [head.lon, head.lat] },
            }}
          >
            <CircleLayer
              id="ps-head-halo"
              style={{
                circleRadius: 18,
                circleColor: theme.color.accent,
                circleOpacity: 0.25,
              }}
            />
            <CircleLayer
              id="ps-head-dot"
              style={{
                circleRadius: 6,
                circleColor: theme.color.accent,
                circleStrokeWidth: 2,
                circleStrokeColor: theme.color.bg,
              }}
            />
          </ShapeSource>
        ) : null}

        {markersGeoJSON ? (
          <ShapeSource
            id="ps-markers"
            shape={markersGeoJSON}
            onPress={(e: any) => {
              const id = e?.features?.[0]?.properties?.id;
              if (id && onMarkerPress) onMarkerPress(String(id));
            }}
          >
            <CircleLayer
              id="ps-marker-dots"
              style={{
                circleRadius: 8,
                circleColor: ['get', 'color'],
                circleStrokeWidth: 2,
                circleStrokeColor: theme.color.bg,
              }}
            />
          </ShapeSource>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
});

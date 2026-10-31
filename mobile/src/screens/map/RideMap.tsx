import { Camera, GeoJSONSource, Layer, Map, Marker, type StyleSpecification } from '@maplibre/maplibre-react-native';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import type { Participant, Ride } from '../../api/types';
import { Txt } from '../../components/primitives';
import type { Live } from '../../store/ride';
import { useTheme } from '../../theme/ThemeProvider';
import { decodePolyline } from '../../utils/geo';
import { freshnessOf } from '../../utils/freshness';

/**
 * OpenStreetMap raster tiles, darkened to sit in the cluster palette.
 * tile.openstreetmap.org is for light use only; self-host or use a free-tier
 * tile provider before public release.
 */
export const OSM_DARK: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0B0C0E' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-brightness-max': 0.42, 'raster-contrast': 0.15 } },
  ],
};

type Props = {
  ride: Ride;
  participants: Record<string, Participant>;
  positions: Record<string, Live>;
  meId: string;
  now: number;
  interactive?: boolean;
  height?: number;
};

export function RideMap({ ride, participants, positions, meId, now, interactive = true, height }: Props) {
  const { c } = useTheme();
  const route = useMemo(() => (ride.route_polyline ? decodePolyline(ride.route_polyline) : []), [ride.route_polyline]);
  const pts = Object.entries(positions).filter(([uid]) => participants[uid]);

  const all: [number, number][] = [
    ...pts.map(([, p]) => [p.lng, p.lat] as [number, number]),
    ...(ride.dest_lat != null ? [[ride.dest_lng!, ride.dest_lat] as [number, number]] : []),
    ...(route.length ? [[route[0].lng, route[0].lat] as [number, number]] : []),
  ];
  const bounds =
    all.length >= 2
      ? ([Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1]))] as [number, number, number, number])
      : null;
  const center: [number, number] | null = all[0] ?? (ride.start_lat != null ? [ride.start_lng!, ride.start_lat] : null);

  if (!center) {
    return (
      <View style={{ height: height ?? 200, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
        <Txt dim>No positions yet</Txt>
        <Txt v="small" faint>
          Riders appear once their phone shares a real GPS fix.
        </Txt>
      </View>
    );
  }

  return (
    <Map style={{ flex: height ? undefined : 1, height }} mapStyle={OSM_DARK} attribution logo={false} dragPan={interactive} touchZoom={interactive} touchRotate={false} touchPitch={false}>
      {bounds ? <Camera bounds={bounds} padding={{ top: 60, bottom: 60, left: 60, right: 60 }} duration={600} /> : <Camera center={center} zoom={13} />}
      {route.length > 1 && (
        <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(p => [p.lng, p.lat]) } }}>
          <Layer id="route-line" type="line" style={{ lineColor: c.accent, lineWidth: 4, lineOpacity: 0.8, lineCap: 'round', lineJoin: 'round' }} />
        </GeoJSONSource>
      )}
      {ride.dest_lat != null && (
        <Marker id="dest" lngLat={[ride.dest_lng!, ride.dest_lat]}>
          <View style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: c.text, borderWidth: 3, borderColor: c.accent, transform: [{ rotate: '45deg' }] }} />
        </Marker>
      )}
      {pts.map(([uid, p]) => {
        const f = freshnessOf(p.recordedAt, now);
        const part = participants[uid];
        const admin = part.role === 'ADMIN';
        const col = f === 'LIVE' ? (admin ? c.accent : c.live) : c.textFaint;
        return (
          <Marker key={uid} id={`r-${uid}`} lngLat={[p.lng, p.lat]}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: uid === meId ? 22 : 18,
                  height: uid === meId ? 22 : 18,
                  borderRadius: 11,
                  backgroundColor: f === 'LIVE' ? col : 'transparent',
                  borderWidth: 3,
                  borderColor: col,
                  borderStyle: f === 'LIVE' ? 'solid' : 'dashed',
                }}
              />
              <View style={{ marginTop: 2, paddingHorizontal: 5, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.75)' }}>
                <Txt v="label" color={col} style={{ fontSize: 10 }}>
                  {uid === meId ? 'YOU' : part.display_name.split(' ')[0].toUpperCase()}
                  {f !== 'LIVE' ? ' · LAST KNOWN' : ''}
                </Txt>
              </View>
            </View>
          </Marker>
        );
      })}
    </Map>
  );
}

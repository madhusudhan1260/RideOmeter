import React from 'react';
import { View } from 'react-native';
import type { Ride } from '../../api/types';
import { Badge, StatusTag } from '../../components/cluster';
import { Icon } from '../../components/Icon';
import { Bezel, Row, Txt } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function RideCard({ ride, onPress }: { ride: Ride; onPress: () => void }) {
  const { c } = useTheme();
  const status =
    ride.status === 'ACTIVE'
      ? { label: 'Riding now', tone: 'live' as const }
      : ride.status === 'PLANNED'
        ? { label: 'Planned', tone: 'accent' as const }
        : { label: ride.status === 'ENDED' ? 'Completed' : 'Cancelled', tone: 'dim' as const };
  return (
    <Bezel onPress={onPress} tone={ride.status === 'ACTIVE' ? 'accent' : undefined} style={{ marginBottom: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <StatusTag label={status.label} tone={status.tone} />
        <Row gap={6}>
          {ride.my_role === 'ADMIN' && <Badge label="Admin" />}
          {ride.my_role === 'CO_ADMIN' && <Badge label="Co-admin" />}
          {ride.my_status === 'PENDING' && <Badge label="Awaiting approval" tone="dim" />}
        </Row>
      </Row>
      <Txt v="heading" style={{ marginTop: space.sm }} numberOfLines={1}>
        {ride.name}
      </Txt>
      <Row style={{ marginTop: space.sm }} gap={space.sm}>
        <Icon name="route" size={18} color={c.textFaint} />
        <Txt v="small" dim numberOfLines={1} style={{ flex: 1 }}>
          {ride.start_name} → {ride.dest_name}
        </Txt>
      </Row>
      <Row style={{ marginTop: space.xs, justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <Icon name="clock" size={18} color={c.textFaint} />
          <Txt v="small" dim>
            {fmtWhen(ride.scheduled_at)}
          </Txt>
        </Row>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="team" size={18} color={c.textFaint} />
          <Txt v="small" dim>
            {ride.participant_count}/{ride.max_participants}
          </Txt>
        </View>
      </Row>
    </Bezel>
  );
}

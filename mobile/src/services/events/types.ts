export type EventType =
  | 'RIDER_JOINED'
  | 'RIDER_LEFT'
  | 'RIDER_REMOVED'
  | 'RIDER_ROLE_CHANGED'
  | 'RIDE_STARTED'
  | 'RIDE_ENDED'
  | 'RIDE_UPDATED'
  | 'MUSIC_PLAY'
  | 'MUSIC_PAUSE'
  | 'MUSIC_NEXT'
  | 'MUSIC_PREV'
  | 'MUSIC_QUEUE'
  | 'MUSIC_ENABLED'
  | 'STOP_REQUESTED'
  | 'STOP_ACKNOWLEDGED'
  | 'STOP_UPDATED'
  | 'EMERGENCY_CREATED'
  | 'EMERGENCY_ACKNOWLEDGED'
  | 'EMERGENCY_RESOLVED'
  | 'LOCATION_UPDATED'
  | 'RIDER_DISCONNECTED'
  | 'RIDER_RECONNECTED'
  | 'ADMIN_ANNOUNCEMENT'
  | 'VOICE_MODE_CHANGED'
  | 'PRESENCE'
  | 'DELIVERY_ACK'
  | 'CLOCK_PING'
  | 'CLOCK_PONG'
  | 'ERROR';

export type DeliveryStatus = 'SENDING' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED';
export type Transport = 'ws' | 'nearby' | 'local';

export interface RideEvent<P = Record<string, any>> {
  event_id: string;
  event_type: EventType;
  ride_id: string;
  sender_id: string | null;
  timestamp: string;
  payload: P;
  delivery_status: DeliveryStatus;
  transport: Transport;
}

/** Event types only an admin / co-admin may originate (mirrors the backend). */
export const ADMIN_ONLY: ReadonlySet<EventType> = new Set<EventType>([
  'RIDE_STARTED',
  'RIDE_ENDED',
  'RIDE_UPDATED',
  'MUSIC_PLAY',
  'MUSIC_PAUSE',
  'MUSIC_NEXT',
  'MUSIC_PREV',
  'MUSIC_QUEUE',
  'MUSIC_ENABLED',
  'STOP_ACKNOWLEDGED',
  'ADMIN_ANNOUNCEMENT',
  'VOICE_MODE_CHANGED',
  'RIDER_REMOVED',
  'RIDER_ROLE_CHANGED',
]);

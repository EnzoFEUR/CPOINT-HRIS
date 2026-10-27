import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isOfflineFeatureActive } from '../routes/OfflineRouteGate.js';
import { isAppOffline, subscribeOfflineAccess } from './offlineAccess.mjs';
import { getStoredUser, subscribeStoredUser } from './storedUser.mjs';
import { offlineApi } from './offlineAttendanceSync';
import { readOfflineAvailability } from './offlineAvailability.mjs';

const actor = () => getStoredUser()?.id || '';
export function useOfflineAvailability(enabled = true) {
  const actorId = useSyncExternalStore(subscribeStoredUser, actor, actor);
  const offline = useSyncExternalStore(subscribeOfflineAccess, isAppOffline, isAppOffline);
  const query = useQuery({
    queryKey: ['offlineAttendanceAvailability', actorId],
    queryFn: () => readOfflineAvailability(offlineApi),
    enabled: Boolean(enabled && actorId && isOfflineFeatureActive && !offline),
    staleTime: 60000,
    retry: false,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });
  return { ...query, actorId };
}

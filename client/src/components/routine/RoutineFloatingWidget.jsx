import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { authApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import SmartEventWidget from './SmartEventWidget.jsx';

// Mounts the floating SmartEventWidget app-wide (spec §6), on every signed-in
// page except the calendar itself, where it would duplicate the page content.
//
// Gated on the opt-in `routineSystemEnabled` flag so a deployment that has not
// turned the routine system on pays no request for it at all.
export default function RoutineFloatingWidget() {
  const { user } = useAuth();
  const location = useLocation();
  const { data } = useQuery({
    queryKey: ['public-settings'],
    queryFn: authApi.publicSettings,
    staleTime: 60_000,
    enabled: Boolean(user),
  });

  if (!user) return null;
  if (data?.data?.routineSystemEnabled !== true) return null;
  if (location.pathname.startsWith('/routine')) return null;

  return <SmartEventWidget mode="floating" />;
}

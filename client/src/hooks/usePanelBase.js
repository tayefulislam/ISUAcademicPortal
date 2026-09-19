import { useLocation } from 'react-router-dom';

/**
 * The panel a shared management screen is being viewed from.
 *
 * <p>Document Templates is registered under both `/admin` and `/super-admin` —
 * a Super Admin and an Administrator have exactly the same access as an Admin —
 * so an internal link has to stay in the panel the user is already in, rather
 * than throwing them into the other panel's shell.
 */
export function usePanelBase() {
  const { pathname } = useLocation();
  return pathname.startsWith('/super-admin') ? '/super-admin' : '/admin';
}

export default usePanelBase;

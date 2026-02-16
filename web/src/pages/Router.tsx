import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Router page - redirects to Admin page
 * Router functionality has been moved to the Admin page
 */
export function Router() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/admin', { replace: true });
  }, [navigate]);

  return null;
}

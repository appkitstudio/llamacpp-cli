import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Router page - redirects to Manage page
 * Router functionality has been moved to the Manage page
 */
export function Router() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/manage', { replace: true });
  }, [navigate]);

  return null;
}

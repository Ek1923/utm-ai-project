import { useState, useEffect, useCallback } from 'react';
import { ForgeStatus, ForgeFix } from '../types/nexus';

export function useForge() {
  const [status, setStatus] = useState<ForgeStatus>({
    watching: false,
    health: 100,
    approvalQueue: 0,
    autoApprove: false
  });
  const [fixes, setFixes] = useState<ForgeFix[]>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/forge/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      // server not ready yet
    }
  }, []);

  const toggleAutoApprove = useCallback(async () => {
    const res = await fetch('/api/forge/toggle-approve', { method: 'POST' });
    if (res.ok) fetchStatus();
  }, [fetchStatus]);

  const approveFix = useCallback(async (fixId: number) => {
    await fetch(`/api/forge/approve/${fixId}`, { method: 'POST' });
    setFixes(prev => prev.filter(f => f.id !== fixId));
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, fixes, toggleAutoApprove, approveFix, fetchStatus };
}

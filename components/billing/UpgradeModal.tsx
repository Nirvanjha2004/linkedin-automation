'use client';

import { useState } from 'react';
import { Loader2, Zap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  reason: string;
  estimatedMonthlyCost: number;
}

export function UpgradeModal({ open, onClose, reason, estimatedMonthlyCost }: UpgradeModalProps) {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl border border-zinc-200 shadow-xl p-6 w-full max-w-sm mx-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">Upgrade required</p>
            <p className="text-sm text-zinc-500 mt-1">{reason}</p>
          </div>
        </div>

        <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3 mb-5">
          <p className="text-sm text-indigo-800">
            You have reached your free plan limits. Upgrade to continue.{' '}
            <span className="font-semibold">
              Estimated charge: ${estimatedMonthlyCost}/month.
            </span>
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleUpgrade} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Upgrade
          </Button>
        </div>
      </div>
    </div>
  );
}

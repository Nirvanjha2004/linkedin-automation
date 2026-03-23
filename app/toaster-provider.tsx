'use client';

import { Toaster } from 'sonner';

export default function ToasterProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: '10px',
          border: '1px solid rgb(228 228 231)',
          background: '#fff',
          color: 'rgb(9 9 11)',
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        },
      }}
    />
  );
}

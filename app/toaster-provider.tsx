'use client';

import { Toaster } from 'sonner';

export default function ToasterProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          borderRadius: '10px',
          background: '#1f2937',
          color: '#fff',
          fontSize: '14px',
        },
      }}
    />
  );
}

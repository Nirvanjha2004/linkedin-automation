'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            height: '100vh',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>
            Something went wrong
          </h2>
          {error?.digest && (
            <p style={{ fontSize: '13px', color: '#6b7280' }}>Digest: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: '16px',
              padding: '8px 20px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Zap, Loader2, Mail, Lock } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      toast.error(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  };

  const baseInputCls =
    'w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-colors';
  const inputCls = authError
    ? `${baseInputCls} border-red-300 focus:ring-red-400`
    : `${baseInputCls} border-zinc-200 focus:ring-indigo-500`;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm w-full max-w-[400px] p-8">
      <div className="flex flex-col items-center mb-7">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center mb-4">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-xl font-semibold text-zinc-900">Welcome back</h1>
        <p className="text-sm text-zinc-500 mt-1">Sign in to your account</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setAuthError(''); }}
              required
              placeholder="you@company.com"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-zinc-700">Password</label>
            <Link
              href="/forgot-password"
              className="text-xs text-zinc-400 hover:text-indigo-600 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setAuthError(''); }}
              required
              placeholder="••••••••"
              className={inputCls}
            />
          </div>
        </div>

        {authError && (
          <p className="text-xs text-red-500 -mt-1">{authError}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors mt-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            'Sign In'
          )}
        </button>
      </form>

      <p className="text-center mt-6 text-sm text-zinc-500">
        No account?{' '}
        <Link href="/register" className="text-indigo-600 font-medium hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

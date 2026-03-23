'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Zap, Loader2, Mail, Lock, User } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { full_name: fullName } },
    });
    if (error) { toast.error(error.message); setLoading(false); }
    else { toast.success('Account created! Check your email to verify.'); router.push('/login'); }
  };

  const inputCls = "w-full pl-9 pr-3 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";

  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm w-full max-w-[400px] p-8">
      <div className="flex flex-col items-center mb-7">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center mb-4">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-xl font-semibold text-zinc-900">Create account</h1>
        <p className="text-sm text-zinc-500 mt-1">Start automating your LinkedIn outreach</p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Full Name</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="John Doe" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1.5">Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" className={inputCls} />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors mt-2"
        >
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : 'Create Account'}
        </button>
      </form>

      <p className="text-center mt-6 text-sm text-zinc-500">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-600 font-medium hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

import React, { useState } from 'react';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';

interface LoginViewProps {
  onLogin: (password: string) => boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onLogin(password)) {
      setError('');
    } else {
      setError('Invalid password.');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-300">
        <div className="flex flex-col items-center mb-8">
           <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-2xl shadow-lg shadow-brand-primary/20 mb-4" aria-hidden="true">
             <ShieldCheckIcon className="w-9 h-9" />
           </div>
           <h1 className="text-2xl font-black text-gray-900 tracking-tight">Main Access</h1>
           <p className="text-sm text-gray-500 font-medium mt-1">UTS QR Attendance System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Password</label>
            <input 
              id="login-password"
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="block w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-brand-primary transition-colors text-gray-900 font-medium placeholder-gray-300"
              placeholder="••••••••"
              autoFocus
              aria-invalid={!!error}
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-lg text-center border border-red-100" role="alert">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="w-full bg-brand-primary text-white font-bold py-3.5 rounded-xl shadow-lg shadow-brand-primary/20 hover:bg-brand-secondary active:scale-[0.98] transition-all focus:ring-4 focus:ring-brand-primary/50 focus:outline-none"
          >
            Login to Dashboard
          </button>
        </form>
        
        <div className="mt-8 text-center">
           <p className="text-xs text-gray-400">Restricted access for authorized personnel only.</p>
        </div>
      </div>
    </div>
  );
};
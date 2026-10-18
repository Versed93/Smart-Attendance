import React, { useState } from 'react';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { UserPlusIcon } from './icons/UserPlusIcon';

interface LoginViewProps {
  onLogin: (username: string, password: string) => boolean;
  onSignUp?: (username: string, password: string) => boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({ 
  onLogin, 
  onSignUp,
}) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('adminscm');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (isSignUp) {
      if (!username.trim() || !password.trim()) {
        setError('Please enter both User Name and Password.');
        return;
      }
      if (onSignUp) {
        const success = onSignUp(username.trim(), password);
        if (success) {
          setSuccessMsg('Account created successfully! You can now log in.');
          setIsSignUp(false);
        } else {
          setError('Username already exists or registration failed.');
        }
      }
    } else {
      const success = onLogin(username.trim(), password);
      if (!success) {
        setError('Invalid User Name or Password.');
        setPassword('');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-300">
        <div className="flex flex-col items-center mb-6">
           <div className="flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-primary to-brand-secondary text-white rounded-2xl shadow-lg shadow-brand-primary/20 mb-4" aria-hidden="true">
             {isSignUp ? <UserPlusIcon className="w-9 h-9" /> : <ShieldCheckIcon className="w-9 h-9" />}
           </div>
           <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{isSignUp ? 'Create Account' : 'Main Access'}</h1>
           <p className="text-sm text-gray-500 font-bold mt-1">Smart QR Attendance System</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl mb-6">
          <button 
            type="button" 
            onClick={() => { setIsSignUp(false); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${!isSignUp ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Sign In
          </button>
          <button 
            type="button" 
            onClick={() => { setIsSignUp(true); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${isSignUp ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">User Name</label>
            <input 
              id="login-username"
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              className="block w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-brand-primary transition-colors text-gray-900 font-bold placeholder-gray-300 text-sm"
              placeholder="Your Name"
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">Password</label>
            <input 
              id="login-password"
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="block w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-brand-primary transition-colors text-gray-900 font-bold placeholder-gray-300 text-sm"
              placeholder="Password"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl text-center border border-red-100" role="alert">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-50 text-emerald-600 text-xs font-bold p-3 rounded-xl text-center border border-emerald-100" role="alert">
              {successMsg}
            </div>
          )}

          <button 
            type="submit" 
            className="w-full bg-brand-primary text-white font-bold py-3.5 rounded-xl shadow-lg shadow-brand-primary/20 hover:bg-brand-secondary active:scale-[0.98] transition-all focus:ring-4 focus:ring-brand-primary/50 focus:outline-none text-sm uppercase tracking-wider"
          >
            {isSignUp ? 'Register New User' : 'Login to Dashboard'}
          </button>
        </form>

        
        <div className="mt-6 text-center">
           <p className="text-[11px] text-gray-400 font-medium">Default Admin: User Name <strong className="text-gray-600">admin</strong> | Password <strong className="text-gray-600">adminscm</strong></p>
        </div>
      </div>
    </div>
  );
};
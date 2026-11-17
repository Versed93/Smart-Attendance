import React, { useState } from 'react';
import { BrandLogoIcon } from './icons/BrandLogoIcon';
import { UserPlusIcon } from './icons/UserPlusIcon';
import { EyeIcon } from './icons/EyeIcon';
import { EyeSlashIcon } from './icons/EyeSlashIcon';

interface LoginViewProps {
  onLogin: (usernameOrEmail: string, password: string) => Promise<{
    success: boolean;
    message?: string;
    requiresActivationPin?: boolean;
    username?: string;
    challengeToken?: string;
  }> | {
    success: boolean;
    message?: string;
    requiresActivationPin?: boolean;
    username?: string;
    challengeToken?: string;
  };
  onSignUp?: (username: string, email: string, password: string) => Promise<{ success: boolean; message: string }>;
  onActivateWithPin?: (
    usernameOrEmail: string,
    pin: string,
    challengeToken?: string
  ) => Promise<{ success: boolean; signedIn?: boolean; message: string }>;
  activationNotice?: { type: 'success' | 'error'; message: string } | null;
  onDismissActivationNotice?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLogin,
  onSignUp,
  onActivateWithPin,
  activationNotice,
  onDismissActivationNotice,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'activate-pin'>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [activationPin, setActivationPin] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [showUsername, setShowUsername] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSignUp = mode === 'signup';
  const isActivatePin = mode === 'activate-pin';

  const switchMode = (nextMode: 'signin' | 'signup' | 'activate-pin') => {
    setMode(nextMode);
    setError('');
    setSuccessMsg('');
    if (nextMode !== 'activate-pin') {
      setActivationPin('');
      setChallengeToken('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');
    setSuccessMsg('');
    if (onDismissActivationNotice) onDismissActivationNotice();

    if (isSignUp) {
      const cleanUser = username.trim();
      const cleanEmail = email.trim();
      if (!cleanUser || !cleanEmail || !password.trim()) {
        setError('Please enter User Name, Email Address, and Password.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError('Please enter a valid email address.');
        return;
      }
      if (onSignUp) {
        setIsSubmitting(true);
        try {
          const result = await onSignUp(cleanUser, cleanEmail, password);
          if (result.success) {
            setSuccessMsg(result.message);
            setMode('signin');
            setPassword('');
          } else {
            setError(result.message || 'Registration failed.');
          }
        } finally {
          setIsSubmitting(false);
        }
      }
    } else if (isActivatePin) {
      const cleanLookup = username.trim();
      const cleanPin = activationPin.replace(/\D/g, '').slice(0, 6);
      if (!cleanLookup || cleanPin.length !== 6) {
        setError('Enter the 6-digit Activation PIN emailed to you.');
        return;
      }
      if (onActivateWithPin) {
        setIsSubmitting(true);
        try {
          const result = await onActivateWithPin(cleanLookup, cleanPin, challengeToken || undefined);
          if (result.success) {
            if (!result.signedIn) {
              setSuccessMsg(result.message);
              setActivationPin('');
              setChallengeToken('');
              setMode('signin');
            }
          } else {
            setError(result.message || 'Invalid Activation PIN.');
          }
        } finally {
          setIsSubmitting(false);
        }
      }
    } else {
      setIsSubmitting(true);
      try {
        const result = await onLogin(username.trim(), password);
        if (!result.success) {
          if (result.requiresActivationPin) {
            if (result.username) setUsername(result.username);
            setChallengeToken(result.challengeToken || '');
            setMode('activate-pin');
            setSuccessMsg(result.message || 'Enter the 6-digit Activation PIN emailed to you.');
            setPassword('');
          } else {
            setError(result.message || 'Invalid User Name or Password.');
            setPassword('');
          }
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-3 sm:p-4">
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl w-full max-w-md border border-gray-100 animate-in fade-in zoom-in duration-300">
        <div className="flex flex-col items-center mb-6 text-center">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg mb-4 bg-gradient-to-br from-brand-primary to-brand-secondary text-white shadow-brand-primary/20"
            aria-hidden="true"
          >
            {isSignUp ? <UserPlusIcon className="w-9 h-9" /> : <BrandLogoIcon className="w-9 h-9" />}
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none">
            {isSignUp ? 'Create Account' : isActivatePin ? 'Activate Account' : 'SMART ATTENDANCE'}
          </h1>
          <p className="text-[11px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-2">
            Smart QR Attendance System
          </p>
        </div>

        {activationNotice && (
          <div
            className={`mb-5 p-3.5 rounded-2xl text-xs font-bold text-center border ${
              activationNotice.type === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
            role="alert"
          >
            {activationNotice.message}
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl mb-6">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${mode === 'signin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
              {isSignUp ? 'User Name' : 'User Name or Email'}
            </label>
            <div className="relative">
              <input
                id="login-username"
                type={showUsername ? 'text' : 'password'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                readOnly={isActivatePin}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                className={`block w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-12 outline-none focus:border-brand-primary transition-colors text-gray-900 font-bold placeholder-gray-300 text-sm ${isActivatePin ? 'bg-gray-50 text-gray-600 cursor-default' : ''}`}
                placeholder={isSignUp ? 'Your Name' : 'Username or Email'}
                autoFocus={!isActivatePin}
                required
              />
              <button
                type="button"
                onClick={() => setShowUsername(!showUsername)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1"
                title={showUsername ? 'Hide User Name' : 'Show User Name'}
              >
                {showUsername ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div>
              <label htmlFor="login-email" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full border-2 border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-brand-primary transition-colors text-gray-900 font-bold placeholder-gray-300 text-sm"
                placeholder="lecturer@university.edu"
                required
              />
            </div>
          )}

          {isActivatePin ? (
            <div>
              <label htmlFor="activation-pin" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                6-Digit Activation PIN (from Email)
              </label>
              <input
                id="activation-pin"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={activationPin}
                onChange={(e) => setActivationPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                className="block w-full border-2 border-indigo-200 bg-indigo-50/40 rounded-xl px-4 py-3 outline-none focus:border-brand-primary transition-colors text-gray-900 font-mono text-center text-2xl font-black tracking-[0.35em] placeholder-gray-300 tabular-nums"
                placeholder="••••••"
                required
              />
            </div>
          ) : (
            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  className="block w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-12 outline-none focus:border-brand-primary transition-colors text-gray-900 font-bold placeholder-gray-300 text-sm"
                  placeholder="Password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1"
                  title={showPassword ? 'Hide Password' : 'Show Password'}
                >
                  {showPassword ? <EyeSlashIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl text-center border border-red-100" role="alert">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="bg-emerald-50 text-emerald-700 text-xs font-bold p-3 rounded-xl text-center border border-emerald-100 leading-relaxed" role="alert">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full text-white font-bold py-3.5 rounded-xl shadow-lg active:scale-[0.98] transition-all focus:ring-4 focus:outline-none text-sm uppercase tracking-wider disabled:opacity-60 bg-brand-primary shadow-brand-primary/20 hover:bg-brand-secondary focus:ring-brand-primary/50"
          >
            {isSubmitting
              ? isSignUp
                ? 'Creating Account...'
                : isActivatePin
                  ? 'Activating Account...'
                  : 'Signing In...'
              : isSignUp
                ? 'SIGN UP'
                : isActivatePin
                  ? 'Complete Activation'
                  : 'Login to Dashboard'}
          </button>

          {isActivatePin && (
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors"
              >
                Back to Sign In
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
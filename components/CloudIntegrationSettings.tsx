import React, { useState, useEffect } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

interface CloudIntegrationSettingsProps {
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onSendTestRecord: () => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
}

export const CloudIntegrationSettings: React.FC<CloudIntegrationSettingsProps> = ({ 
  scriptUrl, 
  onScriptUrlChange, 
  onSendTestRecord, 
  onCheckPendingRecords, 
  onForceSync 
}) => {
  const [integrationType, setIntegrationType] = useState<'google_sheets' | 'airtable' | 'firebase'>(() => {
      return (localStorage.getItem('attendance-integration-type') as 'google_sheets' | 'airtable' | 'firebase') || 'google_sheets';
  });

  const [airtableToken, setAirtableToken] = useState(() => localStorage.getItem('airtable-token') || '');
  const [airtableBaseId, setAirtableBaseId] = useState(() => localStorage.getItem('airtable-base-id') || '');
  const [airtableTableName, setAirtableTableName] = useState(() => localStorage.getItem('airtable-table-name') || 'Attendance');

  const [status, setStatus] = useState('');

  useEffect(() => {
      localStorage.setItem('attendance-integration-type', integrationType);
  }, [integrationType]);

  useEffect(() => {
      localStorage.setItem('airtable-token', airtableToken);
      localStorage.setItem('airtable-base-id', airtableBaseId);
      localStorage.setItem('airtable-table-name', airtableTableName);
  }, [airtableToken, airtableBaseId, airtableTableName]);

  return (
    <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 space-y-6">
      <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Destination Type</label>
          <div className="flex bg-gray-50 p-1 rounded-xl">
              <button 
                  onClick={() => setIntegrationType('google_sheets')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'google_sheets' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Google Sheets
              </button>
              <button 
                  onClick={() => setIntegrationType('airtable')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'airtable' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Airtable
              </button>
              <button 
                  onClick={() => setIntegrationType('firebase')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'firebase' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Firebase
              </button>
          </div>
      </div>

      {integrationType === 'google_sheets' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <div className="bg-amber-100 p-1.5 rounded-lg text-amber-600 shrink-0">ℹ️</div>
                  <p className="text-[10px] text-amber-800 leading-relaxed font-bold uppercase">
                      Paste your Google Apps Script Web App URL below.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Apps Script URL</label>
                  <input 
                      type="text" 
                      value={scriptUrl} 
                      onChange={(e) => onScriptUrlChange(e.target.value)} 
                      placeholder="https://script.google.com/macros/s/.../exec" 
                      className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                  />
              </div>
          </div>
      )}

      {integrationType === 'airtable' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
                  <div className="bg-blue-100 p-1.5 rounded-lg text-blue-600 shrink-0">ℹ️</div>
                  <p className="text-[10px] text-blue-800 leading-relaxed font-bold uppercase">
                      Create a Personal Access Token in Airtable with 'data.records:write' scope.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Personal Access Token</label>
                  <input 
                      type="password" 
                      value={airtableToken} 
                      onChange={(e) => setAirtableToken(e.target.value)} 
                      placeholder="pat..." 
                      className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                  />
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Base ID</label>
                      <input 
                          type="text" 
                          value={airtableBaseId} 
                          onChange={(e) => setAirtableBaseId(e.target.value)} 
                          placeholder="app..." 
                          className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                      />
                  </div>
                  <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Table Name</label>
                      <input 
                          type="text" 
                          value={airtableTableName} 
                          onChange={(e) => setAirtableTableName(e.target.value)} 
                          placeholder="Attendance" 
                          className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                      />
                  </div>
              </div>
          </div>
      )}

      {integrationType === 'firebase' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-green-50 rounded-2xl border border-green-100 flex items-start gap-3">
                  <div className="bg-green-100 p-1.5 rounded-lg text-green-600 shrink-0">✅</div>
                  <p className="text-[10px] text-green-800 leading-relaxed font-bold uppercase">
                      Firebase is already configured as your primary real-time backend. Records are automatically saved to your Firebase Realtime Database.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Database URL</label>
                  <input 
                      type="text" 
                      value={FIREBASE_CONFIG.DATABASE_URL} 
                      disabled
                      className="w-full border-2 border-gray-50 bg-gray-100 rounded-2xl p-4 text-xs font-bold text-gray-500 outline-none cursor-not-allowed" 
                  />
              </div>
          </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-50">
        <button onClick={async () => { setStatus('Checking...'); const r = await onCheckPendingRecords(); setStatus(r.message); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Check Queue</button>
        <button onClick={async () => { setStatus('Syncing...'); await onForceSync(); setStatus('Sync Complete'); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Force Sync</button>
        <button onClick={async () => { setStatus('Testing...'); const r = await onSendTestRecord(); setStatus(r.message); }} className="bg-gray-900 text-white font-bold py-3 rounded-xl text-[10px] hover:bg-black uppercase tracking-widest active:scale-95 transition-all">Test Sync</button>
      </div>
      
      {status && <p className="text-[10px] text-center font-bold text-indigo-600 uppercase tracking-widest">{status}</p>}
    </div>
  );
};

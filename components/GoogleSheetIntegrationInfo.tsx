
import React, { useState } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * UTS FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v27.0)
 * Data Mapping: Status (Combined with Reason)
 */

var FIREBASE_URL = "${(FIREBASE_CONFIG.DATABASE_URL || 'PASTE_URL').replace(/\/+$/, '')}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_SECRET'}";

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return ContentService.createTextOutput(JSON.stringify({success:false, error:"Locked"})).setMimeType(ContentService.MimeType.JSON);
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === "SYNC_QUEUE") syncFromFirebase();
    else handleBulkRecords(data, "Direct");
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally { lock.releaseLock(); }
}

function syncFromFirebase() {
  var response = UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET);
  var data = JSON.parse(response.getContentText());
  if (data) handleBulkRecords(data, "Auto");
}

function handleBulkRecords(data, src) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var ids = Object.keys(data);
  var processed = {};
  for (var i = 0; i < ids.length; i++) {
    var rec = data[ids[i]];
    var status = rec.status;
    if (rec.absenceReason) status += " (" + rec.absenceReason + ")";
    
    var date = new Date(rec.timestamp);
    var header = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
    if (rec.courseName && rec.courseName !== 'General') header += " - " + rec.courseName;
    
    processEntry({id: rec.studentId, name: rec.name, status: status, header: header}, doc);
    processed[ids[i]] = null;
  }
  if (src !== "Direct") UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, {method:'PATCH', payload:JSON.stringify(processed)});
}

function processEntry(item, doc) {
  var sheet = doc.getSheets().find(s => s.getName().indexOf("W") !== -1) || doc.getSheets()[0];
  var headers = sheet.getRange(12, 15, 1, 300).getDisplayValues()[0];
  var col = -1;
  for (var c = 0; c < headers.length; c++) {
    if (headers[c] === item.header) { col = 15 + c; break; }
    if (!headers[c]) { col = 15 + c; sheet.getRange(12, col).setValue(item.header); break; }
  }
  var dataRows = sheet.getRange(14, 2, sheet.getLastRow(), 1).getValues();
  var row = dataRows.findIndex(r => String(r[0]).toUpperCase() === item.id.toUpperCase()) + 14;
  if (row < 14) {
    row = sheet.getLastRow() + 1;
    sheet.getRange(row, 2).setValue(item.id);
    sheet.getRange(row, 4).setValue(item.name);
  }
  sheet.getRange(row, col).setValue(item.status);
}
`;

interface GoogleSheetIntegrationInfoProps {
  onSendTestRecord: () => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
}

export const GoogleSheetIntegrationInfo: React.FC<GoogleSheetIntegrationInfoProps> = ({ onSendTestRecord, onCheckPendingRecords, onForceSync }) => {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  return (
    <div className="bg-white p-6 rounded-3xl border-2 border-gray-100 space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-black text-gray-900 uppercase tracking-widest">Apps Script v27.0</h4>
        <button 
          onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
          className={`text-[9px] px-4 py-2 rounded-xl font-black transition-all ${copied ? 'bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-black'}`}
        >
          {copied ? 'COPIED TO CLIPBOARD' : 'COPY SCRIPT CODE'}
        </button>
      </div>
      
      <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
        <div className="bg-amber-100 p-1.5 rounded-lg text-amber-600 shrink-0">⚠️</div>
        <p className="text-[10px] text-amber-800 leading-relaxed font-bold uppercase">
          V27.0 REQUIRED: Deploy as "Web App", Execute as "Me", Access "Anyone". Support for student notes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={async () => { setStatus('Syncing...'); await onForceSync(); setStatus('Sync Complete'); }} className="bg-gray-100 text-gray-800 font-black py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Force Sync</button>
        <button onClick={async () => { setStatus('Testing...'); const r = await onSendTestRecord(); setStatus(r.message); }} className="bg-gray-900 text-white font-black py-3 rounded-xl text-[10px] hover:bg-black uppercase tracking-widest active:scale-95 transition-all">Test Sheet</button>
      </div>
      
      {status && <p className="text-[10px] text-center font-bold text-indigo-600 uppercase tracking-widest">{status}</p>}
    </div>
  );
};

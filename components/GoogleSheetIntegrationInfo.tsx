
import React, { useState } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * UTS FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v20.0)
 * Priority Tab: W6-W10
 * Column B: ID | Column D: Name | O+: Attendance
 */

// --- CONFIG ---
var FIREBASE_URL = "${(FIREBASE_CONFIG.DATABASE_URL || 'PASTE_URL').replace(/\/+$/, '')}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_SECRET'}";
// --- END CONFIG ---

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error:"Locked"})).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var contents = e.postData.contents;
    if (!contents) throw "Empty Payload";
    var data = JSON.parse(contents);
    
    if (data.action === "SYNC_QUEUE") {
      syncFromFirebase();
    } else {
      handleBulkRecords(data, "DirectPing");
    }
    
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    console.error("UTS Script v20 Error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function syncFromFirebase() {
  try {
    var response = UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, { 'muteHttpExceptions': true });
    var data = JSON.parse(response.getContentText());
    if (data && Object.keys(data).length > 0) {
      handleBulkRecords(data, "AutoSync");
    } else {
      console.log("No pending records in Firebase.");
    }
  } catch (err) {
    console.error("Sync Error: " + err.toString());
  }
}

function handleBulkRecords(data, source) {
  if (!data || Object.keys(data).length === 0) return;
  
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var ids = Object.keys(data);
  var processedKeys = {};

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var record = data[id];
    if (!record || !record.studentId) continue;
    
    try {
      var date = new Date(record.timestamp);
      var header = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
      if (record.courseName && record.courseName !== 'General') header += " - " + record.courseName;
      
      processEntry({
        id: record.studentId,
        name: record.name,
        status: record.status === 'P' ? "P @ " + Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm") : record.status,
        header: header
      }, doc);
      
      processedKeys[id] = null; 
    } catch(e) {
      console.warn("Processing failed for " + id + ": " + e.toString());
    }
  }

  // Cleanup Firebase if processed from AutoSync
  if (Object.keys(processedKeys).length > 0 && source !== "DirectPing") {
    try {
      UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, {
        'method': 'PATCH',
        'payload': JSON.stringify(processedKeys),
        'muteHttpExceptions': true
      });
      console.log("Firebase cleared for " + Object.keys(processedKeys).length + " keys.");
    } catch (e) {
      console.error("Firebase Cleanup Failed: " + e.toString());
    }
  }
}

function processEntry(item, doc) {
  var id = String(item.id || "").toUpperCase().trim();
  var name = String(item.name || "").toUpperCase().trim();
  var sheet, col;
  
  var sheets = doc.getSheets();
  var targetSheet;

  // PRIORITY: Find "W6-W10" tab
  for (var i = 0; i < sheets.length; i++) {
    var sName = sheets[i].getName();
    if (sName.toUpperCase().indexOf("W6-W10") !== -1) {
      targetSheet = sheets[i];
      break;
    }
  }

  // FALLBACK: Newest sheet with "W" or "WEEK" in name
  if (!targetSheet) {
    for (var i = sheets.length - 1; i >= 0; i--) {
      var sName = sheets[i].getName().toUpperCase();
      if (sName.indexOf("W") !== -1 || sName.indexOf("WEEK") !== -1) {
        targetSheet = sheets[i];
        break;
      }
    }
  }

  sheet = targetSheet || sheets[0];
  console.log("Using sheet: " + sheet.getName());

  // Search Row 12 for header starting from Column O (15)
  var headers = sheet.getRange(12, 15, 1, 150).getDisplayValues()[0];
  for (var c = 0; c < headers.length; c++) {
    if (headers[c].trim() === item.header) { col = 15 + c; break; }
    if (!col && headers[c].trim() === "") {
      col = 15 + c;
      sheet.getRange(12, col).setValue(item.header);
      break;
    }
  }

  if (!col) col = 15;

  // Find Student in Column B (2) starting from Row 14
  var lastRow = Math.max(sheet.getLastRow(), 14);
  var dataRows = sheet.getRange(14, 2, Math.max(lastRow - 13, 1), 1).getValues();
  var row = -1;
  for (var r = 0; r < dataRows.length; r++) {
    if (String(dataRows[r][0]).toUpperCase().trim() === id) {
      row = 14 + r;
      break;
    }
  }

  if (row === -1) {
    row = sheet.getLastRow() + 1;
    if (row < 14) row = 14;
    sheet.getRange(row, 2).setValue(id);
    sheet.getRange(row, 4).setValue(name);
  }
  
  sheet.getRange(row, col).setValue(item.status);
}

function doGet(e) {
  return ContentService.createTextOutput("UTS Script v20.0 ACTIVE - Target: W6-W10 Priority").setMimeType(ContentService.MimeType.TEXT);
}
`;

interface GoogleSheetIntegrationInfoProps {
  onSendTestRecord: () => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
}

export const GoogleSheetIntegrationInfo: React.FC<GoogleSheetIntegrationInfoProps> = ({ onSendTestRecord, onCheckPendingRecords, onForceSync }) => {
  const [copied, setCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [syncMessage, setSyncMessage] = useState('');

  const handleTestClick = async () => {
    setTestStatus('sending');
    const result = await onSendTestRecord();
    setTestMessage(result.message);
    setTestStatus(result.success ? 'success' : 'error');
    setTimeout(() => { setTestStatus('idle'); setTestMessage(''); }, 5000);
  };

  const handleSyncClick = async () => {
    setSyncStatus('syncing');
    const result = await onForceSync();
    setSyncMessage(result.message);
    setSyncStatus('synced');
    setTimeout(() => { setSyncStatus('idle'); setSyncMessage(''); }, 5000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-sm font-black text-gray-800 uppercase tracking-tight">Sync Panel v20.0</h4>
          <button 
            onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
            className={`text-[10px] px-3 py-1 rounded-full font-black transition-all ${copied ? 'bg-green-500 text-white' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
          >
            {copied ? 'COPIED!' : 'COPY CODE'}
          </button>
        </div>
        
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <p className="text-[10px] font-bold text-amber-800 uppercase mb-1">Sheet Selection v20.0</p>
          <p className="text-[10px] text-amber-700 mb-2 leading-relaxed">Prioritizing <strong>W6-W10</strong>. If deployment failed, ensure you are using a new deployment ID and set "Access" to "Anyone".</p>
          <ol className="text-[10px] text-amber-700 space-y-1 list-decimal ml-3">
            <li>Update your Google Apps Script to <strong>v20.0</strong>.</li>
            <li>Click <strong>Deploy > New Deployment</strong>.</li>
            <li>Set "Access" to <strong>Anyone</strong>.</li>
            <li>Ensure <strong>syncFromFirebase</strong> trigger is set to 1-minute intervals.</li>
          </ol>
        </div>

        <div className="grid grid-cols-2 gap-2">
           <button onClick={handleSyncClick} disabled={syncStatus === 'syncing'} className="bg-brand-primary text-white font-black py-2 rounded-lg text-xs hover:bg-brand-secondary transition-all">
            {syncStatus === 'syncing' ? 'SYNCING...' : 'FORCE SYNC'}
          </button>
          <button onClick={handleTestClick} disabled={testStatus === 'sending'} className="bg-white border-2 border-brand-primary/20 text-brand-primary font-black py-2 rounded-lg text-xs hover:bg-brand-primary/5 transition-all">
            {testStatus === 'sending' ? 'TESTING...' : 'SEND TEST'}
          </button>
        </div>
        
        {syncMessage && <p className="text-[10px] mt-2 text-center font-bold text-brand-primary">{syncMessage}</p>}
        {testMessage && (<p className={`text-[10px] mt-1 text-center font-bold ${testStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>{testMessage}</p>)}
      </div>
    </div>
  );
};

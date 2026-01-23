
import React, { useState } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * UTS FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v15.0)
 * Column B: ID | Column D: Name | O+: Attendance
 */

var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_URL'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_SECRET'}";

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return ContentService.createTextOutput(JSON.stringify({success:false})).setMimeType(ContentService.MimeType.JSON);
  try {
    var data = JSON.parse(e.postData.contents);
    handleBulkRecords(data, "DirectPing");
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    console.error("UTS Script Error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally { lock.releaseLock(); }
}

function handleBulkRecords(data, source) {
  if (!data) return;
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var ids = Object.keys(data);
  for (var i = 0; i < ids.length; i++) {
    var record = data[ids[i]];
    if (!record) continue;
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
    } catch(e) {
      console.warn("Entry Processing Failed: " + e.toString());
    }
  }
}

function processEntry(item, doc) {
  var id = String(item.id || "").toUpperCase().trim();
  var name = String(item.name || "").toUpperCase().trim();
  var sheet, col;
  
  // Try to find the right sheet (fuzzy match W1-W5, W6-W10, etc)
  var sheets = doc.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName().toUpperCase();
    if (n.indexOf("W") !== -1 || n.indexOf("WEEK") !== -1 || n.indexOf("ATTENDANCE") !== -1) {
      sheet = sheets[i];
      break;
    }
  }
  if (!sheet) sheet = sheets[0];

  // Header Search in Row 12 (Start O=15)
  // Search up to 100 columns for safety
  var headers = sheet.getRange(12, 15, 1, 100).getDisplayValues()[0];
  for (var c = 0; c < headers.length; c++) {
    if (headers[c].trim() === item.header) { col = 15 + c; break; }
    if (!col && headers[c].trim() === "") {
      col = 15 + c;
      sheet.getRange(12, col).setValue(item.header);
      break;
    }
  }

  if (!col) col = 15; // Safe fallback

  // Row Search in Col B (Start 14)
  var lastRow = Math.max(sheet.getLastRow(), 14);
  var data = sheet.getRange(14, 2, Math.max(lastRow - 13, 1), 1).getValues();
  var row = -1;
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][0]).toUpperCase().trim() === id) { row = 14 + r; break; }
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
  return ContentService.createTextOutput("UTS Script v15.0 Active").setMimeType(ContentService.MimeType.TEXT);
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

  const handleTestClick = async () => {
    setTestStatus('sending');
    const result = await onSendTestRecord();
    setTestMessage(result.message);
    setTestStatus(result.success ? 'success' : 'error');
    setTimeout(() => { setTestStatus('idle'); setTestMessage(''); }, 5000);
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-sm font-black text-gray-800 uppercase tracking-tight">Sheet Script v15.0</h4>
          <button 
            onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
            className={`text-[10px] px-3 py-1 rounded-full font-black transition-all ${copied ? 'bg-green-500 text-white' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
          >
            {copied ? 'COPIED!' : 'COPY CODE'}
          </button>
        </div>
        <p className="text-[10px] text-gray-500 mb-3 leading-relaxed font-medium">Update your Apps Script to v15.0 and deploy as "Web App" for "Anyone" to ensure Column B/D/O mapping is active.</p>
        <button onClick={handleTestClick} disabled={testStatus === 'sending'} className="w-full bg-white border-2 border-brand-primary/20 text-brand-primary font-black py-2 rounded-lg text-xs hover:bg-brand-primary/5 transition-all">
          {testStatus === 'sending' ? 'SENDING TEST...' : 'RUN SYNC TEST'}
        </button>
        {testMessage && (<p className={`text-[10px] mt-2 text-center font-bold ${testStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>{testMessage}</p>)}
      </div>
    </div>
  );
};

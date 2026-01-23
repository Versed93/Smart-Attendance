
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v11.0)
 * 
 * This version supports real-time direct recording from the student app.
 * It handles both individual record pings and bulk syncs.
 *
 * --- IMPORTANT: SHEET STRUCTURE ---
 * - Tabs for attendance (e.g., "W1-W5").
 * - Row 12 is for session dates/headers.
 * - Column B (2) contains Student IDs.
 * - Column D (4) contains Student Names.
 * - Student records start from Row 14.
 * - Attendance is written in Columns O (15) onwards.
 * ---
 */

// --- CONFIGURATION ---
var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_YOUR_FIREBASE_URL_HERE'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_YOUR_FIREBASE_SECRET_HERE'}";
// --- END CONFIGURATION ---

function getSheetConfigs() {
  return [
    { name: "W1-W5", dateRow: 12, startCol: 15, endCol: 30 },
    { name: "W6-W10", dateRow: 12, startCol: 15, endCol: 30 },
    { name: "W11-W14", dateRow: 12, startCol: 15, endCol: 30 }
  ];
}

/**
 * Handles incoming data (Individual or Bulk)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Server Busy" })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var data = JSON.parse(e.postData.contents);
    handleBulkRecords(data, "doPost");
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error("doPost Error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Automatic trigger function for missed records.
 */
function syncFromFirebase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    var pendingDataUrl = FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET;
    var response = UrlFetchApp.fetch(pendingDataUrl, { 'muteHttpExceptions': true });
    var data = JSON.parse(response.getContentText());
    handleBulkRecords(data, "AutoSync");
    
  } catch (err) {
    console.error("Sync Error: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * Shared logic to process records and clear Firebase.
 */
function handleBulkRecords(data, source) {
  if (!data || Object.keys(data).length === 0) return;
    
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var studentIdsToProcess = Object.keys(data);
  var processedKeys = {};

  for (var i = 0; i < studentIdsToProcess.length; i++) {
    var studentId = studentIdsToProcess[i];
    var record = data[studentId];
    
    try {
      var date = new Date(record.timestamp);
      var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
      var timeStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm");
      
      var sessionHeader = dateStr;
      if (record.courseName && String(record.courseName).trim() !== "") {
          sessionHeader = dateStr + " - " + String(record.courseName).trim();
      }

      var statusStr = record.status === 'P' ? "P @ " + timeStr : record.status;

      processSingleRecord({
        studentId: record.studentId,
        name: record.name,
        status: statusStr,
        sessionHeader: sessionHeader
      }, doc);
      
      processedKeys[studentId] = null; // Mark for Firebase cleanup

    } catch (e) {
      console.error(source + ": Error for " + studentId + ": " + e.toString());
    }
  }
  
  if (Object.keys(processedKeys).length > 0) {
    UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, {
      'method': 'PATCH',
      'payload': JSON.stringify(processedKeys),
      'muteHttpExceptions': true
    });
  }
}

function processSingleRecord(record, doc) {
    var studentId = String(record.studentId || "").toUpperCase().trim();
    var studentName = String(record.name || "").toUpperCase().trim();
    var sessionHeader = record.sessionHeader;

    var configs = getSheetConfigs();
    var targetSheet, targetCol;

    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerRange = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1);
      var headerValues = headerRange.getDisplayValues()[0];
      var emptyCol = -1;

      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === sessionHeader) {
          targetCol = conf.startCol + c;
          break;
        }
        if (emptyCol === -1 && headerValues[c].trim() === "") emptyCol = conf.startCol + c;
      }
      
      if (!targetCol && emptyCol !== -1) {
        targetCol = emptyCol;
        sheet.getRange(conf.dateRow, targetCol).setValue(sessionHeader);
      }
      
      if(targetCol) {
        targetSheet = sheet;
        break;
      }
    }

    if (!targetSheet) throw "Sheet/Column not found";
    
    var startRow = 14;
    var lastRow = targetSheet.getLastRow();
    var studentRow = -1;

    if (lastRow >= startRow) {
      var idRange = targetSheet.getRange(startRow, 2, lastRow - startRow + 1, 1);
      var ids = idRange.getDisplayValues();
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]).toUpperCase().trim() === studentId) {
          studentRow = startRow + r;
          break;
        }
      }
    }

    if (studentRow === -1) {
       studentRow = Math.max(lastRow + 1, startRow);
       targetSheet.getRange(studentRow, 2).setValue(studentId);
       targetSheet.getRange(studentRow, 4).setValue(studentName);
    }

    targetSheet.getRange(studentRow, targetCol).setValue(record.status);
}

function doGet(e) {
    return ContentService.createTextOutput("Script Active").setMimeType(ContentService.MimeType.TEXT);
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
  
  const [checkStatus, setCheckStatus] = useState<'idle' | 'checking' | 'checked'>('idle');
  const [checkResult, setCheckResult] = useState<{ message: string; count: number; isError: boolean } | null>(null);

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [syncResult, setSyncResult] = useState<{ message: string; success: boolean } | null>(null);

  const handleTestClick = async () => {
    setTestStatus('sending');
    setTestMessage('');
    const result = await onSendTestRecord();
    setTestMessage(result.message);
    setTestStatus(result.success ? 'success' : 'error');
    setTimeout(() => { setTestStatus('idle'); setTestMessage(''); }, 5000);
  };

  const handleCheckClick = async () => {
    setCheckStatus('checking');
    setCheckResult(null);
    const result = await onCheckPendingRecords();
    setCheckResult({ message: result.message, count: result.count, isError: !result.success });
    setCheckStatus('checked');
  };

  const handleForceSyncClick = async () => {
    setSyncStatus('syncing');
    setSyncResult(null);
    const result = await onForceSync();
    setSyncResult({ message: result.message, success: result.success });
    setSyncStatus('synced');
  };


  return (
    <div>
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Google Sheets Sync</h3>
      <div className="mt-2 space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 1: Firebase Setup</h4>
          <p className="text-xs text-gray-500 mt-1">
            Follow instructions to create a free Realtime Database and get your <strong>URL</strong> and <strong>Secret Key</strong>.
          </p>
        </div>
        
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 2: Deploy Apps Script</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Copy the updated script below into your Google Sheet's Apps Script editor. After pasting, you must **re-deploy** your script (<code className="text-xs bg-gray-200 px-1 rounded">Deploy &gt; New deployment</code>). Set a 1-minute time-driven trigger for the <code className="text-xs bg-gray-200 px-1 rounded">syncFromFirebase</code> function.
          </p>
          <div className="bg-gray-800 p-3 rounded-lg">
             <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-400 font-mono">Firebase Sync Script v11.0</span>
              <button 
                onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
                className={`text-xs px-3 py-1 rounded-md font-bold transition-colors ${copied ? 'bg-green-500 text-white' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
              >
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>
            <pre className="text-[10px] text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono p-2 bg-black/30 rounded-md">
              {appScriptCode.trim()}
            </pre>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 3: Test Integration</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Send a test record to Firebase. It should appear in your sheet **immediately**.
          </p>
          <button onClick={handleTestClick} disabled={testStatus === 'sending'} className="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm shadow-sm hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-wait">
            {testStatus === 'sending' ? 'Sending...' : 'Send Test Record'}
          </button>
          {testMessage && (<p className={`text-xs mt-2 text-center font-semibold animate-in fade-in ${testStatus === 'success' ? 'text-green-700' : 'text-red-700'}`}>{testMessage}</p>)}
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 4: Check Sync Status</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            If records aren't appearing, use this to see if they are stuck in the queue.
          </p>
          <button onClick={handleCheckClick} disabled={checkStatus === 'checking'} className="w-full bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm shadow-sm hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-wait">
            {checkStatus === 'checking' ? 'Checking...' : 'Check Pending Records'}
          </button>
          {checkStatus === 'checked' && checkResult && (
             <div className={`text-xs mt-2 text-center font-bold p-2 rounded-md animate-in fade-in ${checkResult.isError ? 'bg-red-100 text-red-700' : checkResult.count > 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
              {checkResult.isError ? `Error: ${checkResult.message}` : checkResult.count > 0 ? `Warning: ${checkResult.message}` : 'Success! No pending records found.'}
             </div>
          )}
        </div>

        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <h4 className="font-semibold text-yellow-900">Step 5: Manual Sync</h4>
          <p className="text-xs text-yellow-700 mt-1 mb-3">
            If records are pending (from Step 4), use this to manually push all pending records to your Google Sheet.
          </p>
          <button onClick={handleForceSyncClick} disabled={syncStatus === 'syncing'} className="w-full bg-yellow-500 text-yellow-900 font-bold py-2 px-4 rounded-lg transition-colors text-sm shadow-sm hover:bg-yellow-600 disabled:bg-yellow-300 disabled:cursor-wait">
            {syncStatus === 'syncing' ? 'Syncing...' : 'Force Sync Pending Records'}
          </button>
          {syncStatus === 'synced' && syncResult && (
             <div className={`text-xs mt-2 text-center font-bold p-2 rounded-md animate-in fade-in ${!syncResult.success ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800'}`}>
              {syncResult.message}
             </div>
          )}
        </div>

      </div>
    </div>
  );
};

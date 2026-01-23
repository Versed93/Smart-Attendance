
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v9.0)
 * 
 * This version updates the sheet layout to match user specifications.
 * - Dates are now written starting from Column O (O12, P12, etc.).
 * - If the initial range (O:T) is full, it will continue searching for an empty
 *   column up to column AD to write the new session.
 *
 * --- IMPORTANT: SHEET STRUCTURE ---
 * - A tab for attendance (e.g., "W1-W5", "W6-W10", etc.).
 * - Row 12 is where session dates/headers are written.
 * - Column B (column 2) contains Student IDs.
 * - Column D (column 4) contains Student Names.
 * - Student records start from Row 14 downwards.
 * - Attendance status is written in Columns starting from O (column 15).
 * ---
 */

// --- CONFIGURATION ---
var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_YOUR_FIREBASE_URL_HERE'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_YOUR_FIREBASE_SECRET_HERE'}";
// --- END CONFIGURATION ---

function getSheetConfigs() {
  // Define your sheet names and the ranges for attendance.
  // dateRow: The row number where session dates are written (e.g., 12).
  // startCol: The starting column number for attendance (e.g., O is 15).
  // endCol: The last column to check for an empty spot.
  return [
    { name: "W1-W5", dateRow: 12, startCol: 15, endCol: 30 },
    { name: "W6-W10", dateRow: 12, startCol: 15, endCol: 30 },
    { name: "W11-W14", dateRow: 12, startCol: 15, endCol: 30 }
  ];
}

/**
 * NEW: Handles records pushed manually from the web app.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Could not obtain lock." })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var record = JSON.parse(e.postData.contents);
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    
    // Create session header and status with time, similar to the main sync function
    var date = new Date(record.timestamp);
    var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
    var timeStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm");
    
    var sessionHeader = dateStr;
    if (record.courseName && String(record.courseName).trim() !== "") {
        sessionHeader = dateStr + " - " + String(record.courseName).trim();
    }
    
    var statusWithTime = record.status;
    if (record.status === 'P') {
        statusWithTime = "P @ " + timeStr;
    }

    processSingleRecord({
      studentId: record.studentId,
      name: record.name,
      status: statusWithTime,
      sessionHeader: sessionHeader
    }, doc);
    
    // The web app will handle deleting the record from Firebase after getting this success response.
    // However, due to no-cors mode, this response might not be readable by the client.
    // The client assumes success and deletes optimistically.
    return ContentService.createTextOutput(JSON.stringify({ success: true, studentId: record.studentId })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error("doPost Error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: err.toString(), studentId: record.studentId })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}


/**
 * Main sync function for the time-driven trigger.
 */
function syncFromFirebase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log("Could not obtain lock. Another sync may be in progress.");
    return;
  }

  try {
    var pendingDataUrl = FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET;
    var response = UrlFetchApp.fetch(pendingDataUrl, { 'muteHttpExceptions': true });
    var data = JSON.parse(response.getContentText());

    if (!data) {
      console.log("No new attendance data to sync.");
      return;
    }
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var studentIdsToProcess = Object.keys(data);
    var processedKeys = {};

    console.log("Found " + studentIdsToProcess.length + " records to process.");

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

        var statusWithTime = record.status;
        if (record.status === 'P') {
            statusWithTime = "P @ " + timeStr;
        }

        processSingleRecord({
          studentId: record.studentId,
          name: record.name,
          status: statusWithTime,
          sessionHeader: sessionHeader
        }, doc);
        
        processedKeys[studentId] = null;

      } catch (e) {
        console.error("Failed to process record for student " + studentId + ": " + e.toString() + " | Data: " + JSON.stringify(record));
      }
    }
    
    if (Object.keys(processedKeys).length > 0) {
      var deleteOptions = {
        'method': 'PATCH',
        'payload': JSON.stringify(processedKeys),
        'muteHttpExceptions': true
      };
      UrlFetchApp.fetch(pendingDataUrl, deleteOptions);
      console.log("Successfully cleared " + Object.keys(processedKeys).length + " records from Firebase.");
    }
    
  } catch (err) {
    console.error("An error occurred during sync: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

function processSingleRecord(record, doc) {
    var studentId = String(record.studentId || "").toUpperCase().trim();
    var studentName = String(record.name || "").toUpperCase().trim();
    var status = record.status || 'P';
    var sessionHeader = record.sessionHeader;

    if (!studentId) throw "Missing Student ID";

    var configs = getSheetConfigs();
    var targetSheet, targetCol;

    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      var emptyCol = -1;

      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === sessionHeader) {
          targetCol = conf.startCol + c;
          break;
        }
        if (emptyCol === -1 && headerValues[c].trim() === "") {
          emptyCol = conf.startCol + c;
        }
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

    if (!targetSheet) {
      throw "Could not find a suitable sheet to write to based on getSheetConfigs(). Please check your sheet names.";
    }
    
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

    targetSheet.getRange(studentRow, targetCol).setValue(status);
}

function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
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
              <span className="text-xs text-gray-400 font-mono">Firebase Sync Script v9.0</span>
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
            Send a test record to Firebase. It should appear in your sheet within a minute.
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
            If records are pending (from Step 4), and your script trigger seems broken, use this to manually push all pending records to your Google Sheet.
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

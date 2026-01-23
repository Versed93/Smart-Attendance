
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * UTS FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v12.0)
 * 
 * --- TARGET SHEET STRUCTURE ---
 * 1. ID Column: B (Index 2)
 * 2. Name Column: D (Index 4)
 * 3. Attendance Starts: Column O (Index 15)
 * 4. Header Row: 12 (Contains Dates)
 * 5. Data Rows: Start from 14
 * ---
 */

// --- CONFIGURATION ---
var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_YOUR_FIREBASE_URL_HERE'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_YOUR_FIREBASE_SECRET_HERE'}";
// --- END CONFIGURATION ---

function getSheetConfigs() {
  return [
    { name: "W1-W5", dateRow: 12, startCol: 15, endCol: 35 },
    { name: "W6-W10", dateRow: 12, startCol: 15, endCol: 35 },
    { name: "W11-W14", dateRow: 12, startCol: 15, endCol: 35 }
  ];
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Server Busy" })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var data = JSON.parse(e.postData.contents);
    handleBulkRecords(data, "DirectPing");
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error("doPost Error: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function syncFromFirebase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var response = UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, { 'muteHttpExceptions': true });
    var data = JSON.parse(response.getContentText());
    handleBulkRecords(data, "AutoSync");
  } catch (err) {
    console.error("Sync Error: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

function handleBulkRecords(data, source) {
  if (!data || Object.keys(data).length === 0) return;
    
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var studentIds = Object.keys(data);
  var processedKeys = {};

  for (var i = 0; i < studentIds.length; i++) {
    var id = studentIds[i];
    var record = data[id];
    try {
      var date = new Date(record.timestamp);
      var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
      var timeStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm");
      
      // Build the header we are looking for in Row 12
      var headerToFind = dateStr;
      if (record.courseName && record.courseName !== 'General') {
          headerToFind = dateStr + " - " + record.courseName;
      }

      processSingleEntry({
        id: record.studentId,
        name: record.name,
        status: record.status === 'P' ? "P @ " + timeStr : record.status,
        header: headerToFind
      }, doc);
      
      processedKeys[id] = null;
    } catch (e) {
      console.error(source + " Failed for " + id + ": " + e.toString());
    }
  }
  
  // Cleanup Firebase pending queue
  if (Object.keys(processedKeys).length > 0 && source !== "DirectPing") {
    UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, {
      'method': 'PATCH',
      'payload': JSON.stringify(processedKeys),
      'muteHttpExceptions': true
    });
  }
}

function processSingleEntry(item, doc) {
    var studentId = String(item.id || "").toUpperCase().trim();
    var studentName = String(item.name || "").toUpperCase().trim();
    var configs = getSheetConfigs();
    
    var sheet, targetCol;

    // 1. Find the correct Sheet and Column (Row 12)
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var s = doc.getSheetByName(conf.name);
      if (!s) continue;
      
      var headers = s.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      var firstEmpty = -1;

      for (var c = 0; c < headers.length; c++) {
        if (headers[c].trim() === item.header) {
          targetCol = conf.startCol + c;
          break;
        }
        if (firstEmpty === -1 && headers[c].trim() === "") firstEmpty = conf.startCol + c;
      }
      
      if (!targetCol && firstEmpty !== -1) {
        targetCol = firstEmpty;
        s.getRange(conf.dateRow, targetCol).setValue(item.header);
      }
      
      if(targetCol) { sheet = s; break; }
    }

    if (!sheet) throw "Could not find target sheet or valid header column.";
    
    // 2. Find Student Row (Search Column B starting row 14)
    var startRow = 14;
    var lastRow = sheet.getLastRow();
    var studentRow = -1;

    if (lastRow >= startRow) {
      var idValues = sheet.getRange(startRow, 2, lastRow - startRow + 1, 1).getValues();
      for (var r = 0; r < idValues.length; r++) {
        if (String(idValues[r][0]).toUpperCase().trim() === studentId) {
          studentRow = startRow + r;
          break;
        }
      }
    }

    // 3. Append if new student
    if (studentRow === -1) {
       studentRow = Math.max(lastRow + 1, startRow);
       sheet.getRange(studentRow, 2).setValue(studentId); // Column B
       sheet.getRange(studentRow, 4).setValue(studentName); // Column D
    }

    // 4. Set Attendance Status in target column (O onwards)
    sheet.getRange(studentRow, targetCol).setValue(item.status);
}

function doGet(e) {
  return ContentService.createTextOutput("UTS Script v12.0 Active").setMimeType(ContentService.MimeType.TEXT);
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
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Google Sheets Sync (Direct)</h3>
      <div className="mt-2 space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 1: Deploy Updated Script</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Copy this <strong>v12.0</strong> script. In Google Sheets, go to Extensions > Apps Script, paste it, and <strong>IMPORTANT:</strong> Click "Deploy" > "New Deployment" > "Web App" > Set Access to "Anyone".
          </p>
          <div className="bg-gray-800 p-3 rounded-lg">
             <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-400 font-mono">UTS Script v12.0</span>
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
          <h4 className="font-semibold text-gray-800">Step 2: Verify Direct Recording</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Use the test button. If successful, "TEST001" will appear in your sheet immediately.
          </p>
          <button onClick={handleTestClick} disabled={testStatus === 'sending'} className="w-full bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm shadow-sm hover:bg-indigo-700">
            {testStatus === 'sending' ? 'Sending...' : 'Test Direct Sync'}
          </button>
          {testMessage && (<p className={`text-xs mt-2 text-center font-semibold ${testStatus === 'success' ? 'text-green-700' : 'text-red-700'}`}>{testMessage}</p>)}
        </div>
        
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <h4 className="font-semibold text-yellow-900">Step 3: Troubleshooting</h4>
          <p className="text-xs text-yellow-700 mt-1">
             The script searches Column B for IDs. Ensure your Sheet names match ("W1-W5", etc.) and Row 12 contains headers.
          </p>
        </div>
      </div>
    </div>
  );
};

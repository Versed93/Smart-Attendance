
import React, { useState } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * UTS FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v28.1)
 * Robust data mapping to ensure data integrity.
 * By Ten Tat Jian
 */

// --- CONFIGURATION ---
// Adjust these values to match your Google Sheet layout.
var CONFIG = {
  // The sheet to use. It will find the first sheet with this string in its name.
  // If not found, it will use the very first sheet in the file.
  sheetNameIdentifier: "W",

  // The row number where your session dates are (e.g., "25/07/2024 - Course Name")
  sessionHeaderRow: 12,

  // The first row that contains student data (should be below all headers)
  firstDataRow: 14,

  // The column number for Student ID (A=1, B=2, C=3, ...)
  studentIdCol: 2,

  // The column number for Student Full Name
  studentNameCol: 4,
  
  // The first column where session attendance data should be recorded
  firstSessionCol: 17 // Column Q
};
// --- END CONFIGURATION ---

var FIREBASE_URL = "${(FIREBASE_CONFIG.DATABASE_URL || 'PASTE_URL').replace(/\/+$/, '')}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_SECRET'}";

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error:"Script is busy. Please try again."})).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === "SYNC_QUEUE") {
      syncFromFirebase();
    } else {
      handleBulkRecords(data, "Direct");
    }
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log(err);
    return ContentService.createTextOutput(JSON.stringify({error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function syncFromFirebase() {
  var response = UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, { muteHttpExceptions: true });
  var responseCode = response.getResponseCode();
  if (responseCode === 200) {
    var data = JSON.parse(response.getContentText());
    if (data) {
      handleBulkRecords(data, "Auto");
    }
  } else {
    Logger.log("Failed to fetch from Firebase. Response code: " + responseCode);
  }
}

function handleBulkRecords(data, source) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var studentIds = Object.keys(data);
  var recordsToDelete = {};

  if (studentIds.length === 0) return;

  for (var i = 0; i < studentIds.length; i++) {
    var studentId = studentIds[i];
    var record = data[studentId];
    
    var status = record.status;
    if (record.absenceReason) {
      status += " (" + record.absenceReason + ")";
    }
    
    var date = new Date(record.timestamp);
    var header = Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
    if (record.courseName && record.courseName.toLowerCase() !== 'general session') {
      header += " - " + record.courseName;
    }
    
    var item = {
      id: record.studentId,
      name: record.name,
      status: status,
      header: header
    };
    
    processEntry(item, doc);
    recordsToDelete[studentId] = null;
  }

  if (source === "Auto" && Object.keys(recordsToDelete).length > 0) {
    UrlFetchApp.fetch(FIREBASE_URL + '/pending.json?auth=' + FIREBASE_SECRET, {
      method: 'PATCH',
      contentType: 'application/json',
      payload: JSON.stringify(recordsToDelete)
    });
  }
}

function processEntry(item, doc) {
  var sheet = doc.getSheets().find(function(s) { 
    return s.getName().indexOf(CONFIG.sheetNameIdentifier) !== -1;
  }) || doc.getSheets()[0];

  var sessionHeadersRange = sheet.getRange(CONFIG.sessionHeaderRow, CONFIG.firstSessionCol, 1, sheet.getLastColumn() - CONFIG.firstSessionCol + 1);
  var sessionHeaders = sessionHeadersRange.getValues()[0];
  var sessionCol = -1;

  var colIndex = sessionHeaders.indexOf(item.header);
  if (colIndex !== -1) {
    sessionCol = CONFIG.firstSessionCol + colIndex;
  } else {
    var lastColWithContent = sessionHeadersRange.getLastColumn();
    var nextCol = sheet.getRange(CONFIG.sessionHeaderRow, lastColWithContent).getValue() ? lastColWithContent + 1 : lastColWithContent;
    if(nextCol < CONFIG.firstSessionCol) nextCol = CONFIG.firstSessionCol;
    sheet.getRange(CONFIG.sessionHeaderRow, nextCol).setValue(item.header);
    sessionCol = nextCol;
  }

  var idColumnValues = sheet.getRange(CONFIG.firstDataRow, CONFIG.studentIdCol, sheet.getLastRow() - CONFIG.firstDataRow + 1, 1).getValues();
  var studentRow = -1;
  for (var i = 0; i < idColumnValues.length; i++) {
    if (String(idColumnValues[i][0]).toUpperCase().trim() === item.id.toUpperCase().trim()) {
      studentRow = CONFIG.firstDataRow + i;
      break;
    }
  }

  if (studentRow === -1) {
    studentRow = sheet.getLastRow() + 1;
    sheet.getRange(studentRow, CONFIG.studentIdCol).setValue(item.id);
    sheet.getRange(studentRow, CONFIG.studentNameCol).setValue(item.name);
  }

  if (studentRow > 0 && sessionCol > 0) {
    sheet.getRange(studentRow, sessionCol).setValue(item.status);
  } else {
    Logger.log("Failed to write status for " + item.id + ". Invalid row or column.");
  }
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
        <h4 className="text-xs font-black text-gray-900 uppercase tracking-widest">Apps Script v28.1</h4>
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
          V28.1 REQUIRED: This new script is configurable and more robust. Please update your Google Sheet Web App.
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

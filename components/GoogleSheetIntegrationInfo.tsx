
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v5.0)
 * 
 * SETUP INSTRUCTIONS:
 * 1. Paste this code into Extensions > Apps Script.
 * 2. Fill in your Firebase URL and Secret Key below.
 * 3. Save the script.
 * 4. In the Apps Script editor, go to Triggers (clock icon on the left).
 * 5. Click "Add Trigger".
 * 6. Choose function "syncFromFirebase", deployment "Head", event source "Time-driven", type "Minutes timer", every "1 minute".
 * 7. Click Save. The script will now automatically sync data every minute.
 * 8. For one-time sync, you can run the syncFromFirebase function manually from the editor.
 */

// --- CONFIGURATION ---
var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_YOUR_FIREBASE_URL_HERE'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_YOUR_FIREBASE_SECRET_HERE'}";
// --- END CONFIGURATION ---

function getSheetConfigs() {
  return [{ name: "W6-W10", dateRow: 12, startCol: 13, endCol: 20 }];
}

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
        
        processSingleRecord({
          studentId: record.studentId,
          name: record.name,
          status: record.status,
          dateStr: dateStr
        }, doc);
        
        // Mark as processed for deletion
        processedKeys[studentId] = null;

      } catch (e) {
        console.error("Failed to process record for student " + studentId + ": " + e.toString());
      }
    }
    
    // Clear processed records from Firebase
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
    var dateStr = record.dateStr;

    if (!studentId) throw "Missing Student ID";

    var configs = getSheetConfigs();
    var targetSheet, targetCol;

    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) sheet = doc.insertSheet(conf.name);
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      var emptyCol = -1;

      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) {
          targetCol = conf.startCol + c;
          break;
        }
        if (emptyCol === -1 && headerValues[c].trim() === "") {
          emptyCol = conf.startCol + c;
        }
      }
      
      if (!targetCol && emptyCol !== -1) {
        targetCol = emptyCol;
        sheet.getRange(conf.dateRow, targetCol).setValue(dateStr);
      }
      
      if(targetCol) {
        targetSheet = sheet;
        break;
      }
    }

    if (!targetSheet) throw "Week range (M-T) is full.";

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
       targetSheet.getRange(studentRow, 2).setValue(studentId); // Col B
       targetSheet.getRange(studentRow, 4).setValue(studentName); // Col D
    }

    targetSheet.getRange(studentRow, targetCol).setValue(status);
}

// doGet still useful for teacher view to pull initial list
function doGet(e) {
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName("W6-W10");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 14) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    
    var studentData = sheet.getRange(14, 2, lastRow - 13, 3).getValues(); // ID, blank, Name
    var attValues = sheet.getRange(14, 13, lastRow - 13, 8).getValues(); // M-T
    var headers = sheet.getRange(12, 13, 1, 8).getDisplayValues()[0];

    var results = [];
    for (var r = 0; r < studentData.length; r++) {
      var sId = String(studentData[r][0]).trim();
      var sName = studentData[r][2];
      if (sId) {
         for (var c = 0; c < headers.length; c++) {
            if (headers[c] && attValues[r][c]) {
                results.push({ studentId: sId, name: sName, status: attValues[r][c], date: headers[c] });
            }
         }
      }
    }
    return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }
}
`;

export const GoogleSheetIntegrationInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Google Sheets Sync</h3>
      <div className="mt-2 space-y-4">
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 1: Firebase Setup</h4>
          <p className="text-xs text-gray-500 mt-1">
            This app uses a high-speed cloud database (Firebase) for instant check-ins. Follow the instructions in the docs to create a free Realtime Database and get your <strong>URL</strong> and <strong>Secret Key</strong>.
          </p>
        </div>
        
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="font-semibold text-gray-800">Step 2: Deploy Apps Script</h4>
          <p className="text-xs text-gray-500 mt-1 mb-3">
            Copy this script into your Google Sheet's Apps Script editor (<code className="text-xs bg-gray-200 px-1 rounded">Extensions &gt; Apps Script</code>). Paste your Firebase credentials into the configuration section, then set a 1-minute time-driven trigger for the <code className="text-xs bg-gray-200 px-1 rounded">syncFromFirebase</code> function.
          </p>
          <div className="bg-gray-800 p-3 rounded-lg">
             <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-gray-400 font-mono">Firebase Sync Script v5.0</span>
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
      </div>
    </div>
  );
};

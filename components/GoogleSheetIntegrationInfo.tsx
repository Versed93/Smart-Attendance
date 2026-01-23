
import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';
import { FIREBASE_CONFIG } from '../firebaseConfig';

const appScriptCode = `
/**
 * FIREBASE TO GOOGLE SHEETS SYNC SCRIPT (v7.0)
 * 
 * This version adds more detail to the attendance log (includes timestamp)
 * and supports multiple sheet tabs for different weeks of the semester.
 * 
 * --- IMPORTANT: SHEET STRUCTURE ---
 * This script assumes your Google Sheet has a specific layout:
 * - A tab for attendance (e.g., "W1-W5", "W6-W10", etc. as defined in getSheetConfigs).
 * - Row 12 is where the session dates/headers are written.
 * - Column B (column 2) contains Student IDs.
 * - Column D (column 4) contains Student Names.
 * - Student records start from Row 14 downwards.
 * - Attendance status is written in Columns M through T (13-20).
 * 
 * Please verify this structure matches your sheet or adjust the getSheetConfigs() function below.
 * --- END: SHEET STRUCTURE ---
 * 
 * SETUP INSTRUCTIONS:
 * 1. Paste this code into Extensions > Apps Script.
 * 2. Fill in your Firebase URL and Secret Key below.
 * 3. Review and adjust getSheetConfigs() to match your sheet names.
 * 4. Save the script.
 * 5. Set up a time-driven trigger to run syncFromFirebase every 1 minute.
 */

// --- CONFIGURATION ---
var FIREBASE_URL = "${FIREBASE_CONFIG.DATABASE_URL || 'PASTE_YOUR_FIREBASE_URL_HERE'}";
var FIREBASE_SECRET = "${FIREBASE_CONFIG.DATABASE_SECRET || 'PASTE_YOUR_FIREBASE_SECRET_HERE'}";
// --- END CONFIGURATION ---

function getSheetConfigs() {
  // Add or edit sheet names to match your Google Sheets document.
  // The script will search these sheets in order to find where to log attendance.
  return [
    { name: "W1-W5", dateRow: 12, startCol: 13, endCol: 20 },
    { name: "W6-W10", dateRow: 12, startCol: 13, endCol: 20 },
    { name: "W11-W14", dateRow: 12, startCol: 13, endCol: 20 }
  ];
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
        var timeStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm");
        
        var sessionHeader = dateStr;
        if (record.courseName && String(record.courseName).trim() !== "") {
            sessionHeader = dateStr + " - " + String(record.courseName).trim();
        }

        // Add timestamp to the status for more detailed logging
        var statusWithTime = record.status;
        if (record.status === 'P') {
            statusWithTime = "P @ " + timeStr;
        }

        processSingleRecord({
          studentId: record.studentId,
          name: record.name,
          status: statusWithTime, // Pass status with time
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

    // Find the correct sheet and column for the current session
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue; // Skip if sheet doesn't exist
      
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
      
      // If header not found, create it in the first empty column
      if (!targetCol && emptyCol !== -1) {
        targetCol = emptyCol;
        sheet.getRange(conf.dateRow, targetCol).setValue(sessionHeader);
      }
      
      if(targetCol) {
        targetSheet = sheet;
        break; // Found our target, exit loop
      }
    }

    if (!targetSheet) {
      // If no sheet was found after checking all configs, stop to avoid errors.
      throw "Could not find a suitable sheet to write to based on getSheetConfigs(). Please check your sheet names.";
    }
    
    var startRow = 14;
    var lastRow = targetSheet.getLastRow();
    var studentRow = -1;

    // Find student row by ID for efficiency
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

    // If student not found, add a new row
    if (studentRow === -1) {
       studentRow = Math.max(lastRow + 1, startRow);
       targetSheet.getRange(studentRow, 2).setValue(studentId); // Col B
       targetSheet.getRange(studentRow, 4).setValue(studentName); // Col D
    }

    // Write the attendance status
    targetSheet.getRange(studentRow, targetCol).setValue(status);
}

// doGet still useful for teacher view to pull initial list
function doGet(e) {
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    // This part is for fetching data for other purposes and might not be used by the main app.
    // It is kept for compatibility.
    var sheet = doc.getSheetByName("W6-W10"); // Checks a default sheet
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
              <span className="text-xs text-gray-400 font-mono">Firebase Sync Script v7.0</span>
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

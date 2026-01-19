import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

const appScriptCode = `
/**
 * HIGH-CONCURRENCY ATTENDANCE SCRIPT (v3.8 - W6-W10 Robust)
 * 
 * SETUP INSTRUCTIONS:
 * 1. Paste this code into Extensions > Apps Script
 * 2. Save
 * 3. Deploy > New Deployment > Select "Web App"
 * 4. Execute as: "Me"
 * 5. Who has access: "Anyone"
 * 6. Copy the new URL and paste it into the App Settings.
 */

function getFormattedDate(d) {
  var date = d || new Date();
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function getSheetConfigs() {
  // CONFIGURATION: W6-W10
  // M is column 13, T is column 20
  return [
    { name: "W6-W10", dateRow: 12, startCol: 13, endCol: 20 }
  ];
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var data = {};
    
    try {
      if (e.postData && e.postData.contents) {
        data = JSON.parse(e.postData.contents);
      } else if (e.parameter) {
        data = e.parameter;
      }
    } catch(parseErr) {
      return ContentService.createTextOutput(JSON.stringify({result: "error", message: "Invalid JSON"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var studentId = String(data.studentId || "").toUpperCase().trim();
    var studentName = String(data.name || "").toUpperCase().trim();
    var status = data.status || 'P';
    var dateStr = data.customDate || getFormattedDate();

    if (!studentId) throw "Missing Student ID";

    var configs = getSheetConfigs();
    var targetSheet, targetCol;

    // 1. Locate the correct sheet and column (M12:T12)
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      // Get headers in Row 12, Cols M(13) to T(20)
      var range = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1);
      var headerValues = range.getDisplayValues()[0];
      
      // Try to find existing date
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) {
          targetSheet = sheet;
          targetCol = conf.startCol + c;
          break;
        }
      }
      
      // If not found, find first empty slot
      if (!targetCol) {
        for (var c = 0; c < headerValues.length; c++) {
          if (headerValues[c].trim() === "") {
            targetSheet = sheet;
            targetCol = conf.startCol + c;
            // Write the date immediately to reserve it
            sheet.getRange(conf.dateRow, targetCol).setNumberFormat("@").setValue(dateStr);
            break;
          }
        }
      }
      if (targetSheet) break;
    }

    if (!targetSheet) throw "Sheet 'W6-W10' not found or week range (M-T) is full.";

    // 2. Find Student Row in Column B (Index 2), rows 14 to 224+
    var startRow = 14;
    var lastRow = Math.max(targetSheet.getLastRow(), 224);
    // Read Student IDs from Column B
    var idRange = targetSheet.getRange(startRow, 2, lastRow - startRow + 1, 1);
    var ids = idRange.getDisplayValues(); // Use DisplayValues for better text matching
    
    var studentRowAbs = -1;
    for (var r = 0; r < ids.length; r++) {
      var idInCell = String(ids[r][0]).toUpperCase().trim();
      if (idInCell === studentId) {
        studentRowAbs = startRow + r;
        break;
      }
    }

    // 3. If student not found, append to the end of the list? 
    // Or strictly rely on pre-filled list. 
    // If not found, we will append to avoid data loss, but typically should match.
    if (studentRowAbs === -1) {
       studentRowAbs = lastRow + 1;
       targetSheet.getRange(studentRowAbs, 2).setValue(studentId); // Col B
       targetSheet.getRange(studentRowAbs, 4).setValue(studentName); // Col D
    }

    // 4. Write Status
    targetSheet.getRange(studentRowAbs, targetCol).setValue(status);
    
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({result: "success"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({result: "error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // Returns ALL attendance data for the current sheet to ensure frontend stays in sync
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var configs = getSheetConfigs();
    var results = [];
    
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var lastRow = Math.max(sheet.getLastRow(), 224);
      
      // Get Student Data (B14:D)
      var studentData = sheet.getRange(14, 2, lastRow - 14 + 1, 3).getValues(); // B, C, D
      
      // Get Attendance Data (M14:T)
      var attRange = sheet.getRange(14, conf.startCol, lastRow - 14 + 1, conf.endCol - conf.startCol + 1);
      var attValues = attRange.getValues();
      var headers = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];

      // Flatten data
      for (var r = 0; r < studentData.length; r++) {
        var sId = String(studentData[r][0]).trim();
        var sName = studentData[r][2];
        if (!sId) continue;

        // Check each date column
        for (var c = 0; c < headers.length; c++) {
          var date = headers[c];
          var status = attValues[r][c];
          if (date && (status === 'P' || status === 'A')) {
             results.push({ 
               studentId: sId, 
               name: sName, 
               status: status,
               date: date 
             });
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

  const handleDownloadTemplate = () => {
    // Generate CSV to mimic the W6-W10 structure
    // Padding rows 1-11
    const csvRows = [];
    for (let i = 0; i < 11; i++) {
        csvRows.push(new Array(20).fill("").join(","));
    }

    // Row 12: Dates start at Col M (Index 12)
    const row12 = new Array(13).fill(""); 
    row12[12] = "DATE_PLACEHOLDER"; // M12
    csvRows.push(row12.join(","));

    // Row 13: Headers
    const row13 = new Array(13).fill("");
    row13[1] = "STUDENT ID"; // B
    row13[3] = "STUDENT NAME"; // D
    csvRows.push(row13.join(","));

    // Row 14+: Data
    PRE_REGISTERED_STUDENTS.forEach(student => {
        const row = new Array(13).fill("");
        row[1] = `"${student.id}"`;
        row[3] = `"${student.name.replace(/"/g, '""')}"`;
        csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "W6-W10_Layout_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 mb-4 shadow-sm">
      <div className="flex items-start gap-3">
        <InfoIcon className="w-6 h-6 mt-1 text-blue-600" />
        <div className="flex-1">
          <h3 className="text-lg font-bold text-blue-900">Google Sheets Integration Setup</h3>
          
          <div className="mt-4 mb-6 bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
             <div className="flex items-center gap-2 mb-2">
                 <div className="bg-green-100 text-green-700 p-1 rounded-lg">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                 </div>
                 <h4 className="text-sm font-bold text-gray-800">Target Layout: W6-W10</h4>
             </div>
             <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                This script is configured for the <strong>W6-W10</strong> sheet.
                <br/>• Student IDs: <strong>Column B</strong> (Row 14+)
                <br/>• Attendance Dates: <strong>Row 12</strong> (Columns M-T)
             </p>
             <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <button 
                    onClick={handleDownloadTemplate}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm active:scale-95"
                >
                    <DownloadIcon className="w-4 h-4" />
                    Download Layout (.csv)
                </button>
             </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
             <div className="bg-indigo-100 text-indigo-700 p-1 rounded-lg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
             </div>
             <h4 className="text-sm font-bold text-gray-800">Step 2: Update Apps Script (Important!)</h4>
          </div>
          <div className="mt-4 bg-gray-900 p-4 rounded-xl border border-blue-200">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase">APPS SCRIPT V3.8 (W6-W10)</span>
              <button 
                onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
                className={`text-xs px-4 py-1.5 rounded-full font-bold transition-all ${copied ? 'bg-green-600 text-white' : 'bg-brand-primary text-white hover:bg-brand-secondary'}`}
              >
                {copied ? '✓ COPIED' : 'COPY CODE'}
              </button>
            </div>
            <pre className="text-[9px] text-gray-400 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono p-2 bg-black/30 rounded">
              {appScriptCode.trim()}
            </pre>
          </div>
          <p className="mt-3 text-[11px] text-blue-600 italic">
            * After copying, remember to click "Deploy &gt; New Deployment" (Web App, Anyone) and update the URL above.
          </p>
        </div>
      </div>
    </div>
  );
};
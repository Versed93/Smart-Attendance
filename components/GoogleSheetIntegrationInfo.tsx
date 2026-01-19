import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { PRE_REGISTERED_STUDENTS } from '../studentList';

const appScriptCode = `
/**
 * HIGH-CONCURRENCY ATTENDANCE SCRIPT (v3.7 - Layout W6-W10)
 * Optimized for layout:
 * - Sheet: "W6-W10"
 * - Date Header: Row 12 (Cols M-T)
 * - Student IDs: Col B (Row 14+)
 * - Data Area: Cols M-T (Row 14+)
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
    
    // Robust parsing for text/plain payloads
    try {
      if (e.postData && e.postData.contents) {
        data = JSON.parse(e.postData.contents);
      } else if (e.parameter) {
        data = e.parameter;
      }
    } catch(parseErr) {
      console.error("JSON Parse Error: " + parseErr);
      return ContentService.createTextOutput(JSON.stringify({result: "error", message: "Invalid JSON format"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    var studentId = String(data.studentId || "").toUpperCase().trim();
    var studentName = String(data.name || "").toUpperCase().trim();
    var status = data.status || 'P';
    
    var providedDateStr = data.customDate || "";
    var dateStr = providedDateStr ? providedDateStr : getFormattedDate();

    if (!studentId) throw "Missing Student ID";

    var configs = getSheetConfigs();
    var targetSheet, targetCol, isNewDate = true;

    // PASS 1: Check if date exists in M12:T12
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) {
          targetSheet = sheet;
          targetCol = conf.startCol + c;
          isNewDate = false;
          break;
        }
      }
      if (targetSheet) break;
    }

    // PASS 2: Find first empty column in M12:T12
    if (!targetSheet) {
      for (var i = 0; i < configs.length; i++) {
        var conf = configs[i];
        var sheet = doc.getSheetByName(conf.name);
        if (!sheet) continue;
        
        var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
        
        for (var c = 0; c < headerValues.length; c++) {
          if (headerValues[c].trim() === "") {
            targetSheet = sheet;
            targetCol = conf.startCol + c;
            break;
          }
        }
        if (targetSheet) break;
      }
    }

    if (!targetSheet) throw "Sheet 'W6-W10' not found or range M12:T12 is full.";

    if (isNewDate) {
      // Write new date to Row 12
      targetSheet.getRange(12, targetCol).setValue(dateStr).setNumberFormat("@");
    }

    // 3. Find Student Row in Column B (Index 2), starting Row 14
    var startRow = 14;
    var lastRow = Math.max(targetSheet.getLastRow(), 224); // Ensure we cover the range up to 224
    var ids = targetSheet.getRange(startRow, 2, lastRow - startRow + 1, 1).getValues();
    
    var studentRowAbs = -1;
    for (var r = 0; r < ids.length; r++) {
      var idInCell = String(ids[r][0]).toUpperCase().trim();
      if (idInCell === studentId) {
        studentRowAbs = startRow + r;
        break;
      }
      // Optional: Add student if empty slot found
      if (studentRowAbs === -1 && idInCell === "") {
        studentRowAbs = startRow + r;
        targetSheet.getRange(studentRowAbs, 2, 1, 3).setValues([[studentId, "", studentName]]); // B=ID, D=Name
        break;
      }
    }

    if (studentRowAbs === -1) {
       studentRowAbs = lastRow + 1;
       targetSheet.getRange(studentRowAbs, 2).setValue(studentId);
       targetSheet.getRange(studentRowAbs, 4).setValue(studentName);
    }

    // 4. Mark Status in the target column
    targetSheet.getRange(studentRowAbs, targetCol).setValue(status);
    
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({result: "success"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    console.error("Attendance Error: " + err);
    return ContentService.createTextOutput(JSON.stringify({result: "error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  // Read-only endpoint for refreshing client list
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var dateStr = getFormattedDate();
    var configs = getSheetConfigs();
    
    for (var i = 0; i < configs.length; i++) {
      var conf = configs[i];
      var sheet = doc.getSheetByName(conf.name);
      if (!sheet) continue;
      
      var headerValues = sheet.getRange(conf.dateRow, conf.startCol, 1, conf.endCol - conf.startCol + 1).getDisplayValues()[0];
      var colIdx = -1;
      for (var c = 0; c < headerValues.length; c++) {
        if (headerValues[c].trim() === dateStr) { colIdx = conf.startCol + c; break; }
      }
      
      if (colIdx !== -1) {
        var lastRow = Math.max(sheet.getLastRow(), 224);
        var data = sheet.getRange(14, 2, lastRow - 14 + 1, 3).getValues(); // Cols B(2) to D(4)
        var statuses = sheet.getRange(14, colIdx, lastRow - 14 + 1, 1).getValues();
        
        var results = [];
        for (var j = 0; j < data.length; j++) {
          var id = String(data[j][0]).trim();
          var stat = statuses[j][0];
          if (id && (stat === 'P' || stat === 'A')) {
            results.push({ studentId: id, name: data[j][2], status: stat });
          }
        }
        return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
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
             <h4 className="text-sm font-bold text-gray-800">Step 2: Update Apps Script</h4>
          </div>
          <div className="mt-4 bg-gray-900 p-4 rounded-xl border border-blue-200">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase">APPS SCRIPT V3.7 (W6-W10)</span>
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
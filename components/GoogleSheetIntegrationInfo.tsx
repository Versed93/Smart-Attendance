import React, { useState } from 'react';
import { InfoIcon } from './icons/InfoIcon';

const appScriptCode = `
// --- CONFIGURATION ---
// Sheet Name: "W1-W5"
// Date Header Row: 12 (E.g. Cell O12:P12 is one date)
// Student Data Starts: Row 14 (ID in Col B, Name in Col D)
// Status Area: Columns O to T (Rows 14-225+)

function getFormattedDate() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
    
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = doc.getSheetByName("W1-W5"); 
    if (!sheet) sheet = doc.getSheets()[0];

    var data = {};
    if (e.parameter && e.parameter.studentId) {
      data = e.parameter;
    } else {
      try {
        if (e.postData) data = JSON.parse(e.postData.contents);
      } catch(err){}
    }
    
    var studentId = data.studentId ? data.studentId.toUpperCase().trim() : "";
    var studentName = data.name ? data.name.toUpperCase().trim() : "";
    var status = data.status || 'P';
    var dateStr = getFormattedDate();

    if (!studentId) {
      return ContentService.createTextOutput(JSON.stringify({"result":"error", "message":"Missing Data"})).setMimeType(ContentService.MimeType.JSON);
    }

    // --- 1. FIND DATE COLUMN (O-T) ---
    var dateHeaderRow = 12;
    var dateStartCol = 15; // Column O
    var maxDateCols = 6;   // Columns O, P, Q, R, S, T
    
    var targetColAbs = -1;

    // Pass 1: Look for existing date matches
    for (var i = 0; i < maxDateCols; i++) {
       var col = dateStartCol + i;
       var cell = sheet.getRange(dateHeaderRow, col);
       
       if (cell.isPartOfMerge()) {
          var range = cell.getMergedRanges()[0];
          if (range.getColumn() != col || range.getRow() != dateHeaderRow) {
             continue; 
          }
       }

       var val = cell.getDisplayValue().trim();
       if (val == dateStr) {
         targetColAbs = col;
         break;
       }
    }

    // Pass 2: If no match, find first EMPTY slot
    if (targetColAbs == -1) {
      for (var i = 0; i < maxDateCols; i++) {
        var col = dateStartCol + i;
        var cell = sheet.getRange(dateHeaderRow, col);
        
        if (cell.isPartOfMerge()) {
           var range = cell.getMergedRanges()[0];
           if (range.getColumn() != col || range.getRow() != dateHeaderRow) {
              continue; // Skip secondary merge cells
           }
        }

        var val = cell.getDisplayValue().trim();
        if (val == "") {
           targetColAbs = col;
           // Set a standard Date object and enforce the number format.
           // This prevents mismatches between what is written and what is read back.
           cell.setValue(new Date()).setNumberFormat("dd/MM/yyyy");
           break;
        }
      }
    }

    if (targetColAbs == -1) {
      return ContentService.createTextOutput(JSON.stringify({"result":"error", "message":"No space left in columns O-T"})).setMimeType(ContentService.MimeType.JSON);
    }

    // --- 2. FIND STUDENT ROW (B14+) ---
    var startRow = 14;
    var idCol = 2; // Column B
    var nameCol = 4; // Column D
    
    // Scan B14 down to B250 or last row
    var lastSheetRow = Math.max(sheet.getLastRow(), 250);
    var checkRows = lastSheetRow - startRow + 1; 
    var idRange = sheet.getRange(startRow, idCol, checkRows, 1);
    var idValues = idRange.getValues();
    
    var studentRowRelative = -1;
    var firstEmptyRowRelative = -1;

    for (var i = 0; i < idValues.length; i++) {
      var val = String(idValues[i][0]).toUpperCase().trim();
      if (val == studentId) {
        studentRowRelative = i;
        break;
      }
      if (val == "" && firstEmptyRowRelative == -1) {
        firstEmptyRowRelative = i;
      }
    }

    // Create New Student if not found
    if (studentRowRelative == -1) {
      if (firstEmptyRowRelative != -1) {
        studentRowRelative = firstEmptyRowRelative;
      } else {
        studentRowRelative = idValues.length; // Append
      }

      var newRowAbs = startRow + studentRowRelative;
      sheet.getRange(newRowAbs, idCol).setValue(studentId);   // Write to B
      sheet.getRange(newRowAbs, nameCol).setValue(studentName); // Write to D
    }

    // --- 3. WRITE STATUS ---
    var targetRowAbs = startRow + studentRowRelative;
    // Write to the main column found (e.g. O). If O:P is merged, writing to O fills the block.
    sheet.getRange(targetRowAbs, targetColAbs).setValue(status);
    
    SpreadsheetApp.flush(); 
    return ContentService.createTextOutput(JSON.stringify({"result":"success"})).setMimeType(ContentService.MimeType.JSON);
    
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({"result":"error", "message": e.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var doc = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = doc.getSheetByName("W1-W5");
  if (!sheet) sheet = doc.getSheets()[0];

  var dateStr = getFormattedDate();
  
  var dateHeaderRow = 12;
  var dateStartCol = 15; // O
  var maxDateCols = 6;   // O-T

  var dateColAbs = -1;
  for (var i = 0; i < maxDateCols; i++) {
     var col = dateStartCol + i;
     var cell = sheet.getRange(dateHeaderRow, col);
     
     if (cell.isPartOfMerge()) {
        var range = cell.getMergedRanges()[0];
        if (range.getColumn() != col || range.getRow() != dateHeaderRow) continue;
     }

     if (cell.getDisplayValue().trim() == dateStr) {
       dateColAbs = col;
       break;
     }
  }

  if (dateColAbs == -1) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);

  // Read Data (B=ID, D=Name, TargetCol=Status)
  var startRow = 14;
  var lastRow = Math.max(sheet.getLastRow(), 250); 
  
  // Read B, C, D (Cols 2, 3, 4)
  var studentBlock = sheet.getRange(startRow, 2, lastRow - startRow + 1, 3).getValues(); 
  
  // Read Status Column
  var statusBlock = sheet.getRange(startRow, dateColAbs, lastRow - startRow + 1, 1).getValues();

  var output = [];
  for (var i = 0; i < studentBlock.length; i++) {
    var id = String(studentBlock[i][0]).trim(); // Column B
    var name = studentBlock[i][2]; // Column D
    var status = statusBlock[i][0];

    if (id && (status == 'P' || status == 'A')) {
      output.push({
         name: name,
         studentId: id,
         email: id + "@STUDENT.UTS.EDU.MY",
         timestamp: new Date().getTime(), 
         status: status
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}
`;

export const GoogleSheetIntegrationInfo: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(appScriptCode.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full p-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 mb-4">
      <div className="flex items-start gap-3">
        <InfoIcon className="w-5 h-5 flex-shrink-0 mt-1 text-blue-500" />
        <div>
          <h3 className="text-lg font-semibold text-blue-900">Update Cloud Storage Script</h3>
          <p className="mt-1 text-sm">
            This update fixes an issue where attendance was sometimes recorded in a new column on the same day. The script is now more reliable at finding the correct date column.
          </p>
          <ul className="list-disc list-inside mt-2 text-sm space-y-1">
            <li><strong>Headers:</strong> Row 12 (Merges supported, e.g., O12:P12).</li>
            <li><strong>IDs/Names:</strong> Rows 14+ (Column B & D).</li>
            <li><strong>Status:</strong> Writes to O14:P225+ range (or Q:R for next date).</li>
            <li><strong>Limits:</strong> Strictly columns O through T only.</li>
          </ul>
          <div className="mt-4 bg-gray-800 text-white p-3 rounded-md relative">
             <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-gray-300">Script Code:</h4>
                <button 
                     onClick={handleCopy}
                     className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-white transition-colors border border-gray-600"
                     title="Copy to clipboard"
                >
                    {copied ? 'Copied!' : 'Copy Code'}
                </button>
             </div>
            <pre className="text-xs whitespace-pre-wrap break-all p-2 bg-gray-900 rounded border border-gray-700 max-h-60 overflow-y-auto">
              <code>{appScriptCode.trim()}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
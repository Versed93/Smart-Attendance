import React, { useState, useEffect } from 'react';
import { FIREBASE_CONFIG } from '../firebaseConfig';

interface CloudIntegrationSettingsProps {
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  onSendTestRecord: () => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onClearPendingQueue: () => Promise<{ success: boolean; message: string }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
  selectedWeek?: string;
  integrationType?: 'google_sheets' | 'airtable' | 'firebase';
  onIntegrationTypeChange?: (type: 'google_sheets' | 'airtable' | 'firebase') => void;
}

export const CloudIntegrationSettings: React.FC<CloudIntegrationSettingsProps> = ({ 
  scriptUrl, 
  onScriptUrlChange, 
  onSendTestRecord, 
  onCheckPendingRecords, 
  onClearPendingQueue,
  onForceSync,
  selectedWeek = 'W7',
  integrationType: propIntegrationType,
  onIntegrationTypeChange,
}) => {
  const [localIntegrationType, setLocalIntegrationType] = useState<'google_sheets' | 'airtable' | 'firebase'>(() => {
      return (localStorage.getItem('attendance-integration-type') as 'google_sheets' | 'airtable' | 'firebase') || 'google_sheets';
  });
  const integrationType = propIntegrationType ?? localIntegrationType;
  const setIntegrationType = (next: 'google_sheets' | 'airtable' | 'firebase') => {
      setLocalIntegrationType(next);
      localStorage.setItem('attendance-integration-type', next);
      onIntegrationTypeChange?.(next);
  };

  const [airtableToken, setAirtableToken] = useState(() => localStorage.getItem('airtable-token') || '');
  const [airtableBaseId, setAirtableBaseId] = useState(() => localStorage.getItem('airtable-base-id') || '');
  const [airtableTableName, setAirtableTableName] = useState(() => localStorage.getItem('airtable-table-name') || 'Attendance');

  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);

  const appScriptCode = `function doGet(e) {
  try {
    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = doc.getSheets();
    var requestedCourse = (e && e.parameter && e.parameter.course) ? String(e.parameter.course).trim().toUpperCase() : "";
    var sheetCourses = [];
    var primaryCourse = "";
    var primaryStudents = [];
    var matchedStudents = null;

    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var b1Range = sheet.getRange("B1");
      var b1Val = String(b1Range.getDisplayValue() || "").trim();
      if (!b1Val && b1Range.isPartOfMerge()) {
        var merged = b1Range.getMergedRanges();
        if (merged && merged.length > 0) {
          b1Val = String(merged[0].getCell(1, 1).getDisplayValue() || "").trim();
        }
      }

      // Read students starting from Row 4 (B4+ = Name, C4+ = Student ID)
      var lastRow = sheet.getLastRow();
      var students = [];
      if (lastRow >= 4) {
        var rows = sheet.getRange(4, 2, lastRow - 3, 2).getDisplayValues();
        for (var r = 0; r < rows.length; r++) {
          var sName = String(rows[r][0] || "").trim().toUpperCase();
          var sId = String(rows[r][1] || "").trim().toUpperCase();
          if (sName && sId && sId !== "TEST999" && sName !== "CONNECTION TEST") {
            students.push({ id: sId, name: sName });
          }
        }
      }

      sheetCourses.push({
        sheetName: sheet.getName(),
        courseName: b1Val,
        students: students
      });

      if (!primaryCourse && b1Val) {
        primaryCourse = b1Val;
      }
      if (primaryStudents.length === 0 && students.length > 0) {
        primaryStudents = students;
      }
      if (requestedCourse && b1Val && b1Val.toUpperCase() === requestedCourse) {
        matchedStudents = students;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      courseName: primaryCourse,
      students: matchedStudents !== null ? matchedStudents : primaryStudents,
      sheets: sheetCourses
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: "No data"})).setMimeType(ContentService.MimeType.JSON);
  }
  
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error:"Busy"})).setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    var data = JSON.parse(e.postData.contents);
    if (data && !Array.isArray(data) && data.action === "SYNC_QUEUE") {
      return ContentService.createTextOutput(JSON.stringify({success: true, message: "Sync acknowledged"})).setMimeType(ContentService.MimeType.JSON);
    }

    if (data && !Array.isArray(data) && data.action === "SEND_ACTIVATION_EMAIL") {
      var toEmail = String(data.toEmail || "").trim();
      var username = String(data.username || "User").trim();
      var activationUrl = String(data.activationUrl || "").trim();
      var adminEmail = String(data.adminEmail || "").trim();
      var ownerEmail = "";
      try { ownerEmail = Session.getEffectiveUser().getEmail() || ""; } catch (e0) {}
      var targetAdminEmail = adminEmail || ownerEmail;

      if (toEmail && activationUrl) {
        MailApp.sendEmail({
          to: toEmail,
          subject: "Activate Your Smart Attendance Account",
          body: "Hello " + username + ",\\n\\nPlease activate your Smart QR Attendance account by opening the link below:\\n" + activationUrl + "\\n\\nAfter activating, you can sign in to the Lecturer Dashboard.",
          htmlBody: "<div style='font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;'><h2 style='color:#111827;margin-bottom:8px;'>Activate Your Account</h2><p style='color:#4b5563;font-size:14px;'>Hello <strong>" + username + "</strong>,</p><p style='color:#4b5563;font-size:14px;'>Thank you for signing up for the Smart QR Attendance System. Click the button below to activate your account:</p><p style='margin:24px 0;'><a href='" + activationUrl + "' style='background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;'>Activate Account</a></p><p style='color:#6b7280;font-size:12px;word-break:break-all;'>Or copy this link: " + activationUrl + "</p></div>"
        });
      }

      if (targetAdminEmail) {
        MailApp.sendEmail({
          to: targetAdminEmail,
          subject: "[Smart Attendance] New User Signup: " + username,
          body: "A new user has signed up via email on the Smart QR Attendance System.\\n\\nUsername: " + username + "\\nEmail: " + toEmail + "\\nStatus: Pending Activation\\n\\nYou can view, activate, or remove this account from the Admin Dashboard."
        });
      }

      return ContentService.createTextOutput(JSON.stringify({success: true, emailSent: true})).setMimeType(ContentService.MimeType.JSON);
    }

    var doc = SpreadsheetApp.getActiveSpreadsheet();
    var allSheets = doc.getSheets();
    var records = Array.isArray(data) ? data : [data];

    // Sheet Layout:
    // Row 1 Col B (B1): Course Name
    // Row 3 (D3:Q3, cols 4..17): W1 - W14 headers
    // Row 4+ Col B (col 2): Student Name (starting B4)
    // Row 4+ Col C (col 3): Student ID (starting C4)
    var START_ROW = 4;
    var NAME_COL = 2; // Column B
    var ID_COL = 3;   // Column C
    var WEEK_START_COL = 4; // Column D (W1)
    var WEEK_COUNT = 14;    // D3:Q3 -> W1..W14

    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record) continue;

      var studentId = String(record["Student ID"] || "").trim();
      var name = String(record["Name"] || "").trim();
      if (!studentId && !name) continue;

      var incomingCourse = String(record["Course Name"] || record["[Course Name Here]"] || "").trim();
      var sheet = allSheets[0];

      // Find matching sheet tab by Row B1 Course Name if available
      if (incomingCourse) {
        for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
          var b1Course = String(allSheets[sIdx].getRange("B1").getValue() || "").trim();
          if (b1Course && b1Course.toUpperCase() === incomingCourse.toUpperCase()) {
            sheet = allSheets[sIdx];
            break;
          }
        }
      }

      // If B1 on target sheet is empty, populate it with incoming Course Name
      var currentB1 = String(sheet.getRange("B1").getValue() || "").trim();
      if (!currentB1 && incomingCourse && incomingCourse !== "General Session" && incomingCourse !== "Connectivity Test") {
        sheet.getRange("B1").setValue(incomingCourse);
      }

      var weekHeaders = sheet.getRange(3, WEEK_START_COL, 1, WEEK_COUNT).getValues()[0];
      var targetWeek = String(record["Week"] || "W7").toUpperCase().trim();
      var statusValue = record["Status"] || record["[Status Here]"] || record[targetWeek] || "P";

      // Resolve target week column in D3:Q3 (cols 4..17)
      var weekCol = -1;
      for (var w = 0; w < weekHeaders.length; w++) {
        var headerVal = String(weekHeaders[w] || "").toUpperCase().trim();
        if (headerVal === targetWeek) {
          weekCol = WEEK_START_COL + w;
          break;
        }
      }
      if (weekCol === -1) {
        var match = targetWeek.match(/^W(\\d+)$/);
        var weekNum = match ? parseInt(match[1], 10) : 7;
        if (weekNum < 1) weekNum = 1;
        if (weekNum > 14) weekNum = 14;
        weekCol = WEEK_START_COL + weekNum - 1;
        if (!String(sheet.getRange(3, weekCol).getValue() || "").trim()) {
          sheet.getRange(3, weekCol).setValue("W" + weekNum);
        }
      }

      // Search students starting from Row 4 (B4: Name, C4: Student ID)
      var lastRow = Math.max(sheet.getLastRow(), START_ROW - 1);
      var numDataRows = lastRow >= START_ROW ? (lastRow - START_ROW + 1) : 0;
      var studentRow = -1;
      var firstEmptyRow = -1;

      if (numDataRows > 0) {
        var nameAndIdValues = sheet.getRange(START_ROW, NAME_COL, numDataRows, 2).getValues();
        for (var r = 0; r < nameAndIdValues.length; r++) {
          var rowName = String(nameAndIdValues[r][0] || "").toUpperCase().trim();
          var rowId = String(nameAndIdValues[r][1] || "").toUpperCase().trim();

          if (!rowName && !rowId && firstEmptyRow === -1) {
            firstEmptyRow = START_ROW + r;
          }
          if (studentId && rowId === studentId.toUpperCase()) {
            studentRow = START_ROW + r;
            break;
          }
        }

        // Fallback match by Name in Column B if ID didn't match
        if (studentRow === -1 && name) {
          for (var r2 = 0; r2 < nameAndIdValues.length; r2++) {
            var rowName2 = String(nameAndIdValues[r2][0] || "").toUpperCase().trim();
            if (rowName2 === name.toUpperCase()) {
              studentRow = START_ROW + r2;
              if (studentId && !String(nameAndIdValues[r2][1] || "").trim()) {
                sheet.getRange(studentRow, ID_COL).setValue(studentId);
              }
              break;
            }
          }
        }
      }

      // Append new student starting from row 4 (B4 = Name, C4 = Student ID)
      if (studentRow === -1) {
        studentRow = firstEmptyRow !== -1 ? firstEmptyRow : Math.max(lastRow + 1, START_ROW);
        if (name) sheet.getRange(studentRow, NAME_COL).setValue(name);
        if (studentId) sheet.getRange(studentRow, ID_COL).setValue(studentId);
      }

      // Record attendance status into the selected week cell (e.g. J4+ for W7)
      sheet.getRange(studentRow, weekCol).setValue(statusValue);
    }
    
    return ContentService.createTextOutput(JSON.stringify({success:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`;

  useEffect(() => {
      localStorage.setItem('attendance-integration-type', integrationType);
  }, [integrationType]);

  useEffect(() => {
      localStorage.setItem('airtable-token', airtableToken);
      localStorage.setItem('airtable-base-id', airtableBaseId);
      localStorage.setItem('airtable-table-name', airtableTableName);
  }, [airtableToken, airtableBaseId, airtableTableName]);

  return (
    <div className="bg-white p-4 sm:p-6 rounded-3xl border-2 border-gray-100 space-y-6">
      <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Destination Type</label>
          <div className="flex bg-gray-50 p-1 rounded-xl">
              <button 
                  onClick={() => setIntegrationType('google_sheets')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'google_sheets' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Google Sheets
              </button>
              <button 
                  onClick={() => setIntegrationType('airtable')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'airtable' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Airtable
              </button>
              <button 
                  onClick={() => setIntegrationType('firebase')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all ${integrationType === 'firebase' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Firebase
              </button>
          </div>
      </div>

      {integrationType === 'google_sheets' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="flex justify-between items-center">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Apps Script Code</h4>
                  <button 
                      onClick={() => { navigator.clipboard.writeText(appScriptCode.trim()); setCopied(true); setTimeout(()=>setCopied(false),2000); }} 
                      className={`text-[9px] px-3 py-1.5 rounded-lg font-bold transition-all ${copied ? 'bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-black'}`}
                  >
                      {copied ? 'COPIED TO CLIPBOARD' : 'COPY SCRIPT CODE'}
                  </button>
              </div>
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <div className="bg-amber-100 p-1.5 rounded-lg text-amber-600 shrink-0">ℹ️</div>
                  <p className="text-[10px] text-amber-800 leading-relaxed font-bold uppercase">
                      Sheet Placement &amp; Emails: Course Name is read/matched on Row B1, Student Name &amp; ID list at B4 &amp; C4, and Weeks W1–W14 in D3:Q3 (recording to {selectedWeek}). Re-deploy the updated script above as a Web App (Access: Anyone) to also enable automatic activation &amp; admin signup emails.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Apps Script URL</label>
                  <input 
                      type="text" 
                      value={scriptUrl} 
                      onChange={(e) => onScriptUrlChange(e.target.value)} 
                      placeholder="https://script.google.com/macros/s/.../exec" 
                      className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                  />
                  {scriptUrl.trim().endsWith('/dev') && (
                    <p className="mt-2 text-[10px] font-bold text-red-600 uppercase">
                      Warning: URL ends in /dev. Use the deployed /exec URL with "Who has access: Anyone" so it works after deployment.
                    </p>
                  )}
              </div>
          </div>
      )}

      {integrationType === 'airtable' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
                  <div className="bg-blue-100 p-1.5 rounded-lg text-blue-600 shrink-0">ℹ️</div>
                  <p className="text-[10px] text-blue-800 leading-relaxed font-bold uppercase">
                      Create a Personal Access Token in Airtable with 'data.records:write' scope.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Personal Access Token</label>
                  <input 
                      type="password" 
                      value={airtableToken} 
                      onChange={(e) => setAirtableToken(e.target.value)} 
                      placeholder="pat..." 
                      className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                  />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Base ID</label>
                      <input 
                          type="text" 
                          value={airtableBaseId} 
                          onChange={(e) => setAirtableBaseId(e.target.value)} 
                          placeholder="app..." 
                          className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                      />
                  </div>
                  <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Table Name</label>
                      <input 
                          type="text" 
                          value={airtableTableName} 
                          onChange={(e) => setAirtableTableName(e.target.value)} 
                          placeholder="Attendance" 
                          className="w-full border-2 border-gray-50 bg-gray-50/50 rounded-2xl p-4 text-xs font-bold outline-none focus:bg-white focus:border-brand-primary transition-all" 
                      />
                  </div>
              </div>
          </div>
      )}

      {integrationType === 'firebase' && (
          <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-green-50 rounded-2xl border border-green-100 flex items-start gap-3">
                  <div className="bg-green-100 p-1.5 rounded-lg text-green-600 shrink-0">✅</div>
                  <p className="text-[10px] text-green-800 leading-relaxed font-bold uppercase">
                      Firebase is already configured as your primary real-time backend. Records are automatically saved to your Firebase Realtime Database.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Database URL</label>
                  <input 
                      type="text" 
                      value={FIREBASE_CONFIG.DATABASE_URL} 
                      disabled
                      className="w-full border-2 border-gray-50 bg-gray-100 rounded-2xl p-4 text-xs font-bold text-gray-500 outline-none cursor-not-allowed" 
                  />
              </div>
          </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-gray-50">
        <button type="button" onClick={async () => { setStatus('Checking...'); const r = await onCheckPendingRecords(); setStatus(r.message); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Check Queue</button>
        <button type="button" onClick={async () => { setStatus('Clearing...'); const r = await onClearPendingQueue(); setStatus(r.message); }} className="bg-red-50 text-red-600 border border-red-100 font-bold py-3 rounded-xl text-[10px] hover:bg-red-100 uppercase tracking-widest active:scale-95 transition-all">Clear Queue</button>
        <button type="button" onClick={async () => { setStatus('Syncing...'); const r = await onForceSync(); setStatus(r.message || 'Sync Complete'); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Force Sync</button>
        <button type="button" onClick={async () => { setStatus('Testing...'); const r = await onSendTestRecord(); setStatus(r.message); }} className="bg-gray-900 text-white font-bold py-3 rounded-xl text-[10px] hover:bg-black uppercase tracking-widest active:scale-95 transition-all">Test Sync</button>
      </div>
      
      {status && <p className="text-[10px] text-center font-bold text-indigo-600 uppercase tracking-widest">{status}</p>}
    </div>
  );
};

import React, { useState, useEffect } from 'react';

interface CloudIntegrationSettingsProps {
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  scriptSecret?: string;
  scriptSecretConfigured?: boolean;
  scriptSecretFromEnv?: boolean;
  onScriptSecretChange?: (secret: string) => Promise<boolean> | boolean | void;
  onSendTestRecord: () => Promise<{ success: boolean; message: string }>;
  onCheckPendingRecords: () => Promise<{ success: boolean; message: string; count: number }>;
  onClearPendingQueue: () => Promise<{ success: boolean; message: string }>;
  onForceSync: () => Promise<{ success: boolean; message: string; syncedCount: number; errorCount: number; total: number; }>;
  selectedWeek?: string;
  integrationType?: 'google_sheets' | 'airtable' | 'firebase';
  onIntegrationTypeChange?: (type: 'google_sheets' | 'airtable' | 'firebase') => void;
  firebaseDatabaseUrl?: string;
  isAdmin?: boolean;
}

export const CloudIntegrationSettings: React.FC<CloudIntegrationSettingsProps> = ({ 
  scriptUrl, 
  onScriptUrlChange, 
  scriptSecret = '',
  scriptSecretConfigured = false,
  scriptSecretFromEnv = false,
  onScriptSecretChange,
  onSendTestRecord, 
  onCheckPendingRecords, 
  onClearPendingQueue,
  onForceSync,
  selectedWeek = 'W1',
  integrationType: propIntegrationType,
  onIntegrationTypeChange,
  firebaseDatabaseUrl,
  isAdmin = true,
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
  const [secretInput, setSecretInput] = useState(scriptSecret);
  const [showSecret, setShowSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState('');

  useEffect(() => {
    setSecretInput(scriptSecret);
  }, [scriptSecret]);

  const activeSecretForScript = (secretInput || scriptSecret || '').trim();
  const escapedSecretForScript = activeSecretForScript.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const handleGenerateSecret = async () => {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    const nextKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    setSecretInput(nextKey);
    setShowSecret(true);
    if (onScriptSecretChange) {
      const ok = await onScriptSecretChange(nextKey);
      setSecretStatus(
        ok !== false
          ? 'Generated & saved! Copy Script Code below and deploy a New Version in Google Apps Script.'
          : 'Failed to save key.'
      );
    }
  };

  const handleSaveSecret = async () => {
    if (!onScriptSecretChange) return;
    const ok = await onScriptSecretChange(secretInput.trim());
    setSecretStatus(
      ok !== false
        ? secretInput.trim()
          ? 'Secret key saved! Make sure SCRIPT_SECRET in Apps Script matches this key.'
          : 'Secret key cleared.'
        : 'Failed to save key.'
    );
  };

  const appScriptCode = `var SCRIPT_SECRET = "${escapedSecretForScript}"; // Recommended: Set here OR in Apps Script Project Settings -> Script Properties as SCRIPT_SECRET

function getExpectedSecret_() {
  var prop = "";
  try {
    prop = PropertiesService.getScriptProperties().getProperty("SCRIPT_SECRET") || "";
  } catch (errProp) {}
  return String(prop || SCRIPT_SECRET || "").trim();
}

function isAuthorizedRequest_(e) {
  var expected = getExpectedSecret_();
  if (!expected) return true;
  var provided = (e && e.parameter && e.parameter.key) ? String(e.parameter.key).trim() : "";
  return provided !== "" && provided === expected;
}

function doGet(e) {
  try {
    if (!isAuthorizedRequest_(e)) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Unauthorized: Invalid Apps Script secret key."
      })).setMimeType(ContentService.MimeType.JSON);
    }

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

      var a2Val = String(sheet.getRange("A2").getDisplayValue() || "").trim();
      var b2Range = sheet.getRange("B2");
      var b2Val = String(b2Range.getDisplayValue() || "").trim();
      if (!b2Val && b2Range.isPartOfMerge()) {
        var mergedB2 = b2Range.getMergedRanges();
        if (mergedB2 && mergedB2.length > 0) {
          b2Val = String(mergedB2[0].getCell(1, 1).getDisplayValue() || "").trim();
        }
      }
      var ownerExplicit = /^(owner|lecturer|instructor|staff)\b/i.test(a2Val);
      var ownerMatch = b2Val.match(/^(?:owner|lecturer|instructor|staff)\\s*[:-]\\s*(.+)$/i);
      if (ownerMatch) {
        b2Val = String(ownerMatch[1] || "").trim();
        ownerExplicit = true;
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
        owner: b2Val,
        ownerExplicit: ownerExplicit,
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
  if (!isAuthorizedRequest_(e)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Unauthorized: Invalid Apps Script secret key."
    })).setMimeType(ContentService.MimeType.JSON);
  }
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
      var activationPin = String(data.activationPin || "").trim();
      var activationUrl = String(data.activationUrl || "").trim();
      var expiresAtText = String(data.expiresAtText || "").trim();
      var expiryLine = expiresAtText
        ? "This activation PIN expires in 1 day (" + expiresAtText + ")."
        : "This activation PIN expires within 1 day (24 hours).";
      var adminEmail = String(data.adminEmail || "").trim();
      var ownerEmail = "";
      try { ownerEmail = Session.getEffectiveUser().getEmail() || ""; } catch (e0) {}
      var targetAdminEmail = adminEmail || ownerEmail;

      if (toEmail && activationPin) {
        MailApp.sendEmail({
          to: toEmail,
          subject: "Your Smart Attendance Account Is Approved — Activation PIN",
          body: "Hello " + username + ",\\n\\nGood news! Your Smart QR Attendance account has been approved by the Administrator.\\n\\nYour 6-digit Activation PIN is: " + activationPin + "\\n\\nHow to complete activation:\\n1. Open the Smart Attendance Sign In page and log in with your User Name and Password first.\\n2. Key in this 6-digit Activation PIN when prompted to complete activation and start using your account.\\n\\n" + expiryLine,
          htmlBody: "<div style='font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e5e7eb;border-radius:12px;'><h2 style='color:#111827;margin-bottom:8px;'>Account Approved — Activation PIN</h2><p style='color:#4b5563;font-size:14px;'>Hello <strong>" + username + "</strong>,</p><p style='color:#4b5563;font-size:14px;'>Your Smart QR Attendance account has been approved by the Administrator. Sign in with your User Name and Password first, then key in this 6-digit Activation PIN when prompted to complete activation and access your account:</p><div style='margin:20px 0;padding:14px 20px;background:#eef2ff;border:2px solid #c7d2fe;border-radius:12px;text-align:center;font-family:monospace;font-size:28px;font-weight:900;letter-spacing:0.25em;color:#3730a3;'>" + activationPin + "</div><p style='color:#b45309;background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:bold;'>" + expiryLine + "</p></div>"
        });
      } else if (targetAdminEmail && !activationUrl && !activationPin) {
        MailApp.sendEmail({
          to: targetAdminEmail,
          subject: "[Smart Attendance] Approval Needed: " + username,
          body: "A new user signed up on the Smart QR Attendance System and is waiting for your approval.\\n\\nUsername: " + username + "\\nEmail: " + toEmail + "\\nStatus: Pending Admin Approval\\n\\nOpen the Admin Control Center -> Users tab to approve and send their Activation PIN."
        });
      }

      return ContentService.createTextOutput(JSON.stringify({success: true, emailSent: true})).setMimeType(ContentService.MimeType.JSON);
    }

    if (data && !Array.isArray(data) && data.action === "SEND_DELETE_REQUEST_EMAIL") {
      var reqUser = String(data.username || "User").trim();
      var reqEmail = String(data.userEmail || "").trim();
      var reqReason = String(data.reason || "Requested via app").trim();
      var reqAdminEmail = String(data.adminEmail || "").trim();
      var reqOwnerEmail = "";
      try { reqOwnerEmail = Session.getEffectiveUser().getEmail() || ""; } catch (e1) {}
      var finalAdminEmail = reqAdminEmail || reqOwnerEmail;

      if (finalAdminEmail) {
        MailApp.sendEmail({
          to: finalAdminEmail,
          subject: "[Smart Attendance] Account Deletion Request: " + reqUser,
          body: "A user submitted an account deletion request from inside the Smart QR Attendance app.\\n\\nUsername: " + reqUser + "\\nEmail: " + reqEmail + "\\nReason: " + reqReason + "\\n\\nPlease open the Admin Control Center in the app to review and remove this account."
        });
      }

      return ContentService.createTextOutput(JSON.stringify({success: true, emailSent: Boolean(finalAdminEmail)})).setMimeType(ContentService.MimeType.JSON);
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
      var sheet = null;

      // 1. Find existing sheet tab matching Row B1 Course Name
      if (incomingCourse) {
        for (var sIdx = 0; sIdx < allSheets.length; sIdx++) {
          var b1Course = String(allSheets[sIdx].getRange("B1").getValue() || "").trim();
          if (b1Course && b1Course.toUpperCase() === incomingCourse.toUpperCase()) {
            sheet = allSheets[sIdx];
            break;
          }
        }
      }

      // 2. If not found, either reuse an empty-B1 sheet or auto-create a new tab in the same Spreadsheet
      if (!sheet) {
        var firstSheet = allSheets[0];
        var firstB1 = String(firstSheet.getRange("B1").getValue() || "").trim();
        if (!incomingCourse || incomingCourse === "General Session" || incomingCourse === "Connectivity Test" || !firstB1) {
          sheet = firstSheet;
        } else {
          var safeTabName = incomingCourse.replace(/[\\\\/?*\\[\\]:]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 95) || "Subject";
          var byName = doc.getSheetByName(safeTabName);
          if (byName) {
            var existingNameB1 = String(byName.getRange("B1").getValue() || "").trim();
            if (!existingNameB1 || existingNameB1.toUpperCase() === incomingCourse.toUpperCase()) {
              sheet = byName;
            } else {
              safeTabName = (safeTabName.slice(0, 88) + " " + (allSheets.length + 1)).trim();
              sheet = doc.insertSheet(safeTabName);
            }
          } else {
            sheet = doc.insertSheet(safeTabName);
          }

          // Initialize standard layout headers on newly created tab
          if (!String(sheet.getRange("B1").getValue() || "").trim()) {
            sheet.getRange("B1").setValue(incomingCourse);
          }
          if (!String(sheet.getRange("B3").getValue() || "").trim()) {
            sheet.getRange("B3").setValue("Student Name");
          }
          if (!String(sheet.getRange("C3").getValue() || "").trim()) {
            sheet.getRange("C3").setValue("Student ID");
          }
          var initWeeks = [];
          for (var iw = 1; iw <= WEEK_COUNT; iw++) initWeeks.push("W" + iw);
          sheet.getRange(3, WEEK_START_COL, 1, WEEK_COUNT).setValues([initWeeks]);
          allSheets.push(sheet);
        }
      }

      // If B1 on target sheet is empty, populate it with incoming Course Name
      var currentB1 = String(sheet.getRange("B1").getValue() || "").trim();
      if (!currentB1 && incomingCourse && incomingCourse !== "General Session" && incomingCourse !== "Connectivity Test") {
        sheet.getRange("B1").setValue(incomingCourse);
      }

      var weekHeaders = sheet.getRange(3, WEEK_START_COL, 1, WEEK_COUNT).getValues()[0];
      var targetWeek = String(record["Week"] || "W1").toUpperCase().trim();
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
        var weekNum = match ? parseInt(match[1], 10) : 1;
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
}

function authorizeMail() {
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log("MailApp authorized! Remaining daily quota: " + quota);
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
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => isAdmin && setIntegrationType('google_sheets')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all disabled:cursor-not-allowed ${integrationType === 'google_sheets' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Google Sheets
              </button>
              <button 
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => isAdmin && setIntegrationType('airtable')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all disabled:cursor-not-allowed ${integrationType === 'airtable' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Airtable
              </button>
              <button 
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => isAdmin && setIntegrationType('firebase')}
                  className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all disabled:cursor-not-allowed ${integrationType === 'firebase' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                  Firebase
              </button>
          </div>
          {!isAdmin && (
            <p className="mt-2 text-[10px] font-bold text-gray-500">
              Global destination &amp; script settings are managed by the Administrator.
            </p>
          )}
      </div>

      {integrationType === 'google_sheets' && isAdmin && (
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
                      Sheet Sync &amp; Lecturer Ownership: Reads Course Name (B1), optional Lecturer Username/Email (B2), Roster (B4:C), and Weeks W1–W14 (recording to {selectedWeek}). Put a lecturer&apos;s username or email in cell B2 (and re-deploy Apps Script as Web App: Anyone) to lock tabs to their specific account.
                  </p>
              </div>
              <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Apps Script URL</label>
                  <input 
                      type="text" 
                      value={isAdmin ? scriptUrl : 'Managed by Administrator'} 
                      disabled={!isAdmin}
                      onChange={(e) => { if (isAdmin) onScriptUrlChange(e.target.value); }} 
                      placeholder="https://script.google.com/macros/s/.../exec" 
                      className={`w-full border-2 border-gray-50 rounded-2xl p-4 text-xs font-bold outline-none transition-all ${isAdmin ? 'bg-gray-50/50 focus:bg-white focus:border-brand-primary' : 'bg-gray-100 text-gray-500 cursor-not-allowed'}`} 
                  />
                  {isAdmin && scriptUrl.trim().endsWith('/dev') && (
                    <p className="mt-2 text-[10px] font-bold text-red-600 uppercase">
                      Warning: URL ends in /dev. Use the deployed /exec URL with "Who has access: Anyone" so it works after deployment.
                    </p>
                  )}
              </div>

              <div className="p-4 bg-indigo-50/70 rounded-2xl border border-indigo-100 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                          <h5 className="text-[10px] font-bold text-indigo-900 uppercase tracking-widest">
                              Apps Script Secret Key (Security Lock)
                          </h5>
                          <p className="text-[10px] text-indigo-700 mt-0.5 leading-relaxed">
                              Google Apps Script must use <strong>Who has access: Anyone</strong> so this server can connect without a Google login. Protect that public endpoint with a secret key so only this server can read or write your sheet.
                          </p>
                      </div>
                      <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                          scriptSecretConfigured || Boolean(activeSecretForScript)
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}>
                          {scriptSecretFromEnv
                              ? 'Protected (Env Var)'
                              : scriptSecretConfigured
                                  ? 'Protected'
                                  : 'Unprotected'}
                      </span>
                  </div>

                  {scriptSecretFromEnv ? (
                      <p className="text-[10px] font-semibold text-emerald-800 bg-white/80 border border-emerald-200 rounded-xl px-3 py-2">
                          Secured via server environment variable <code className="font-mono">APPS_SCRIPT_SECRET</code>. Set the same value in Google Apps Script &rarr; Project Settings &rarr; Script Properties as <code className="font-mono">SCRIPT_SECRET</code>.
                      </p>
                  ) : (
                      <div className="space-y-2">
                          <div className="flex flex-col sm:flex-row gap-2">
                              <div className="relative flex-1">
                                  <input
                                      type={showSecret ? 'text' : 'password'}
                                      value={secretInput}
                                      onChange={(e) => setSecretInput(e.target.value)}
                                      placeholder="Paste or generate a secret key..."
                                      className="w-full border border-indigo-200 bg-white rounded-xl pl-3.5 pr-14 py-2.5 text-xs font-mono font-bold text-gray-800 outline-none focus:border-indigo-500"
                                  />
                                  <button
                                      type="button"
                                      onClick={() => setShowSecret((prev) => !prev)}
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 uppercase"
                                  >
                                      {showSecret ? 'Hide' : 'Show'}
                                  </button>
                              </div>
                              <button
                                  type="button"
                                  onClick={() => void handleGenerateSecret()}
                                  className="px-3.5 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
                              >
                                  Generate Key
                              </button>
                              <button
                                  type="button"
                                  onClick={() => void handleSaveSecret()}
                                  className="px-3.5 py-2.5 rounded-xl bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
                              >
                                  Save Key
                              </button>
                          </div>
                          {secretStatus && (
                              <p className="text-[10px] font-bold text-indigo-800">{secretStatus}</p>
                          )}
                      </div>
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
                      value={isAdmin ? (firebaseDatabaseUrl || 'Configured server-side') : 'Managed by Administrator'} 
                      disabled
                      className="w-full border-2 border-gray-50 bg-gray-100 rounded-2xl p-4 text-xs font-bold text-gray-500 outline-none cursor-not-allowed" 
                  />
              </div>
          </div>
      )}

      <div className={`grid ${isAdmin ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-3 pt-4 border-t border-gray-50`}>
        <button type="button" onClick={async () => { setStatus('Checking...'); const r = await onCheckPendingRecords(); setStatus(r.message); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Check Queue</button>
        {isAdmin && (
          <button type="button" onClick={async () => { setStatus('Clearing...'); const r = await onClearPendingQueue(); setStatus(r.message); }} className="bg-red-50 text-red-600 border border-red-100 font-bold py-3 rounded-xl text-[10px] hover:bg-red-100 uppercase tracking-widest active:scale-95 transition-all">Clear Queue</button>
        )}
        <button type="button" onClick={async () => { setStatus('Syncing...'); const r = await onForceSync(); setStatus(r.message || 'Sync Complete'); }} className="bg-gray-100 text-gray-800 font-bold py-3 rounded-xl text-[10px] hover:bg-gray-200 uppercase tracking-widest active:scale-95 transition-all">Force Sync</button>
        <button type="button" onClick={async () => { setStatus('Testing...'); const r = await onSendTestRecord(); setStatus(r.message); }} className="bg-gray-900 text-white font-bold py-3 rounded-xl text-[10px] hover:bg-black uppercase tracking-widest active:scale-95 transition-all">Test Sync</button>
      </div>
      
      {status && <p className="text-[10px] text-center font-bold text-indigo-600 uppercase tracking-widest">{status}</p>}
    </div>
  );
};

// VERBATIM COPY of CRM lib/designRequestHelpers.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
export const getCell = (row, keys, fallback = "") => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
};

export const splitCsv = (value) =>
  String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export const toYesNo = (value) => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const v = String(value || "").trim().toLowerCase();
  if (["yes", "true", "1"].includes(v)) return "Yes";
  return "No";
};

export const fromYesNo = (value) => {
  const v = String(value || "").trim().toLowerCase();
  return ["yes", "true", "1"].includes(v);
};

// "Our Brand" designs belong to the company's own labels — there is no external
// buyer to approve them, so Step 2 (Buyer Approval) never applies and the buyer
// must not be notified about these designs.
// Matches every spelling the sheet may hold: "our brand", "our_brand",
// "Our-Brand", "OUR  BRAND", etc. (case-insensitive; _, - and repeated
// whitespace all collapse to a single space before comparing).
export const isOurBrandCategory = (category) =>
  String(category || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ") === "our brand";

// "Our Brand" items normally need no design work, EXCEPT Jute / Non-Woven /
// HDPE packaging — those bags carry printed branding a designer must produce,
// so they get an auto-created design request on PI approval exactly like
// private_label_regular. Carton (and everything else) stays designer-free.
// Squashed substring match so "Non-Woven Bag", "non_woven", "HDPE Woven Bag",
// "Jute Bag" all qualify regardless of separator/spacing.
export const isOurBrandDesignerPackaging = (packagingType) => {
  const t = String(packagingType || "").toLowerCase().replace(/[_\-\s]+/g, "");
  return t.includes("jute") || t.includes("nonwoven") || t.includes("hdpe");
};

// Buyer approval (Step 2) rule. External-buyer designs always need buyer
// sign-off. "Our Brand" designs skip it — EXCEPT Jute / Non-Woven / HDPE
// packaging: those carry printed branding the buyer must approve, so they go
// through Step 2 exactly like private_label_regular.
export const skipsBuyerApproval = (designCategory, packagingType) =>
  isOurBrandCategory(designCategory) && !isOurBrandDesignerPackaging(packagingType);

// --- Two-row (main bag + master carton) model -----------------------------
// A master-carton item produces TWO independent design-request rows that share
// the same PI + item number:
//   - main bag:      Row ID `${PI}-${itemNo}`      (requestKind 'main')
//   - master carton: Row ID `${PI}-${itemNo}-MC`   (requestKind 'master_carton')
// `-MC` is a RESERVED suffix. Every consumer must derive the kind from it and
// strip it before parsing the PI/item parts (never `lastIndexOf('-')` blindly —
// that mis-splits the suffix into an item number of "MC").
export const MC_ROW_SUFFIX = '-MC';

export const isMasterCartonRow = (rowId) =>
  /-mc$/i.test(String(rowId || '').trim());

export const getRequestKind = (rowId) =>
  isMasterCartonRow(rowId) ? 'master_carton' : 'main';

// Drop a single trailing `-MC` (case-insensitive) to recover the base Row ID.
export const stripMcSuffix = (rowId) =>
  String(rowId || '').replace(/-mc$/i, '');

export const withMcSuffix = (baseRowId) =>
  `${stripMcSuffix(baseRowId)}${MC_ROW_SUFFIX}`;

export const mapDesignRequestSheetRowToUiRow = (sheetRow) => {
  const language = splitCsv(getCell(sheetRow, ["Language"]));
  const hasMasterCarton = fromYesNo(getCell(sheetRow, ["Has Master Carton"]));
  const mcEnabled = fromYesNo(getCell(sheetRow, ["MC Enabled"]));
  const rowId = getCell(sheetRow, ["Row ID"]);
  const requestKind = getRequestKind(rowId);
  // Legacy combined row: a `-MC` row that still carries MC* column data means it
  // predates the split (its MAIN columns hold the bag, its MC* columns the
  // carton). Consumers use this flag to expand it into two rows on read.
  const legacyCombinedMc = requestKind === "master_carton" && mcEnabled;

  return {
    rowId,
    requestKind,
    legacyCombinedMc,
    requestType: getCell(sheetRow, ["Request Type"], "PI Request"),
    piId: getCell(sheetRow, ["PI ID", "PI Number"]),
    piNumber: getCell(sheetRow, ["PI Number"]),
    piDate: getCell(sheetRow, ["PI Date"]),
    piItemNo: Number(getCell(sheetRow, ["PI Item No"], 0)) || "",
    buyer: getCell(sheetRow, ["Buyer", "Buyer Company Name"]),
    destination: getCell(sheetRow, ["Destination", "Country", "Countries"]),
    brandName: getCell(sheetRow, ["Brand Name", "Brand"]),
    description: getCell(sheetRow, ["Description"]),
    packagingType: getCell(sheetRow, ["Packaging Type"]),
    packSize: getCell(sheetRow, ["Pack Size"]),
    outer: getCell(sheetRow, ["Outer"]),
    designCategory: getCell(sheetRow, ["Design Category"]),
    hasMasterCarton,

    importerDetailsMode: getCell(sheetRow, ["Importer Details Mode"], "new"),
    importerDetails: getCell(sheetRow, ["Importer Details"]),
    country: getCell(sheetRow, ["Country"]),
    logo: null,
    logoPreview: getCell(sheetRow, ["Logo URL", "Logo Upload"]),
    barcodeProvider: getCell(sheetRow, ["Barcode Provider", "Who Give Bar Code"]),
    barcodeImage: null,
    barcodeImagePreview: getCell(sheetRow, ["Barcode Image URL", "Barcode Image"]),
    referenceDesignImage: null,
    referenceDesignPreview: getCell(
      sheetRow,
      ["Reference Design URL", "Reference Design Upload", "Refernce_Design"]
    ),
    tagApplicable: getCell(sheetRow, ["Tag Applicable", "Tag"]),
    boppTagApplicable: getCell(sheetRow, ["BOPP Tag Applicable"]),
    finish: getCell(sheetRow, ["Finish", "Matt_Glosy"]),
    netWt: getCell(sheetRow, ["Net Wt"]),
    handleDori: getCell(sheetRow, ["Handle Dori"]),
    plasticPouchType: getCell(sheetRow, ["Plastic Pouch Type"]),
    sideGusset: getCell(sheetRow, ["Side Gusset"]),
    pouchZipper: getCell(sheetRow, ["Pouch Zipper", "Zipper"]),
    pouchFeatures: splitCsv(getCell(sheetRow, ["Pouch Features"])),
    colourPreference: getCell(sheetRow, ["Colour Preference", "Any Colour Preference"]),
    frontSideText: getCell(sheetRow, ["Front Side Text", "Front Side Bag Description"]),
    language,
    otherLanguage: getCell(sheetRow, ["Other Language"]),
    descriptionOnly: getCell(sheetRow, ["Description Only"]),
    notes: getCell(sheetRow, ["Notes", "Pending / Later Buyer Details"]),
    voiceNotePreview: getCell(sheetRow, ["Voice Note URL", "Voice Note"]),

    mainCompletedFields: Number(getCell(sheetRow, ["Main Completed Fields"], 0)) || 0,
    mainPendingFields: Number(getCell(sheetRow, ["Main Pending Fields"], 0)) || 0,
    mainRequiredFields: Number(getCell(sheetRow, ["Main Required Fields"], 0)) || 0,
    masterCartonCompletedFields:
      Number(getCell(sheetRow, ["MC Completed Fields"], 0)) || 0,
    masterCartonPendingFields:
      Number(getCell(sheetRow, ["MC Pending Fields"], 0)) || 0,
    masterCartonRequiredFields:
      Number(getCell(sheetRow, ["MC Required Fields"], 0)) || 0,
    completedFields: Number(getCell(sheetRow, ["Completed Fields"], 0)) || 0,
    pendingFields: Number(getCell(sheetRow, ["Pending Fields"], 0)) || 0,
    requiredFields: Number(getCell(sheetRow, ["Required Fields"], 0)) || 0,

    priority: getCell(sheetRow, ["Priority"]),
    deadline: getCell(sheetRow, ["Deadline"]),
    requestDescription: getCell(sheetRow, ["Request Description"]),
    requestedBy: getCell(sheetRow, ["Requested By"]),
    requestedAt: getCell(sheetRow, ["Requested At"]),
    updatedAt: getCell(sheetRow, ["Updated At"]),
    overallStatus: getCell(sheetRow, ["Overall Status"]),
    assignedDesigner: getCell(sheetRow, ["Assigned Designer"]),

    designStartedAt: getCell(sheetRow, ["Design Started At"]),
    designSubmitted: getCell(sheetRow, ["Design Submitted At"]),
    designAssignedAt: getCell(sheetRow, ["Design Assigned At"]),
    designDueAt: getCell(sheetRow, ["Design Due At"]),
    designWorkStatus: getCell(sheetRow, ["Design Work Status"]),

    approvalStatus: getCell(sheetRow, ["Approval Status"]),
    disapprovalReason: getCell(sheetRow, ["Disapproval Reason"]),
    // Per-step delay reasons and buyer feedback. Without these on the mapped row
    // a help ticket reaching Design Approval showed "No reason" however many
    // times someone typed one — it saved to the sheet and never came back.
    step1DelayReason: getCell(sheetRow, ["Step1 Delay Reason"]),
    step2DelayReason: getCell(sheetRow, ["Step2 Delay Reason"]),
    delayReason: getCell(sheetRow, ["Delay Reason"]),
    isBuyersFault: getCell(sheetRow, ["Is Buyers Fault"]),
    buyerDisapprovalReason: getCell(sheetRow, ["Buyer Disapproval Reason"]),
    buyerFeedbackMedia: getCell(sheetRow, ["Buyer Feedback Media"]),
    approvedAt: getCell(sheetRow, ["Approved At"]),
    crmApprovedAt: getCell(sheetRow, ["CRM Approved At"]),
    crmDisapprovedAt: getCell(sheetRow, ["CRM Disapproved At"]),
    buyerSentAt: getCell(sheetRow, ["Buyer Sent At", "Approved At"]),
    buyerApprovalStatus: getCell(sheetRow, ["Buyer Approval Status"]),
    buyerApprovedAt: getCell(sheetRow, ["Buyer Approved At"]),
    designOutputUrl: getCell(sheetRow, ["Design Output URL"]),

    // Step 3 — management approval, and the close stamps. Without these on the
    // mapped row every consumer built on this mapper is structurally unable to
    // freeze a closed request's delay at its close time. See
    // lib/designApprovalClose.js.
    managementSentAt: getCell(sheetRow, ["Management Sent At"]),
    managementApprovalStatus: getCell(sheetRow, ["Management Approval Status"]),
    managementApprovedBy: getCell(sheetRow, ["Management Approved By"]),
    managementApprovedAt: getCell(sheetRow, ["Management Approved At"]),
    managementDisapprovalReason: getCell(sheetRow, ["Management Disapproval Reason"]),
    closedAt: getCell(sheetRow, ["Closed At"]),
    closedBy: getCell(sheetRow, ["Closed By"]),
    closeReason: getCell(sheetRow, ["Close Reason"]),
    versionHistory: getCell(sheetRow, ["Version History"]),

    // Step-hold columns, so a help-ticket row reaching Design Approval through
    // this mapper can have its clock paused like any PI row. Names mirror
    // HOLD_COLUMNS in lib/designApprovalHold.js.
    crmHoldStep: getCell(sheetRow, ["CRM Hold Step"]),
    crmHoldReason: getCell(sheetRow, ["CRM Hold Reason"]),
    crmHoldStartedAt: getCell(sheetRow, ["CRM Hold Started At"]),
    crmHoldBy: getCell(sheetRow, ["CRM Hold By"]),
    step1HoldMinutes: getCell(sheetRow, ["Step1 Hold Minutes"]),
    step2HoldMinutes: getCell(sheetRow, ["Step2 Hold Minutes"]),
    step3HoldMinutes: getCell(sheetRow, ["Step3 Hold Minutes"]),
    // Raw cell; Design Approval reads it through isMutedValue (lib/designApprovalMute.js).
    notificationsMuted: getCell(sheetRow, ["Notifications Muted"]),

    masterCarton: {
      enabled: mcEnabled,
      importerDetailsMode: getCell(sheetRow, ["MC Importer Details Mode"], "new"),
      importerDetails: getCell(sheetRow, ["MC Importer Details"]),
      country: getCell(sheetRow, ["MC Country"]),
      descriptionOnly: getCell(sheetRow, ["MC Description Only"]),
      notes: getCell(sheetRow, ["MC Notes"]),
      designCategory: getCell(sheetRow, ["MC Design Category", "Design Category"]),
    },
  };
};

export const mapUiRowToSheetRow = ({ row, requestMeta, selectedPi, user }) => {
  /**
   * Status the row lands on, for BOTH status columns.
   *
   * A master-carton row carries no mandatory fields, so it is always Completed.
   * That is not cosmetic: the design desk skips anything sitting at Pending
   * (`isOverallStatusPendingExcluded`), so a carton parked there never reaches a
   * designer at all. This mapper had no carton branch — a carton row with any
   * pending count would have been written Pending and silently stalled.
   *
   * Mirrors `deriveStatus()` in app/api/design-requests/route.js, which is the
   * live writer. Keep the two in step.
   */
  const deriveStatus = () => {
    if (row.requestKind === "master_carton" || isMasterCartonRow(row.rowId)) return "Completed";
    const cat = String(row.designCategory || "").trim().toLowerCase().replace(/_/g, " ");
    if (cat === "our brand" || cat === "private label regular") return "Completed";
    return row.pendingFields > 0 ? "Pending" : "Completed";
  };
  const status = deriveStatus();
  const nowIso = new Date().toISOString();
  const isHelpTicket =
    String(row.requestType || "").trim().toLowerCase() === "help ticket" ||
    String(row.requestType || "").trim().toLowerCase() === "help_ticket";

  return {
    // Row ID is per-row and already carries its own `-MC` suffix for carton
    // rows. Derive the suffix from requestKind ONLY as a fallback — never from
    // hasMasterCarton (that is now a main-row indicator, not a row-shape flag).
    "Row ID":
      row.rowId ||
      `${row.piNumber}-${row.piItemNo}${row.requestKind === "master_carton" ? "-MC" : ""}`,
    "PI Number": row.piNumber || selectedPi?.id || selectedPi?.piNumber || "",
    "PI Date": row.piDate || "",
    "PI Item No": String(row.piItemNo || ""),
    "PI ID": row.piId || selectedPi?.id || selectedPi?.piNumber || "",
    "Buyer": row.buyer || selectedPi?.buyerCompanyName || selectedPi?.buyer || "",
    "Buyer Email": selectedPi?.details?.buyerEmail || "",
    "Destination": row.destination || selectedPi?.details?.finalDestination || "",
    "Brand Name": row.brandName || "",
    "Description": row.description || "",
    "Packaging Type": row.packagingType || "",
    "Pack Size": row.packSize || "",
    "Outer": row.outer || "",
    "Design Category": row.designCategory || "",
    "Has Master Carton": row.hasMasterCarton ? "Yes" : "No",

    "Request Type": isHelpTicket ? "Help Ticket" : "PI Request",
    "Priority": requestMeta?.priority || "normal",
    "Deadline": requestMeta?.deadline || "",
    "Request Description": requestMeta?.description || "",
    "Design Request Status": status,
    "Requested By": user?.email || "",
    "Requested At": nowIso,
    "Updated At": nowIso,

    "Importer Details Mode": row.importerDetailsMode || "as_per_pi",
    "Importer Details": row.importerDetails || "",
    "Country": row.country || "",

    "Logo URL": row.logoPreview || "",
    "Barcode Provider": row.barcodeProvider || "",
    "Barcode Image URL": row.barcodeImagePreview || "",
    "Reference Design URL": row.referenceDesignPreview || "",
    "Tag Applicable": row.tagApplicable || "",
    "BOPP Tag Applicable": row.boppTagApplicable || "",
    "Finish": row.finish || "",
    "Net Wt": row.netWt || "",
    "Handle Dori": row.handleDori || "",
    "Plastic Pouch Type": row.plasticPouchType || "",
    "Side Gusset": row.sideGusset || "",
    "Pouch Zipper": row.pouchZipper || "",
    "Pouch Features": Array.isArray(row.pouchFeatures)
      ? row.pouchFeatures.join(", ")
      : row.pouchFeatures || "",
    "Colour Preference": row.colourPreference || "",
    "Front Side Text": row.frontSideText || "",
    "Language": Array.isArray(row.language) ? row.language.join(", ") : "",
    "Other Language": row.otherLanguage || "",
    "Description Only": row.descriptionOnly || "",
    "Notes": row.notes || "",

    "MC Enabled": row.masterCarton?.enabled ? "Yes" : "No",
    "MC Importer Details Mode":
      row.masterCarton?.importerDetailsMode || "as_per_pi",
    "MC Importer Details": row.masterCarton?.importerDetails || "",
    "MC Country": row.masterCarton?.country || "",
    "MC Description Only": row.masterCarton?.descriptionOnly || "",
    "MC Notes": row.masterCarton?.notes || "",
    "MC Design Category":
      row.masterCarton?.designCategory || row.designCategory || "",

    "Main Completed Fields": String(row.mainCompletedFields || 0),
    "Main Pending Fields": String(row.mainPendingFields || 0),
    "Main Required Fields": String(row.mainRequiredFields || 0),
    "MC Completed Fields": String(row.masterCartonCompletedFields || 0),
    "MC Pending Fields": String(row.masterCartonPendingFields || 0),
    "MC Required Fields": String(row.masterCartonRequiredFields || 0),
    "Completed Fields": String(row.completedFields || 0),
    "Pending Fields": String(row.pendingFields || 0),
    "Required Fields": String(row.requiredFields || 0),
    "Overall Status": status,
    "Assigned Designer": row.assignedDesigner || "",
    "Voice Note URL": row.voiceNotePreview || "",
  };
};
// VERBATIM COPY of CRM lib/roles.js @ 657ca0a ('@/...' imports made relative).
// Do not edit by hand: re-run `npm run sync-crm` (tools/sync-crm.mjs) after the CRM changes.
// lib/roles.js
import {
  SETTLEMENT_PERMISSION_MAP, SETTLEMENT_OPERATOR_SLUGS,
} from './payment-settlement-permissions.js';

export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin', 
  USER: 'User',
  GUEST: 'Guest'
};

export const SUPER_ADMIN_EMAILS = [
  'ankit@shaziarice.com',
  'ankitlathwal19198@gmail.com',
  'ankit@gmail.com',
  'superadmin@gmail.com'
];

// Seeded system Super Admin accounts that must NEVER surface in the Team
// Management roster / team directory. Filtered out at the /api/teamSheets read
// chokepoint (which both the Team page and useTeamDirectory consume). This is a
// deliberately narrow list — the real super admins above stay visible.
export const HIDDEN_TEAM_MEMBER_EMAILS = [
  'ankit@gmail.com',
  'superadmin@gmail.com'
];

// Three of the Super Admin addresses above are personal sign-in accounts. They
// are real credentials, so auth keeps reading the whole list — but nothing that
// leaves the app (outbound mail, exports, an on-screen roster) should name a
// private inbox. Outward-facing code filters the list through this instead of
// pruning it, which would lock those accounts out.
export const COMPANY_EMAIL_DOMAIN = '@shaziarice.com';

export const isCompanyEmail = (email) =>
  String(email || '').trim().toLowerCase().endsWith(COMPANY_EMAIL_DOMAIN);

export const PERMISSIONS = {
  // Dashboard permissions
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_ANALYTICS: 'view_analytics',
  
  // PI Management permissions
  CREATE_PI: 'create_pi',
  VIEW_PI: 'view_pi',
  EDIT_PI: 'edit_pi',
  DELETE_PI: 'delete_pi',
  APPROVE_PI: 'approve_pi',
  REJECT_PI: 'reject_pi',
  VIEW_ALL_PI: 'view_all_pi', // Can see all users' PIs
  VIEW_OWN_PI: 'view_own_pi', // Can only see own PIs

  // PI Tracker permissions (cross-cuts PI + SO progress view)
  VIEW_PI_TRACKER: 'pi_tracker.view',
  VIEW_ALL_PI_TRACKER: 'pi_tracker.view_all',
  VIEW_OWN_PI_TRACKER: 'pi_tracker.view_own',
  REFRESH_PI_TRACKER: 'pi_tracker.refresh',
  
  // Team Management permissions
  VIEW_TEAM: 'view_team',
  ADD_TEAM_MEMBER: 'add_team_member',
  EDIT_TEAM_MEMBER: 'edit_team_member',
  DELETE_TEAM_MEMBER: 'delete_team_member',
  MANAGE_ROLES: 'manage_roles',
  
  // Master Data permissions
  VIEW_MASTER_DATA: 'view_master_data',
  EDIT_MASTER_DATA: 'edit_master_data',
  
  // Admin Panel permissions
  ACCESS_ADMIN_PANEL: 'access_admin_panel',
  MANAGE_PERMISSIONS: 'manage_permissions',
  VIEW_SYSTEM_LOGS: 'view_system_logs',
  
  // Settings permissions
  VIEW_SETTINGS: 'view_settings',
  EDIT_SETTINGS: 'edit_settings',
  // Settings → Notification Mute: quiet an order, PI or help ticket from one place.
  SETTINGS_NOTIFICATION_MUTE: 'settings.tab.notification_mute',
  
  // Chat permissions
  ACCESS_TEAM_CHAT: 'access_team_chat',
  CHAT_READ: 'chat.read',
  CHAT_CREATE_GROUP: 'chat.create_group',
  CHAT_DELETE_MESSAGE: 'chat.delete_message',
  CHAT_ADD_MEMBERS: 'chat.add_members',
  CHAT_REMOVE_MEMBERS: 'chat.remove_members',
  MODERATE_CHAT: 'moderate_chat',

  // Design Request permissions
  VIEW_DESIGN_REQUEST: 'design.view',
  CREATE_DESIGN_REQUEST: 'design.create',
  EDIT_DESIGN_REQUEST: 'design.edit',
  VIEW_ALL_DESIGN_REQUEST: 'design.view.all',
  VIEW_OWN_DESIGN_REQUEST: 'design.view.own',

  // Design Exhibition permissions
  VIEW_DESIGN_EXHIBITION: 'design.exhibition.view',
  CREATE_DESIGN_EXHIBITION: 'design.exhibition.create',
  VIEW_DESIGN_EXHIBITION_APPROVAL: 'design.exhibition_approval.view',
  APPROVE_DESIGN_EXHIBITION: 'design.exhibition_approval.approve',

  // Design Approval permissions
  VIEW_DESIGN_APPROVAL: 'design_approval.view',
  VIEW_ALL_DESIGN_APPROVAL: 'design_approval.view.all',
  VIEW_OWN_DESIGN_APPROVAL: 'design_approval.view.own',
  DESIGN_APPROVAL_STEP1_READ: 'design_approval.step1.read',
  DESIGN_APPROVAL_STEP1_CREATE: 'design_approval.step1.create',
  DESIGN_APPROVAL_STEP1_UPDATE: 'design_approval.step1.update',
  DESIGN_APPROVAL_STEP2_READ: 'design_approval.step2.read',
  DESIGN_APPROVAL_STEP2_CREATE: 'design_approval.step2.create',
  DESIGN_APPROVAL_STEP2_UPDATE: 'design_approval.step2.update',
  DESIGN_APPROVAL_MANAGEMENT_READ: 'design_approval.management.read',
  DESIGN_APPROVAL_MANAGEMENT_CREATE: 'design_approval.management.create',
  DESIGN_APPROVAL_MANAGEMENT_UPDATE: 'design_approval.management.update',
  // Stops one step's delay clock. Its own grant, not carried by the approve
  // rights: pausing changes what everyone downstream is measured against.
  DESIGN_APPROVAL_HOLD: 'design_approval.hold',
  // Decide a step without messaging anyone — buyer group, email, management.
  DESIGN_APPROVAL_MUTE_NOTIFICATIONS: 'design_approval.mute_notifications',

  // Design Report permissions
  VIEW_ALL_DESIGN_REPORT: 'design_report.view_all',
  VIEW_MY_DESIGN_REPORT: 'design_report.view_own',

  // Buyer Master permissions
  VIEW_BUYER_MASTER: 'buyer_master.view',
  CREATE_BUYER_MASTER: 'buyer_master.create',
  EDIT_BUYER_MASTER: 'buyer_master.edit',
  DELETE_BUYER_MASTER: 'buyer_master.delete',
  DEACTIVATE_BUYER_MASTER: 'buyer_master.deactivate',

  // Product Master permissions
  VIEW_PRODUCT_MASTER: 'master.product.read',
  CREATE_PRODUCT_MASTER: 'master.product.create',
  EDIT_PRODUCT_MASTER: 'master.product.update',
  DELETE_PRODUCT_MASTER: 'master.product.delete',
  DEACTIVATE_PRODUCT_MASTER: 'master.product.deactivate',

  // Field Master (Granular)
  MASTER_BANK_READ: 'master.bank.read',
  MASTER_BANK_CREATE: 'master.bank.create',
  MASTER_BANK_UPDATE: 'master.bank.update',
  MASTER_BANK_DELETE: 'master.bank.delete',

  MASTER_PAYMENT_TERMS_READ: 'master.payment_terms.read',
  MASTER_PAYMENT_TERMS_CREATE: 'master.payment_terms.create',
  MASTER_PAYMENT_TERMS_UPDATE: 'master.payment_terms.update',
  MASTER_PAYMENT_TERMS_DELETE: 'master.payment_terms.delete',

  MASTER_TERMS_CONDITIONS_READ: 'master.terms_conditions.read',
  MASTER_TERMS_CONDITIONS_CREATE: 'master.terms_conditions.create',
  MASTER_TERMS_CONDITIONS_UPDATE: 'master.terms_conditions.update',
  MASTER_TERMS_CONDITIONS_DELETE: 'master.terms_conditions.delete',

  MASTER_SALES_PERSON_READ: 'master.sales_person.read',
  MASTER_SALES_PERSON_CREATE: 'master.sales_person.create',
  MASTER_SALES_PERSON_UPDATE: 'master.sales_person.update',
  MASTER_SALES_PERSON_DELETE: 'master.sales_person.delete',

  MASTER_SALES_COORDINATOR_READ: 'master.sales_coordinator.read',
  MASTER_SALES_COORDINATOR_CREATE: 'master.sales_coordinator.create',
  MASTER_SALES_COORDINATOR_UPDATE: 'master.sales_coordinator.update',
  MASTER_SALES_COORDINATOR_DELETE: 'master.sales_coordinator.delete',

  MASTER_DISCHARGE_PORTS_READ: 'master.discharge_ports.read',
  MASTER_DISCHARGE_PORTS_CREATE: 'master.discharge_ports.create',
  MASTER_DISCHARGE_PORTS_UPDATE: 'master.discharge_ports.update',
  MASTER_DISCHARGE_PORTS_DELETE: 'master.discharge_ports.delete',

  MASTER_LOADING_PORTS_READ: 'master.loading_ports.read',
  MASTER_LOADING_PORTS_CREATE: 'master.loading_ports.create',
  MASTER_LOADING_PORTS_UPDATE: 'master.loading_ports.update',
  MASTER_LOADING_PORTS_DELETE: 'master.loading_ports.delete',

  MASTER_DESTINATIONS_READ: 'master.destinations.read',
  MASTER_DESTINATIONS_CREATE: 'master.destinations.create',
  MASTER_DESTINATIONS_UPDATE: 'master.destinations.update',
  MASTER_DESTINATIONS_DELETE: 'master.destinations.delete',

  MASTER_SCHEDULES_READ: 'master.schedules.read',
  MASTER_SCHEDULES_CREATE: 'master.schedules.create',
  MASTER_SCHEDULES_UPDATE: 'master.schedules.update',
  MASTER_SCHEDULES_DELETE: 'master.schedules.delete',

  MASTER_VARIETIES_READ: 'master.varieties.read',
  MASTER_VARIETIES_CREATE: 'master.varieties.create',
  MASTER_VARIETIES_UPDATE: 'master.varieties.update',
  MASTER_VARIETIES_DELETE: 'master.varieties.delete',

  MASTER_RICE_CATEGORIES_READ: 'master.rice_categories.read',
  MASTER_RICE_CATEGORIES_CREATE: 'master.rice_categories.create',
  MASTER_RICE_CATEGORIES_UPDATE: 'master.rice_categories.update',
  MASTER_RICE_CATEGORIES_DELETE: 'master.rice_categories.delete',

  MASTER_PACKAGING_TYPES_READ: 'master.packaging_types.read',
  MASTER_PACKAGING_TYPES_CREATE: 'master.packaging_types.create',
  MASTER_PACKAGING_TYPES_UPDATE: 'master.packaging_types.update',
  MASTER_PACKAGING_TYPES_DELETE: 'master.packaging_types.delete',

  MASTER_PACKING_SIZE_READ: 'master.packing_size.read',
  MASTER_PACKING_SIZE_CREATE: 'master.packing_size.create',
  MASTER_PACKING_SIZE_UPDATE: 'master.packing_size.update',
  MASTER_PACKING_SIZE_DELETE: 'master.packing_size.delete',

  MASTER_BRANDS_READ: 'master.brands.read',
  MASTER_BRANDS_CREATE: 'master.brands.create',
  MASTER_BRANDS_UPDATE: 'master.brands.update',
  MASTER_BRANDS_DELETE: 'master.brands.delete',

  MASTER_DESIGN_CATEGORIES_READ: 'master.design_categories.read',
  MASTER_DESIGN_CATEGORIES_CREATE: 'master.design_categories.create',
  MASTER_DESIGN_CATEGORIES_UPDATE: 'master.design_categories.update',
  MASTER_DESIGN_CATEGORIES_DELETE: 'master.design_categories.delete',

  MASTER_CURRENCIES_READ: 'master.currencies.read',
  MASTER_CURRENCIES_CREATE: 'master.currencies.create',
  MASTER_CURRENCIES_UPDATE: 'master.currencies.update',
  MASTER_CURRENCIES_DELETE: 'master.currencies.delete',

  MASTER_PRIORITIES_READ: 'master.priorities.read',
  MASTER_PRIORITIES_CREATE: 'master.priorities.create',
  MASTER_PRIORITIES_UPDATE: 'master.priorities.update',
  MASTER_PRIORITIES_DELETE: 'master.priorities.delete',

  // Global Alerts permissions
  VIEW_GLOBAL_ALERTS: 'global_alerts.view',
  CREATE_GLOBAL_ALERT: 'global_alerts.create',
  READ_GLOBAL_ALERT: 'global_alerts.read',
  DELETE_GLOBAL_ALERT: 'global_alerts.delete',

  // Custom Alerts permissions
  VIEW_CUSTOM_ALERTS: 'custom_alerts.view',
  CREATE_CUSTOM_ALERT: 'custom_alerts.create',
  EDIT_CUSTOM_ALERT: 'custom_alerts.edit',
  DELETE_CUSTOM_ALERT: 'custom_alerts.delete',

  // Overview permissions
  VIEW_SUPER_OVERVIEW: 'overview.view',

  // Ticket permissions
  VIEW_TICKETS: 'ticket.view',
  VIEW_ALL_TICKETS: 'ticket.view_all',
  CREATE_TICKET: 'ticket.create',
  RESOLVE_TICKET: 'ticket.resolve',
  CLOSE_TICKET: 'ticket.close',
  REOPEN_TICKET: 'ticket.reopen',
  MANAGE_TICKET_EXTENSIONS: 'ticket.extension.manage',

  // FMS Step-wise permissions
  FMS_VIEW: 'view_fms',
  FMS_STEP2_VIEW: 'fms.step2.view',
  FMS_STEP2_UPLOAD: 'fms.step2.upload',
  FMS_STEP3_VIEW: 'fms.step3.view',
  FMS_STEP3_UPLOAD: 'fms.step3.upload',
  FMS_STEP4_VIEW: 'fms.step4.view',
  FMS_STEP4_CONFIRM: 'fms.step4.confirm',
  FMS_VIEW_ADVANCE_RECEIVED_ONLY: 'fms.view_advance_received_only',
  FMS_HOLD: 'fms.hold',
  FMS_EXTEND: 'fms.extend',

  // SO-FMS Step-wise permissions
  SOFMS_VIEW: 'view_sofms',
  SOFMS_VIEW_ALL: 'sofms.view.all',
  SOFMS_GLOBAL_HOLD: 'sofms.global.hold_resume',
  SOFMS_GLOBAL_EXTEND: 'sofms.global.extend_date',
  SOFMS_GLOBAL_DELAY_REASON: 'sofms.global.add_delay_reason',
  SOFMS_GLOBAL_AUTOPILOT: 'sofms.global.autopilot',
  SOFMS_MUTE_NOTIFICATIONS: 'sofms.mute_notifications',
  // Send a step's message/email to the buyer by hand, WITHOUT completing the
  // step. Its own grant rather than the custom-alert author's: writing alert
  // presets and re-sending one order's message are different jobs, and the
  // people who do the second (CRM executives, sales coordinators) have no
  // business doing the first.
  SOFMS_STEP_SEND_MESSAGE: 'sofms.step.send_message',

  SOFMS_STEP0_VIEW: 'sofms.step0.view',
  SOFMS_STEP0_SCHEDULE: 'sofms.step0.schedule',
  // Step-0 freezes the moment Step-3's first packing date arrives, because
  // rescheduling a dispatch after packing has started would be fiction. This
  // grant reopens it for back-filling a schedule that was agreed off-system and
  // never entered - a correction, not a reschedule. Super Admin holds every
  // permission by default; give it to anyone else only deliberately.
  SOFMS_STEP0_OVERRIDE_LOCK: 'sofms.step0.override_lock',

  SOFMS_STEP1_VIEW: 'sofms.step1.view',
  SOFMS_STEP1_VIEW_DOCS: 'sofms.step1.view_docs',
  SOFMS_STEP1_SHARE: 'sofms.step1.share',

  SOFMS_STEP2_VIEW: 'sofms.step2.view',
  // Step-2 is now Buyer Approval for pre-shipment drafts; this slug gates the
  // Approve/Disapprove buttons (slug kept as .upload so existing grants carry over).
  SOFMS_STEP2_UPLOAD: 'sofms.step2.upload',

  SOFMS_STEP3_VIEW: 'sofms.step3.view',
  SOFMS_STEP3_SHARE: 'sofms.step3.share',
  SOFMS_STEP3_VIEW_IMAGES: 'sofms.step3.view_images',

  SOFMS_STEP4_VIEW: 'sofms.step4.view',

  SOFMS_STEP5_VIEW: 'sofms.step5.view',
  SOFMS_STEP5_ACKNOWLEDGE: 'sofms.step5.acknowledge',

  SOFMS_STEP6_VIEW: 'sofms.step6.view',
  SOFMS_STEP6_CONFIRM: 'sofms.step6.confirm',

  SOFMS_STEP7_VIEW: 'sofms.step7.view',
  SOFMS_STEP7_CONFIRM: 'sofms.step7.confirm',
  SOFMS_STEP7_VIEW_RECORDS: 'sofms.step7.view_records',

  SOFMS_STEP8_VIEW: 'sofms.step8.view',
  SOFMS_STEP8_CONFIRM: 'sofms.step8.confirm',
  SOFMS_STEP8_VIEW_RECORDS: 'sofms.step8.view_records',

  SOFMS_STEP9_VIEW: 'sofms.step9.view',
  SOFMS_STEP9_REVIEW: 'sofms.step9.review',
  SOFMS_STEP9_VIEW_SCANS: 'sofms.step9.view_scans',

  SOFMS_STEP10_VIEW: 'sofms.step10.view',
  SOFMS_STEP10_COMPLETE: 'sofms.step10.complete',
  SOFMS_STEP10_VIEW_DOCS: 'sofms.step10.view_docs',

  SOFMS_STEP11_VIEW: 'sofms.step11.view',
  SOFMS_STEP11_RECORD_PAYMENT: 'sofms.step11.record_payment',
  SOFMS_STEP11_TELEX_REQUEST: 'sofms.step11.telex_request',
  SOFMS_STEP11_VIEW_HISTORY: 'sofms.step11.view_history',

  SOFMS_STEP11_5_VIEW: 'sofms.step11_5.view',
  SOFMS_STEP11_5_VERIFY: 'sofms.step11_5.verify',

  SOFMS_STEP12_VIEW: 'sofms.step12.view',
  SOFMS_STEP12_CONFIRM: 'sofms.step12.confirm',
  SOFMS_STEP12_VIEW_DOCS: 'sofms.step12.view_docs',

  SOFMS_STEP13_VIEW: 'sofms.step13.view',
  SOFMS_STEP13_APPROVE: 'sofms.step13.approve',

  SOFMS_STEP14_VIEW: 'sofms.step14.view',
  SOFMS_STEP14_SUBMIT: 'sofms.step14.submit',

  // FMS permissions
  VIEW_FMS: 'view_fms',
  VIEW_SOFMS: 'view_sofms',

  // Client Ledger permissions
  VIEW_CLIENT_LEDGER: 'client_ledger.view',
  CREATE_CLIENT_LEDGER: 'client_ledger.create',
  EDIT_CLIENT_LEDGER: 'client_ledger.edit',
  // Correcting an entry's value (payment) date is restricted — Super Admin only
  // by default (not in the Admin role list below). Grantable to any role via the
  // RBAC admin UI.
  EDIT_CLIENT_LEDGER_DATE: 'client_ledger.edit_date',
  DELETE_CLIENT_LEDGER: 'client_ledger.delete',
  CONFIRM_CLIENT_LEDGER: 'client_ledger.confirm',

  // Payment Settlement — the post-confirmation bank settlement lane (Settlement →
  // Bank Rec Rate → Voucher Entry), its forward / PCFC / EPC book, and GRN
  // release. Every gated button has its own slug; the catalogue lives in
  // lib/payment-settlement-permissions.js so the admin UI, the seed script, the
  // client hook and the API route all read the same list.
  ...SETTLEMENT_PERMISSION_MAP,
  // Superseded by the finer slugs above but still honoured for anyone holding
  // them (see LEGACY_IMPLIES) — do not remove.
  COMPLETE_PAYMENT_SETTLEMENT: 'payment_settlement.complete',
  EDIT_PAYMENT_SETTLEMENT: 'payment_settlement.edit',
  MANAGE_PAYMENT_SETTLEMENT_MASTER: 'payment_settlement.manage_master',
  RELEASE_GRN: 'payment_settlement.grn_release',
  CLOSE_CI: 'payment_settlement.close_ci',

  // Client Report permissions (PI vs CI report)
  VIEW_CLIENT_REPORT: 'client_report.view',
  EXPORT_CLIENT_REPORT: 'client_report.export',

  // Client Collection Report permissions (/buyers/collection-report)
  VIEW_CLIENT_COLLECTION: 'client_collection.view',
  EXPORT_CLIENT_COLLECTION: 'client_collection.export',

  // PC Report (pending-work report) — page, scope, and button-level controls
  VIEW_PC_REPORT: 'pc_report.view',
  VIEW_ALL_PC_REPORT: 'pc_report.view.all',
  VIEW_OWN_PC_REPORT: 'pc_report.view.own',
  REFRESH_PC_REPORT: 'pc_report.refresh',
  EXPORT_PC_REPORT: 'pc_report.export',

  // MIS Performance report — page, scope, and button-level controls
  VIEW_MIS_REPORT: 'mis_report.view',
  VIEW_ALL_MIS_REPORT: 'mis_report.view.all',
  VIEW_OWN_MIS_REPORT: 'mis_report.view.own',
  REFRESH_MIS_REPORT: 'mis_report.refresh',
  EXPORT_MIS_REPORT_CSV: 'mis_report.export.csv',
  EXPORT_MIS_REPORT_EXCEL: 'mis_report.export.excel',

  // Department Analytics report — page, scope, and button-level controls
  VIEW_DEPT_ANALYTICS: 'dept_analytics.view',
  VIEW_ALL_DEPT_ANALYTICS: 'dept_analytics.view.all',
  VIEW_OWN_DEPT_ANALYTICS: 'dept_analytics.view.own',
  REFRESH_DEPT_ANALYTICS: 'dept_analytics.refresh',
  EXPORT_DEPT_ANALYTICS_CSV: 'dept_analytics.export.csv',
  EXPORT_DEPT_ANALYTICS_EXCEL: 'dept_analytics.export.excel',
  EXPORT_DEPT_ANALYTICS_PDF: 'dept_analytics.export.pdf',

  // Sales Coordinator Scorecard (reward & recognition report)
  VIEW_SALES_REPORT: 'sales_report.view',          // open it — a coordinator sees ONLY their own row
  VIEW_ALL_SALES_REPORT: 'sales_report.view.all',  // management view-all — SAME slug on client (page) + server (route)
  VIEW_OWN_SALES_REPORT: 'sales_report.view.own',  // reserved; own-scope is the default when .view.all is absent
  REFRESH_SALES_REPORT: 'sales_report.refresh',
  EDIT_SALES_ENQUIRY: 'sales_report.enquiry.edit', // manually enter each coordinator's Enquiry target/achieved per period

  // Performance Scoreboard — unified per-team leaderboard (Sales + CRM + Design)
  VIEW_SCOREBOARD: 'scoreboard.view',

  // Purchase MIS — the procurement (hr-erp) MIS report embedded here + the
  // Purchase Coordinators section on the Scoreboard.
  VIEW_PURCHASE_MIS: 'purchase_mis.view',

  // Designer MIS — the designers' D2 / D3 / C1 steps, served by hr-erp and
  // scored here on the MIS engine (docs/reports-rules-decisions.md #17–#21).
  // One slug: the page shows every designer to its viewers, as the Scoreboard
  // does, so there is no view-all. scripts/seed-designer-mis-rbac.mjs
  // backfills existing holders.
  VIEW_DESIGNER_MIS: 'designer_mis.view',

  // Advance Pending — "PI Approved · Awaiting Buyer" report (signed PI / advance
  // not received). Page + refresh (republish sheet) + export controls.
  VIEW_ADVANCE_PENDING: 'advance_pending.view',
  REFRESH_ADVANCE_PENDING: 'advance_pending.refresh',
  EXPORT_ADVANCE_PENDING: 'advance_pending.export',
  // Without this the report lists only the PIs the reader owns (PI Data
  // 'Email') — unless they hold the Client Wallet, or Department Analytics'
  // view-all, which already show every PI's advance
  // (lib/reports/piAdvancePending.js).
  VIEW_ALL_ADVANCE_PENDING: 'advance_pending.view_all',

  // Arrived · Payment Pending — "Shipment Arrived But Payment Not Received"
  // report (landed cargo, Final CI still outstanding). Page + export controls,
  // plus the CRM chase note, which is a WRITE: it is held apart from the view
  // permission so a role can read the chase list without annotating it.
  VIEW_ARRIVED_PAYMENT_PENDING: 'arrived_payment_pending.view',
  EXPORT_ARRIVED_PAYMENT_PENDING: 'arrived_payment_pending.export',
  REMARK_ARRIVED_PAYMENT_PENDING: 'arrived_payment_pending.remark',
  // Without this a user sees only the orders whose PI they own. Accounts,
  // management and the directors need the whole book; a CRM chasing payments
  // needs their own, and 143 rows of somebody else's is not a to-do list.
  VIEW_ALL_ARRIVED_PAYMENT_PENDING: 'arrived_payment_pending.view_all',

  // Advance Received — the mirror of Advance Pending. That one is the chase
  // list; this is the green light: the buyers whose advance has actually
  // landed, each row carrying the SWIFT copy. Logistics reads it before they
  // book cargo, so it gets its own slug rather than riding along with the
  // advance_pending grants the CRM side already holds.
  VIEW_ADVANCE_RECEIVED: 'advance_received.view',
  EXPORT_ADVANCE_RECEIVED: 'advance_received.export',

  // Client Tracker permissions (buyer order-tracker — owner Master view)
  VIEW_CLIENT_TRACKER: 'client_tracker.view',
  MANAGE_CLIENT_TRACKER: 'client_tracker.manage',

  // Report Rules — the registry every report will read (lib/rules): calendars,
  // cutoffs, steps, duties, designers and scores, edited at
  // /settings/report-rules. One slug: a save needs a reason and is kept in a
  // history, so reading and writing are not split. Super Admin and Admin by
  // default; scripts/seed-rules-manage-rbac.mjs backfills existing holders.
  MANAGE_RULES: 'rules.manage',

  // PI Import (legacy migration into CRM FMS / SO FMS tabs)
  PI_IMPORT_CRM: 'pi.import.crm',
  PI_IMPORT_SO: 'pi.import.so'
};

export const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    // Full access to everything
    ...Object.values(PERMISSIONS)
  ],
  
  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.CREATE_PI,
    PERMISSIONS.VIEW_PI,
    PERMISSIONS.EDIT_PI,
    PERMISSIONS.DELETE_PI,
    PERMISSIONS.APPROVE_PI,
    PERMISSIONS.REJECT_PI,
    PERMISSIONS.VIEW_ALL_PI,
    PERMISSIONS.VIEW_PI_TRACKER,
    PERMISSIONS.VIEW_ALL_PI_TRACKER,
    PERMISSIONS.REFRESH_PI_TRACKER,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.ADD_TEAM_MEMBER,
    PERMISSIONS.EDIT_TEAM_MEMBER,
    PERMISSIONS.VIEW_MASTER_DATA,
    PERMISSIONS.EDIT_MASTER_DATA,
    PERMISSIONS.VIEW_SETTINGS,
    PERMISSIONS.SETTINGS_NOTIFICATION_MUTE,
    PERMISSIONS.ACCESS_TEAM_CHAT,
    PERMISSIONS.MODERATE_CHAT,
    PERMISSIONS.VIEW_DESIGN_REQUEST,
    PERMISSIONS.CREATE_DESIGN_REQUEST,
    PERMISSIONS.EDIT_DESIGN_REQUEST,
    PERMISSIONS.VIEW_DESIGN_EXHIBITION,
    PERMISSIONS.CREATE_DESIGN_EXHIBITION,
    PERMISSIONS.VIEW_DESIGN_EXHIBITION_APPROVAL,
    PERMISSIONS.APPROVE_DESIGN_EXHIBITION,
    PERMISSIONS.VIEW_DESIGN_APPROVAL,
    PERMISSIONS.DESIGN_APPROVAL_STEP1_READ,
    PERMISSIONS.DESIGN_APPROVAL_STEP1_CREATE,
    PERMISSIONS.DESIGN_APPROVAL_STEP1_UPDATE,
    PERMISSIONS.DESIGN_APPROVAL_STEP2_READ,
    PERMISSIONS.DESIGN_APPROVAL_STEP2_CREATE,
    PERMISSIONS.DESIGN_APPROVAL_STEP2_UPDATE,
    PERMISSIONS.DESIGN_APPROVAL_MANAGEMENT_READ,
    PERMISSIONS.DESIGN_APPROVAL_MANAGEMENT_CREATE,
    PERMISSIONS.DESIGN_APPROVAL_MANAGEMENT_UPDATE,
    PERMISSIONS.DESIGN_APPROVAL_MUTE_NOTIFICATIONS,
    PERMISSIONS.VIEW_ALL_DESIGN_REPORT,
    PERMISSIONS.VIEW_MY_DESIGN_REPORT,
    PERMISSIONS.VIEW_BUYER_MASTER,
    PERMISSIONS.CREATE_BUYER_MASTER,
    PERMISSIONS.EDIT_BUYER_MASTER,
    PERMISSIONS.DELETE_BUYER_MASTER,
    PERMISSIONS.DEACTIVATE_BUYER_MASTER,
    PERMISSIONS.VIEW_GLOBAL_ALERTS,
    PERMISSIONS.CREATE_GLOBAL_ALERT,
    PERMISSIONS.READ_GLOBAL_ALERT,
    PERMISSIONS.DELETE_GLOBAL_ALERT,
    PERMISSIONS.VIEW_TICKETS,
    PERMISSIONS.VIEW_ALL_TICKETS,
    PERMISSIONS.CREATE_TICKET,
    PERMISSIONS.RESOLVE_TICKET,
    PERMISSIONS.CLOSE_TICKET,
    PERMISSIONS.REOPEN_TICKET,
    PERMISSIONS.MANAGE_TICKET_EXTENSIONS,
    PERMISSIONS.VIEW_CLIENT_LEDGER,
    PERMISSIONS.CREATE_CLIENT_LEDGER,
    PERMISSIONS.EDIT_CLIENT_LEDGER,
    PERMISSIONS.DELETE_CLIENT_LEDGER,
    PERMISSIONS.CONFIRM_CLIENT_LEDGER,
    PERMISSIONS.VIEW_CLIENT_REPORT,
    PERMISSIONS.EXPORT_CLIENT_REPORT,
    PERMISSIONS.VIEW_CLIENT_COLLECTION,
    PERMISSIONS.EXPORT_CLIENT_COLLECTION,
    PERMISSIONS.VIEW_PC_REPORT,
    PERMISSIONS.VIEW_ALL_PC_REPORT,
    PERMISSIONS.REFRESH_PC_REPORT,
    PERMISSIONS.EXPORT_PC_REPORT,
    PERMISSIONS.VIEW_MIS_REPORT,
    PERMISSIONS.VIEW_ALL_MIS_REPORT,
    PERMISSIONS.REFRESH_MIS_REPORT,
    PERMISSIONS.EXPORT_MIS_REPORT_CSV,
    PERMISSIONS.EXPORT_MIS_REPORT_EXCEL,
    PERMISSIONS.VIEW_DEPT_ANALYTICS,
    PERMISSIONS.VIEW_ALL_DEPT_ANALYTICS,
    PERMISSIONS.REFRESH_DEPT_ANALYTICS,
    PERMISSIONS.EXPORT_DEPT_ANALYTICS_CSV,
    PERMISSIONS.EXPORT_DEPT_ANALYTICS_EXCEL,
    PERMISSIONS.EXPORT_DEPT_ANALYTICS_PDF,
    PERMISSIONS.VIEW_SALES_REPORT,
    PERMISSIONS.VIEW_ALL_SALES_REPORT,
    PERMISSIONS.REFRESH_SALES_REPORT,
    PERMISSIONS.EDIT_SALES_ENQUIRY,
    PERMISSIONS.VIEW_SCOREBOARD,
    PERMISSIONS.VIEW_PURCHASE_MIS,
    PERMISSIONS.VIEW_DESIGNER_MIS,
    PERMISSIONS.VIEW_ADVANCE_PENDING,
    PERMISSIONS.REFRESH_ADVANCE_PENDING,
    PERMISSIONS.EXPORT_ADVANCE_PENDING,
    PERMISSIONS.VIEW_ALL_ADVANCE_PENDING,
    PERMISSIONS.VIEW_ARRIVED_PAYMENT_PENDING,
    PERMISSIONS.EXPORT_ARRIVED_PAYMENT_PENDING,
    PERMISSIONS.REMARK_ARRIVED_PAYMENT_PENDING,
    PERMISSIONS.VIEW_ALL_ARRIVED_PAYMENT_PENDING,
    // Everything in the settlement lane except the write-off / correction slugs,
    // which stay Super-Admin-only until granted deliberately.
    ...SETTLEMENT_OPERATOR_SLUGS,
    PERMISSIONS.SOFMS_VIEW_ALL,
    PERMISSIONS.SOFMS_MUTE_NOTIFICATIONS,
    PERMISSIONS.FMS_HOLD,
    PERMISSIONS.FMS_EXTEND,
    PERMISSIONS.PI_IMPORT_CRM,
    PERMISSIONS.PI_IMPORT_SO,
    PERMISSIONS.MANAGE_RULES,
    ...Object.entries(PERMISSIONS)
      .filter(([key]) => key.startsWith('MASTER_'))
      .map(([, value]) => value)
  ],
  
  [ROLES.USER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.CREATE_PI,
    PERMISSIONS.VIEW_PI,
    PERMISSIONS.EDIT_PI,
    PERMISSIONS.VIEW_OWN_PI, // Only own PIs
    PERMISSIONS.VIEW_PI_TRACKER,
    PERMISSIONS.VIEW_OWN_PI_TRACKER,
    PERMISSIONS.ACCESS_TEAM_CHAT,
    PERMISSIONS.VIEW_MY_DESIGN_REPORT,
    PERMISSIONS.VIEW_TICKETS,
    PERMISSIONS.CREATE_TICKET
    // Removed VIEW_MASTER_DATA - Users should not see Master Data
  ],
  
  [ROLES.GUEST]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_PI,
    PERMISSIONS.VIEW_OWN_PI // Only own PIs
    // Removed VIEW_MASTER_DATA - Guests should not see Master Data
  ]
};

export const PAGE_PERMISSIONS = {
  '/dashboard': [PERMISSIONS.VIEW_DASHBOARD],
  '/pi/new': [PERMISSIONS.CREATE_PI],
  '/pi/approved': [PERMISSIONS.VIEW_PI],
  '/pi/unapproved': [PERMISSIONS.VIEW_PI],
  '/pi/rejected': [PERMISSIONS.VIEW_PI],
  '/pi/tracker': [PERMISSIONS.VIEW_PI_TRACKER],
  '/team': [PERMISSIONS.VIEW_TEAM],
  '/master': [PERMISSIONS.VIEW_MASTER_DATA],
  '/admin': [PERMISSIONS.ACCESS_ADMIN_PANEL],
  '/design': [PERMISSIONS.VIEW_DESIGN_REQUEST],
  '/design/approval': [PERMISSIONS.VIEW_DESIGN_APPROVAL],
  '/design/exhibition-approval': [PERMISSIONS.VIEW_DESIGN_EXHIBITION_APPROVAL],
  '/design/report': [PERMISSIONS.VIEW_ALL_DESIGN_REPORT, PERMISSIONS.VIEW_MY_DESIGN_REPORT],
  '/pc-report': [PERMISSIONS.VIEW_PC_REPORT],
  '/pc-report/mis': [PERMISSIONS.VIEW_MIS_REPORT],
  '/pc-report/department-analytics': [PERMISSIONS.VIEW_DEPT_ANALYTICS],
  '/sales-report': [PERMISSIONS.VIEW_SALES_REPORT],
  '/scoreboard': [PERMISSIONS.VIEW_SCOREBOARD],
  '/reports/pi-advance-pending': [PERMISSIONS.VIEW_ADVANCE_PENDING],
  '/reports/arrived-payment-pending': [PERMISSIONS.VIEW_ARRIVED_PAYMENT_PENDING],
  '/reports/advance-received': [PERMISSIONS.VIEW_ADVANCE_RECEIVED],
  '/reports/crm-mis': [PERMISSIONS.VIEW_MIS_REPORT],
  '/purchase-mis': [PERMISSIONS.VIEW_PURCHASE_MIS],
  '/reports/designer-mis': [PERMISSIONS.VIEW_DESIGNER_MIS],
  '/master/buyer': [PERMISSIONS.VIEW_BUYER_MASTER],
  '/global-alerts': [PERMISSIONS.VIEW_GLOBAL_ALERTS],
  '/custom-notifications': [PERMISSIONS.VIEW_CUSTOM_ALERTS],
  '/overview': [PERMISSIONS.VIEW_SUPER_OVERVIEW],
  '/tickets': [PERMISSIONS.VIEW_TICKETS],
  '/buyers/wallet': [PERMISSIONS.VIEW_CLIENT_LEDGER],
  '/buyers/ledger': [PERMISSIONS.VIEW_CLIENT_LEDGER],
  '/buyers/report': [PERMISSIONS.VIEW_CLIENT_REPORT],
  '/buyers/collection-report': [PERMISSIONS.VIEW_CLIENT_COLLECTION],
  '/buyers/bank-charges': [PERMISSIONS.VIEW_CLIENT_COLLECTION],
  '/buyers/settlement': [PERMISSIONS.VIEW_PAYMENT_SETTLEMENT],
  '/buyers/tracker': [PERMISSIONS.VIEW_CLIENT_TRACKER, PERMISSIONS.MANAGE_CLIENT_TRACKER],
  '/settings/report-rules': [PERMISSIONS.MANAGE_RULES]
};

// Helper functions
export const isSuperAdmin = (email) => {
  return SUPER_ADMIN_EMAILS.includes(email?.toLowerCase());
};

export const hasPermission = (userPermissions, requiredPermission) => {
  return userPermissions?.includes(requiredPermission) || false;
};

export const hasAnyPermission = (userPermissions, requiredPermissions) => {
  return requiredPermissions.some(permission => 
    userPermissions?.includes(permission)
  );
};

export const canAccessPage = (userPermissions, pagePath) => {
  if (!userPermissions || userPermissions.length === 0) return false;

  // Module-prefix map: route → permission prefixes that grant access
  // A user with ANY permission matching these prefixes can access the route
  const MODULE_PREFIXES = {
    '/master': ['master.', 'buyer_master.', 'view_master_data'],
    '/master/buyer': ['buyer_master.', 'master.buyer', 'view_buyer_master'],
    '/design': ['design.', 'design_request.', 'view_design_request'],
    '/design/approval': ['design_approval.', 'view_design_approval'],
    '/design/report': ['design_report.', 'view_all_design_report', 'view_my_design_report'],
    '/pi': ['pi.', 'create_pi', 'view_pi', 'view_all_pi', 'view_own_pi'],
    '/pi/fms': ['fms.', 'crm_fms.', 'view_fms'],
    '/pi/sofms': ['sofms.', 'so_fms.', 'view_sofms'],
    '/pi/tracker': ['pi_tracker.', 'view_pi_tracker'],
    '/team': ['team.', 'view_team'],
    '/admin': ['admin.', 'access_admin_panel', 'manage_roles', 'manage_permissions'],
    '/global-alerts': ['global_alerts.'],
    '/custom-notifications': ['custom_alerts.'],
    '/overview': ['overview.', 'view_super_overview'],
    '/tickets': ['ticket.', 'tickets.', 'ticket', 'view_tickets'],
    '/pc-report/mis': ['mis_report.'],
    '/pc-report/department-analytics': ['dept_analytics.'],
    '/pc-report': ['pc_report.', 'view_pc_report'],
    '/reports/pi-advance-pending': ['advance_pending.'],
    '/reports/arrived-payment-pending': ['arrived_payment_pending.'],
    '/reports/advance-received': ['advance_received.'],
    '/sales-report': ['sales_report.'],
    '/buyers/wallet': ['client_ledger.'],
    '/buyers/ledger': ['client_ledger.'],
    '/buyers/report': ['client_report.'],
    '/buyers/settlement': ['payment_settlement.'],
    '/buyers/tracker': ['client_tracker.'],
  };

  // Sort paths by length descending to match most specific route first
  const sortedPaths = Object.keys(PAGE_PERMISSIONS).sort((a, b) => b.length - a.length);
  
  // Find the first matching prefix or exact match
  const matchedPath = sortedPaths.find(p => 
    pagePath === p || pagePath.startsWith(p + '/')
  );

  // 1. Check exact PAGE_PERMISSIONS match (legacy slugs)
  if (matchedPath) {
    const requiredPermissions = PAGE_PERMISSIONS[matchedPath];
    if (hasAnyPermission(userPermissions, requiredPermissions)) return true;
  }
  
  // 2. Fallback: check module-prefix match (granular slugs like master.brands.read)
  const modulePaths = Object.keys(MODULE_PREFIXES).sort((a, b) => b.length - a.length);
  const moduleMatch = modulePaths.find(route =>
    pagePath === route || pagePath.startsWith(route + '/')
  );

  if (moduleMatch) {
    const prefixes = MODULE_PREFIXES[moduleMatch];
    return prefixes.some(prefix =>
      userPermissions.some(p => p === prefix || p.startsWith(prefix))
    );
  }

  // 3. If route is in PAGE_PERMISSIONS but both checks failed → deny
  if (matchedPath) return false;
  
  // 4. Not in any map → public page, allow
  return true;
};

export const getUserRole = (email, userRole) => {
  if (isSuperAdmin(email)) {
    return ROLES.SUPER_ADMIN;
  }
  return userRole || ROLES.GUEST;
};

export const getRolePermissions = (role) => {
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
};

// ══ REPORTS PAGE ═════════════════════════════════
// Report types config
const RPT={
  // 💰 Recovery
  recovery:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',lbl:'Receiving Ledger', sub:'All payments received — by date, type or staff', sec:'💰 Recovery',   subs:[{id:'all',lbl:'All Payments'},{id:'daily',lbl:'Daily'},{id:'monthly',lbl:'Monthly'},{id:'bytype',lbl:'By Type'},{id:'bystaff',lbl:'By Staff'}]},
  outstanding:   {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',lbl:'Outstanding',       sub:'Overdue & upcoming dues',     sec:'💰 Recovery',   subs:[{id:'overdue',lbl:'Overdue'},{id:'upcoming',lbl:'Upcoming (30d)'},{id:'all',lbl:'All Dues'}]},
  statement:     {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',lbl:'Client Ledger',     sub:'Per-client running account',  sec:'💰 Recovery',   subs:[{id:'unit',lbl:'By Unit'},{id:'client',lbl:'By Client Name'}]},
  // 🏗️ Project
  project:       {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',lbl:'Project Summary',  sub:'Project financial overview',  sec:'🏗️ Project',   subs:[{id:'summary',lbl:'Summary'},{id:'units',lbl:'All Units'}]},
  unit:          {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',lbl:'Unit Inventory',    sub:'Unit status report',          sec:'🏗️ Project',   subs:[{id:'all',lbl:'All Units'},{id:'sold',lbl:'Sold'},{id:'available',lbl:'Available'},{id:'overdue',lbl:'Overdue'},{id:'adjustment',lbl:'Adjustment'},{id:'cashsale',lbl:'Cash Sale'}]},
  floor_type:    {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',lbl:'Floor / Type',      sub:'Breakdown by floor & type',   sec:'🏗️ Project',   subs:[{id:'floor',lbl:'By Floor'},{id:'type',lbl:'By Unit Type'}]},
  unit_status:   {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',lbl:'Units by Status',   sub:'Status-wise unit count, value & recovery', sec:'🏗️ Project',   subs:[{id:'summary',lbl:'Summary'},{id:'detail',lbl:'Detailed List'}]},
  sale_type:     {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',lbl:'Sales by Type',     sub:'Deal-type breakdown — Cash / Installment / Adjustment …', sec:'🧾 Sales',     subs:[{id:'summary',lbl:'Summary'},{id:'detail',lbl:'Detailed List'}]},
  // 🧾 Sales
  sales_register:{ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',lbl:'Sales Register',   sub:'All sales transactions',      sec:'🧾 Sales',      subs:[{id:'all',lbl:'All'},{id:'installment',lbl:'Installment'},{id:'cash',lbl:'Full Cash'}]},
  discount:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',lbl:'Discount Report',   sub:'Discounts given on sales',    sec:'🧾 Sales',      subs:[{id:'all',lbl:'All Discounts'}]},
  cancelled:     {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',lbl:'Cancellations',     sub:'Cancelled sales',             sec:'🧾 Sales',      subs:[{id:'all',lbl:'All Cancelled'}]},
  // 👨‍💼 Agent
  commission:    {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',lbl:'Commission',         sub:'Earned vs paid',              sec:'👨‍💼 Agent',    subs:[{id:'all',lbl:'All Agents'},{id:'pending',lbl:'Pending Only'}]},
  agent_recovery:{ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',lbl:'Agent Recovery',    sub:'Collections per agent',       sec:'👨‍💼 Agent',    subs:[{id:'all',lbl:'All Agents'}]},
  commission_hist:{ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',lbl:'Comm. History',    sub:'Commission payment log',      sec:'👨‍💼 Agent',    subs:[{id:'all',lbl:'All'}]},
  staff:         {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',lbl:'Staff Report',       sub:'Staff performance metrics',   sec:'👨‍💼 Agent',    subs:[{id:'summary',lbl:'Summary'},{id:'payments',lbl:'Payments'},{id:'calls',lbl:'Calls'}]},
  // 👤 Client
  client:        {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',lbl:'Client Portfolio',  sub:'All clients & units',         sec:'👤 Client',     subs:[{id:'list',lbl:'Client List'},{id:'defaulters',lbl:'Defaulters'},{id:'ledger',lbl:'Client Ledger'}]},
  // 🏠 Possession
  possession:           {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',lbl:'Possession Status',    sub:'Handover tracking',                sec:'🏠 Possession', subs:[{id:'all',lbl:'All'},{id:'pending',lbl:'Pending'},{id:'completed',lbl:'Completed'}]},
  post_possession_dues: {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',lbl:'Post-Possession Dues', sub:'Handed-over units with open dues', sec:'🏠 Possession', subs:[{id:'all',lbl:'All'}]},
  // ⚖️ Compliance
  legal_portfolio:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>',lbl:'Legal Cases Portfolio', sub:'Units & clients with active legal cases', sec:'⚖️ Compliance', subs:[{id:'all',lbl:'All Cases'},{id:'active',lbl:'Active Only'},{id:'resolved',lbl:'Resolved'}]},
  transfers_register:   {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',lbl:'Transfers Register',  sub:'Unit ownership transfer log',           sec:'⚖️ Compliance', subs:[{id:'all',lbl:'All Transfers'}]},
  // 🧾 PDC
  pdc:           {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',lbl:'PDC Register',      sub:'Post-dated cheque register & status', sec:'🧾 PDC',        subs:[{id:'all',lbl:'All'},{id:'pending',lbl:'Pending'},{id:'cleared',lbl:'Cleared'},{id:'bounced',lbl:'Bounced'}]},
  pdc_upcoming:  {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',lbl:'Upcoming Cheques',  sub:'Due in next 30 days',         sec:'🧾 PDC',        subs:[{id:'7d',lbl:'Next 7 Days'},{id:'30d',lbl:'Next 30 Days'}]},
  // 🎯 CRM
  contacts:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.48 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.72 6.72l.83-.83a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',lbl:'Follow-up Log',     sub:'Call & contact history',      sec:'🎯 CRM',        subs:[{id:'all',lbl:'All Logs'},{id:'overdue',lbl:'Follow-up Overdue'},{id:'today',lbl:'Due Today'},{id:'upcoming',lbl:'Upcoming'},{id:'willpay',lbl:'Will Pay'}]},
  followup:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',lbl:'Follow-up Schedule',sub:'Scheduled follow-ups',        sec:'🎯 CRM',        subs:[{id:'all',lbl:'All'},{id:'overdue',lbl:'Overdue'},{id:'today',lbl:'Today'},{id:'upcoming',lbl:'Upcoming'}]},
  activity:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',lbl:'Daily Activity',    sub:'Staff activity report',       sec:'🎯 CRM',        subs:[{id:'all',lbl:'All Staff'},{id:'bystaff',lbl:'By Staff'}]},
  // 📊 Executive
  executive:     {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',lbl:'Executive Summary', sub:'Business KPIs & overview',    sec:'📊 Executive',  subs:[{id:'summary',lbl:'Overview'}]},
  monthly_trend: {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',lbl:'Collection Trend',  sub:'Month-wise collection trend', sec:'📊 Executive',  subs:[{id:'all',lbl:'All Time'},{id:'year',lbl:'This Year'}]},
  tax_report:    {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>',lbl:'Tax / WHT',         sub:'FBR WHT compliance',          sec:'📊 Executive',  subs:[{id:'all',lbl:'All'}]},
  aging:         {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',lbl:'Aging Analysis',    sub:'Overdue bucket report',       sec:'📊 Executive',  subs:[{id:'all',lbl:'All Overdue'},{id:'30',lbl:'30+ Days'},{id:'60',lbl:'60+ Days'},{id:'90',lbl:'90+ Days'},{id:'180',lbl:'180+ Days'}]},
  // 💰 Recovery (extras)
  promise_tracker:{ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',lbl:'Promise Tracker',  sub:'Payment promises — kept, broken & due', sec:'💰 Recovery', subs:[{id:'all',lbl:'All'},{id:'overdue',lbl:'Overdue'},{id:'today',lbl:'Due Today'},{id:'upcoming',lbl:'Upcoming'},{id:'kept',lbl:'Kept'},{id:'broken',lbl:'Broken'}]},
  field_visits:  {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',lbl:'Field Visits',     sub:'Recovery officer site visits log', sec:'💰 Recovery', subs:[{id:'all',lbl:'All Visits'}]},
  recovery_position:{ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',lbl:'Recovery Position (Grand Summary)', sub:'Per-unit DP / old / current buckets, officer recovery & month grand totals', sec:'💰 Recovery', subs:[]},
  // 🧾 Financial
  payables:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',lbl:'Payables',         sub:'Refunds & amounts payable to clients', sec:'🧾 Financial', subs:[{id:'all',lbl:'All'},{id:'pending',lbl:'Pending'},{id:'partial',lbl:'Partial'},{id:'paid',lbl:'Paid'}]},
  // 🤖 AI & Analytics
  ai_radar:      {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',lbl:'AI Radar Summary', sub:'Top AI-scored recovery prospects', sec:'🤖 AI', subs:[{id:'all',lbl:'Top Prospects'}]},
  forecasting:   {ic:'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',lbl:'Forecasting Report', sub:'Predicted collection — next 30 / 60 / 90 days', sec:'🤖 AI', subs:[{id:'all',lbl:'Forecast'}]},
};

const _RPT_SEC_COL={'💰 Recovery':'#7FB069','🏗️ Project':'#7C9FD4','🧾 Sales':'#D4A574','👨‍💼 Agent':'#B07CB0','👤 Client':'#7CBCBC','🏠 Possession':'#D47C7C','🧾 PDC':'#7CB0D4','🎯 CRM':'#D4C87C','📊 Executive':'#8FB07C','⚖️ Compliance':'#A78B9F','🧾 Financial':'#4F46E5','🤖 AI':'#7C3AED'};
const _RPT_SEC_ORDER=['💰 Recovery','🏗️ Project','🧾 Sales','👨‍💼 Agent','👤 Client','🏠 Possession','🧾 PDC','🎯 CRM','📊 Executive','⚖️ Compliance'];

// ══ REPORTS HUB — Department config ══════════════════════════════════════
const _DEPTS=[
  {id:'recovery',  title:'Recovery & Collections',  desc:'Outstanding dues, aging buckets, collection performance, agent activity, promises and field visits', col:'#DC2626', reports:['recovery_position','outstanding','aging','monthly_trend','agent_recovery','promise_tracker','field_visits']},
  {id:'financial', title:'Financial & Accounts',     desc:'Receiving ledger, per-client running accounts and payables',                    col:'#4F46E5', reports:['recovery','statement','payables']},
  {id:'operational',title:'Operational',             desc:'Sales register, unit status, sale-type breakdown, post-dated cheques and cancellations', col:'#16A34A', reports:['sales_register','unit_status','sale_type','pdc','cancelled']},
  {id:'ai',        title:'AI & Analytics',           desc:'AI-scored recovery prospects and collection forecasting',                       col:'#7C3AED', reports:['ai_radar','forecasting']},
];

const _RPT_TAGS={
  recovery_position:'recovery position grand summary dead recovery dp down payment old outstanding net position month installment officer commission pdc in hand legal flag paid percent',
  outstanding:    'outstanding dues overdue receivable pending owed',
  aging:          'aging bucket overdue days 30 60 90 180 past due',
  monthly_trend:  'monthly trend collection chart history graph',
  agent_recovery: 'agent recovery collection staff performance',
  recovery:       'payments recovery all register receipts history',
  statement:      'statement ledger client account balance running',
  sales_register: 'sales register transactions deals history',
  discount:       'discount concession price reduction',
  cancelled:      'cancelled cancellation refund terminated',
  project:        'project summary financial overview p&l',
  unit:           'unit inventory status available sold booked',
  unit_status:    'units by status wise breakdown count value recovery available sold booked installment reserved hold possession mortgaged transfer dead cancelled inventory summary',
  sale_type:      'sales by deal type cash installment adjustment full payment plan breakdown bookings register count value',
  floor_type:     'floor type breakdown area sqft configuration',
  possession:          'possession handover delivery checklist snagging',
  post_possession_dues:'post possession dues outstanding overdue installment after handover',
  client:         'client customer portfolio defaulters list',
  commission:     'commission agent earned pending balance',
  commission_hist:'commission history payments log disbursement',
  staff:          'staff performance team calls payments collected',
  activity:       'daily activity log staff calls report',
  contacts:       'contacts follow-up call log history crm',
  followup:       'followup follow-up schedule upcoming overdue',
  pdc:            'pdc cheque post-dated bank clearing status',
  pdc_upcoming:   'pdc upcoming cheque due maturity schedule',
  tax_report:     'tax wht fbr withholding compliance',
  executive:           'executive summary kpi overview director management',
  legal_portfolio:     'legal cases court notice arbitration settlement claim outstanding compliance',
  transfers_register:  'transfer ownership unit transfer voucher register compliance',
};

// ── Persistence helpers (per-user localStorage) ──
function _rptUK(){return 'rpt_'+(S&&S.userId?S.userId:'anon')+'_'+(S&&S.cid?S.cid:'');}
function _rptGetFavs(){try{return JSON.parse(localStorage.getItem(_rptUK()+'favs')||'[]');}catch{return[];}}
function _rptSetFavs(a){try{localStorage.setItem(_rptUK()+'favs',JSON.stringify(a));}catch{}}
function _rptGetRecent(){try{return JSON.parse(localStorage.getItem(_rptUK()+'recent')||'[]');}catch{return[];}}
function _rptAddRecent(k){try{let r=_rptGetRecent().filter(x=>x!==k);r.unshift(k);if(r.length>10)r=r.slice(0,10);localStorage.setItem(_rptUK()+'recent',JSON.stringify(r));}catch{}}
function _rptGetViews(){try{return JSON.parse(localStorage.getItem(_rptUK()+'views')||'{}');}catch{return{};}}
function _rptAddView(k){try{const v=_rptGetViews();v[k]=(v[k]||0)+1;localStorage.setItem(_rptUK()+'views',JSON.stringify(v));}catch{}}
// Last-run timestamps + collapsed-section state (per user)
function _rptGetRuns(){try{return JSON.parse(localStorage.getItem(_rptUK()+'runs')||'{}');}catch{return{};}}
function _rptSetLastRun(k){try{const r=_rptGetRuns();r[k]=Date.now();localStorage.setItem(_rptUK()+'runs',JSON.stringify(r));}catch{}}
function _rptLastRunLabel(k){
  const ts=_rptGetRuns()[k];
  if(!ts)return'Never run';
  const diff=Date.now()-ts,day=86400000;
  if(diff<60000)return'Just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<day)return Math.floor(diff/3600000)+'h ago';
  if(diff<7*day)return Math.floor(diff/day)+'d ago';
  try{return new Date(ts).toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'});}catch{return'—';}
}
function _rptGetCollapsed(){try{return JSON.parse(localStorage.getItem(_rptUK()+'collapsed')||'[]');}catch{return[];}}
function _rptSetCollapsed(a){try{localStorage.setItem(_rptUK()+'collapsed',JSON.stringify(a));}catch{}}

// ── Lucide icon helper ──
const _RH_ICONS={
  'alert-circle':'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  'trending-up':'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'briefcase':'<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'home':'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'alert-triangle':'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'trending-down':'<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  'bar-chart-2':'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  'users':'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user':'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'tag':'<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  'x-circle':'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  'layout':'<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  'package':'<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  'layers':'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  'phone':'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.48 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9a16 16 0 0 0 6.72 6.72l.83-.83a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'calendar':'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'credit-card':'<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  'pie-chart':'<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'activity':'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'clock':'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'search':'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'check-circle':'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'star':'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'chevron-down':'<polyline points="6 9 12 15 18 9"/>',
};
function _rhi(name,size){
  size=size||16;
  const p=_RH_ICONS[name]||'<circle cx="12" cy="12" r="10"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// Icon mapping per report key
const _RH_CARD_IC={
  recovery_position:'bar-chart-2',
  outstanding:'alert-circle', aging:'clock', monthly_trend:'trending-up',
  agent_recovery:'activity', recovery:'bar-chart-2', statement:'file-text',
  sales_register:'tag', discount:'tag', cancelled:'x-circle',
  project:'layers', unit:'package', floor_type:'layout', possession:'home', post_possession_dues:'alert-triangle',
  client:'user', commission:'briefcase', commission_hist:'file-text',
  staff:'users', activity:'activity', contacts:'phone', followup:'calendar',
  pdc:'credit-card', pdc_upcoming:'calendar', tax_report:'pie-chart',
  executive:'pie-chart',
  legal_portfolio:'file-text', transfers_register:'repeat',
};

// ── SVG sparkline generator ──
function _rptSparkline(data,color,key){
  if(!data||data.length<2)return'';
  const w=200,h=32;
  const min=Math.min(...data),max=Math.max(...data),range=(max-min)||1;
  const pts=data.map((v,i)=>{const x=((i/(data.length-1))*w).toFixed(1);const y=(h-((v-min)/range)*(h-8)-4).toFixed(1);return x+','+y;});
  const fill='0,'+h+' '+pts.join(' ')+' '+w+','+h;
  const gid='rsg_'+key;
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${fill}" fill="url(#${gid})"/><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ── Sparkline data from cache ──
function _rptSparkData(key){
  const def=[3,5,4,7,6,9,8];
  try{
    const now=new Date();
    const units=typeof gunits==='function'?gunits():(window._unitsCache||[]);
    const sold=units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
    const mos=Array.from({length:7},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-(6-i),1);return{yr:d.getFullYear(),mo:d.getMonth()};});
    if(key==='recovery'||key==='outstanding'||key==='monthly_trend'||key==='agent_recovery'){
      const d=mos.map(m=>sold.filter(u=>{if(!u.lastPaymentDate)return false;const dd=new Date(u.lastPaymentDate);return dd.getFullYear()===m.yr&&dd.getMonth()===m.mo;}).reduce((s,u)=>s+Number(u.totalPaid||0),0));
      if(d.some(v=>v>0))return d.map(v=>Math.max(v,1));
    }
    if(key==='sales_register'){
      const d=mos.map(m=>sold.filter(u=>{if(!u.saleDate)return false;const dd=new Date(u.saleDate+'T00:00:00');return dd.getFullYear()===m.yr&&dd.getMonth()===m.mo;}).length);
      if(d.some(v=>v>0))return d.map(v=>Math.max(v,0.5));
    }
    if(key==='contacts'||key==='followup'||key==='activity'){
      const logs=window._contactLogsCache||[];
      const d=mos.map(m=>logs.filter(l=>{if(!l.contact_date)return false;const dd=new Date(l.contact_date+'T00:00:00');return dd.getFullYear()===m.yr&&dd.getMonth()===m.mo;}).length);
      if(d.some(v=>v>0))return d.map(v=>Math.max(v,0.5));
    }
    if(key==='aging'){
      const d=mos.map((m,i)=>sold.filter(u=>{const ds=typeof daysSincePay==='function'?daysSincePay(u):null;const ap=typeof actualPending==='function'?actualPending(u):Math.max(0,Number(u.totalPrice||0)-Number(u.totalPaid||0));return ap>0&&(ds===null||ds>=(i+1)*10);}).length);
      if(d.some(v=>v>0))return d.map(v=>Math.max(v,0.5));
    }
  }catch(e){}
  return def;
}

// ── Key metric value from cache ──
function _rptCardMetric(key){
  try{
    const units=typeof gunits==='function'?gunits():(window._unitsCache||[]);
    const sold=units.filter(u=>u.status!=='Available'&&u.status!=='Dead');
    const ap=u=>typeof actualPending==='function'?actualPending(u):Math.max(0,Number(u.totalPrice||0)-Number(u.totalPaid||0));
    const fm=v=>typeof fM==='function'?fM(v):v.toLocaleString();
    switch(key){
      case 'outstanding':{const v=sold.reduce((s,u)=>s+ap(u),0);return{v:fm(v),l:'outstanding balance'};}
      case 'recovery':{const v=sold.reduce((s,u)=>s+Number(u.totalPaid||0),0);return{v:fm(v),l:'total collected'};}
      case 'aging':{const v=sold.filter(u=>{const d=typeof daysSincePay==='function'?daysSincePay(u):null;return ap(u)>0&&(d===null||d>=30);}).length;return{v,l:'overdue accounts'};}
      case 'monthly_trend':return{v:'12 mo',l:'trend history'};
      case 'agent_recovery':{const v=sold.reduce((s,u)=>s+Number(u.totalPaid||0),0);return{v:fm(v),l:'total collected'};}
      case 'statement':{const cl=[...new Set(sold.map(u=>u.customerName).filter(Boolean))];return{v:cl.length,l:'clients'};}
      case 'sales_register':return{v:sold.length,l:'total sales'};
      case 'discount':{const d=sold.filter(u=>Number(u.discount||0)>0);return{v:d.length,l:'discounted sales'};}
      case 'cancelled':{const v=units.filter(u=>(u.status||'').toLowerCase().includes('cancel')).length;return{v,l:v===1?'cancellation':'cancellations'};}
      case 'project':{const p=window._projectsCache||[];return{v:p.length||'—',l:'projects'};}
      case 'unit':return{v:units.length,l:'total units'};
      case 'floor_type':{const f=[...new Set(units.map(u=>u.floor||u.floorLabel).filter(Boolean))];return{v:f.length||'—',l:'floors tracked'};}
      case 'possession':return{v:sold.length,l:'sold units'};
      case 'post_possession_dues':return{v:'—',l:'units with dues'};
      case 'client':{const cl=[...new Set(sold.map(u=>u.customerName).filter(Boolean))];return{v:cl.length,l:'clients'};}
      case 'commission':{const agSales=sold.filter(u=>u.agentId||u.agentName||u.agent_id);const pend=agSales.reduce((s,u)=>s+Number(u.commissionAmount||u.commission_amount||u.pendingCommission||0),0);return{v:fm(pend),l:'PKR pending'};}
      case 'commission_hist':{const agSales=sold.filter(u=>u.agentId||u.agentName||u.agent_id);return{v:agSales.length,l:'transactions'};}
      case 'staff':{const ag=(window._appUsersCache||[]).filter(u=>(u.role||u.userRole||'').toLowerCase().includes('agent'));return{v:ag.length||(window._appUsersCache||[]).length||0,l:'active agents'};}
      case 'contacts':return{v:(window._contactLogsCache||[]).length,l:'contact logs'};
      case 'followup':{const t=new Date().toISOString().slice(0,10);const v=(window._contactLogsCache||[]).filter(l=>l.next_followup_date&&l.next_followup_date>=t).length;return{v,l:'upcoming follow-ups'};}
      case 'activity':{const t=new Date().toISOString().slice(0,10);const v=(window._contactLogsCache||[]).filter(l=>l.contact_date===t).length;return{v,l:"today's activities"};}
      case 'pdc':return{v:'—',l:'cheque status'};
      case 'pdc_upcoming':return{v:'—',l:'upcoming cheques'};
      case 'tax_report':return{v:'—',l:'WHT compliance'};
      case 'executive':return{v:sold.length,l:'units tracked'};
      case 'legal_portfolio':return{v:'—',l:'legal cases'};
      case 'transfers_register':return{v:'—',l:'transfers'};
      default:return{v:'—',l:'open report'};
    }
  }catch(e){return{v:'—',l:'view report'};}
}

// ── Search live filter ──
function _rptDoSearch(q){
  const body=document.getElementById('rh-body');if(!body)return;
  const term=(q||'').toLowerCase().trim();
  _rhClearEmpty();
  if(!term){body.querySelectorAll('.rh-row,.rh-section').forEach(el=>el.style.display='');_rhApplyCollapsedState();_rhUpdateNavCounts();return;}
  body.querySelectorAll('.rh-section').forEach(sec=>{
    let any=false;
    sec.querySelectorAll('.rh-row').forEach(row=>{
      const match=(row.dataset.search||'').includes(term);
      row.style.display=match?'':'none';
      if(match)any=true;
    });
    sec.style.display=any?'':'none';
    if(any)sec.classList.remove('collapsed');   // auto-expand sections with matches
  });
  const anyVis=body.querySelector('.rh-section:not([style*="none"])');
  if(!anyVis) _rhShowEmpty(`No reports match "<b>${esc(q)}</b>"`, 'Try a different keyword or <button class="rh-no-results-clr" onclick="_rhClearSearch()">clear search</button>');
}

function _rhClearSearch(){
  const inp=document.getElementById('rh-srch');
  if(inp){inp.value='';inp.focus();}
  _rptDoSearch('');
}

function _rhShowEmpty(title, sub){
  const body=document.getElementById('rh-body');if(!body)return;
  let msg=document.getElementById('rh-empty-msg');
  if(!msg){msg=document.createElement('div');msg.id='rh-empty-msg';body.prepend(msg);}
  msg.className='rh-no-results';
  msg.innerHTML=`<div class="rh-no-results-icon">${_rhi('search',32)}</div><div class="rh-no-results-title">${title}</div><div class="rh-no-results-sub">${sub||''}</div>`;
}

function _rhClearEmpty(){
  const msg=document.getElementById('rh-empty-msg');if(msg)msg.remove();
}

// ── Filter pills ──
function _rptSetTab(tab,btn){
  document.querySelectorAll('.rh-pill,.rh-nav-item[data-filter]').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  // sync pill if called from nav, and sync nav if called from pill
  if(btn){
    document.querySelectorAll('[data-filter="'+tab+'"]').forEach(b=>b.classList.add('active'));
  }
  const body=document.getElementById('rh-body');if(!body)return;
  const srch=document.getElementById('rh-srch');if(srch)srch.value='';
  _rhClearEmpty();
  if(tab==='all'){body.querySelectorAll('.rh-row,.rh-section').forEach(el=>el.style.display='');_rhApplyCollapsedState();_rhUpdateNavCounts();return;}
  let list=[];
  if(tab==='favorites') list=_rptGetFavs();
  else if(tab==='recent') list=_rptGetRecent();
  else if(tab==='mostused'){const v=_rptGetViews();list=Object.entries(v).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);}
  let tot=0;
  body.querySelectorAll('.rh-section').forEach(sec=>{
    let any=false;
    sec.querySelectorAll('.rh-row').forEach(row=>{const show=list.includes(row.dataset.key);row.style.display=show?'':'none';if(show){any=true;tot++;}});
    sec.style.display=any?'':'none';
    if(any)sec.classList.remove('collapsed');   // expand sections that have filter matches
  });
  if(!tot){
    const isFav=tab==='favorites',isMU=tab==='mostused';
    const t=isFav?'No saved reports yet':isMU?'No reports opened yet':'No recent reports';
    const s=isFav?'Click ★ on any report card to save it here':isMU?'Open any report to see your most-used here':'Open any report to see it here';
    _rhShowEmpty(t,s);
  }
  _rhUpdateNavCounts();
}

// ── Star toggle with animation + toast ──
function _rptToggleFav(key,btn){
  event.stopPropagation();
  let favs=_rptGetFavs();
  const idx=favs.indexOf(key);
  const adding=idx<0;
  if(adding){favs.push(key);btn.classList.add('on');}else{favs.splice(idx,1);btn.classList.remove('on');}
  _rptSetFavs(favs);
  btn.classList.add('pop');
  setTimeout(()=>btn.classList.remove('pop'),300);
  _rhToast(adding?'Saved to favorites':'Removed from saved');
  // update pill counts
  const pill=document.querySelector('.rh-pill[data-filter="favorites"]');
  if(pill){const fc=_rptGetFavs().length;pill.textContent=fc?`Saved ${fc}`:'Saved';}
}

function _rhToast(msg){
  let t=document.getElementById('rh-toast');
  if(t)t.remove();
  t=document.createElement('div');t.id='rh-toast';t.className='rh-toast';
  t.innerHTML=_rhi('check-circle',14)+' '+esc(msg);
  document.body.appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),300);},2500);
}

// ── KPI strip ──
async function _rptLoadKPIs(){
  const el=document.getElementById('rh-kpi-strip');if(!el)return;
  function _kc(col,pct){const dir=pct>2?'up':pct<-2?'down':'neu';const sym=pct>0?'↑':'↓';const t=dir==='neu'?'—':sym+' '+Math.abs(pct)+'%';return `<span class="rh-kpi-trend ${dir}">${t}</span><span class="rh-kpi-vs">vs last month</span>`;}
  try{
    const today=td();const now=new Date();
    const ms=today.slice(0,7)+'-01';
    const lm1=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,10);
    const lm2=new Date(now.getFullYear(),now.getMonth(),0).toISOString().slice(0,10);
    const [{data:mPays=[]},{data:lmPays=[]},{data:activeSales=[]},{data:instOS=[]}]=await Promise.all([
      supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: { columns: 'amount', date_from: ms, date_to: today } }),
      supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: { columns: 'amount', date_from: lm1, date_to: lm2 } }),
      supabase.rpc('list_sales_filtered', { p_company_id: S.cid, p_filters: { status: 'active' } }),
      supabase.rpc('list_installments_filtered', { p_company_id: S.cid, p_filters: { status_in: 'pending,partial,overdue' } }),
    ]);
    const saleCnt = activeSales.length;
    const mColl=mPays.reduce((s,p)=>s+Number(p.amount||0),0);
    const lmColl=lmPays.reduce((s,p)=>s+Number(p.amount||0),0);
    const totalOS=instOS.reduce((s,r)=>s+Number(r.outstanding||0),0);
    const ovU=(window._unitsCache||[]).filter(u=>u.status!=='Available'&&u.status!=='Dead'&&actualPending(u)>0).length;
    const mn=now.toLocaleString('en-PK',{month:'long'});
    const collPct=lmColl>0?Math.round((mColl-lmColl)/lmColl*100):0;
    el.innerHTML=`
      <div class="rh-kpi-card" onclick="openRptViewer('outstanding')" title="View Outstanding Report">
        <div class="rh-kpi-icon" style="background:rgba(220,38,38,0.10);color:#DC2626">${_rhi('alert-circle',18)}</div>
        <div class="rh-kpi-body">
          <div class="rh-kpi-label">Total Outstanding</div>
          <div class="rh-kpi-val" style="color:#DC2626">${fM(totalOS)}</div>
          <div class="rh-kpi-sub">${ovU} unit${ovU!==1?'s':''} with pending dues</div>
        </div>
        <div class="rh-kpi-right">${_kc('#DC2626',ovU>0?-5:2)}</div>
      </div>
      <div class="rh-kpi-card" onclick="openRptViewer('monthly_trend')" title="View Collection Trend">
        <div class="rh-kpi-icon" style="background:rgba(22,163,74,0.10);color:#16A34A">${_rhi('trending-up',18)}</div>
        <div class="rh-kpi-body">
          <div class="rh-kpi-label">${mn} Recovery</div>
          <div class="rh-kpi-val" style="color:#16A34A">${fM(mColl)}</div>
          <div class="rh-kpi-sub">${mPays.length} payment${mPays.length!==1?'s':''} this month</div>
        </div>
        <div class="rh-kpi-right">${_kc('#16A34A',collPct)}</div>
      </div>
      <div class="rh-kpi-card" onclick="openRptViewer('sales_register')" title="View Sales Register">
        <div class="rh-kpi-icon" style="background:rgba(37,99,235,0.10);color:#2563EB">${_rhi('briefcase',18)}</div>
        <div class="rh-kpi-body">
          <div class="rh-kpi-label">Active Sales</div>
          <div class="rh-kpi-val">${saleCnt||0}</div>
          <div class="rh-kpi-sub">Installment &amp; cash sales</div>
        </div>
        <div class="rh-kpi-right"><span class="rh-kpi-trend neu">—</span><span class="rh-kpi-vs">Total portfolio</span></div>
      </div>
      <div class="rh-kpi-card" onclick="openRptViewer('aging')" title="View Aging Analysis">
        <div class="rh-kpi-icon" style="background:rgba(217,119,6,0.10);color:#D97706">${_rhi('home',18)}</div>
        <div class="rh-kpi-body">
          <div class="rh-kpi-label">Units with Dues</div>
          <div class="rh-kpi-val" style="color:#D97706">${ovU}</div>
          <div class="rh-kpi-sub">Requiring recovery attention</div>
        </div>
        <div class="rh-kpi-right">${_kc('#D97706',ovU>10?-10:0)}</div>
      </div>`;
  }catch(e){
    const el2=document.getElementById('rh-kpi-strip');
    if(el2)el2.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:18px;color:#94A3B8;font-size:11px">Could not load metrics</div>`;
  }
}

// ── Nav counts after filter ──
function _rhUpdateNavCounts(){
  const body=document.getElementById('rh-body');if(!body)return;
  _DEPTS.forEach(d=>{
    const sec=body.querySelector('.rh-section[data-dept="'+d.id+'"]');if(!sec)return;
    const visible=sec.querySelectorAll('.rh-row:not([style*="none"])').length;
    const navItem=document.querySelector('.rh-nav-item[data-dept="'+d.id+'"]');
    if(navItem){const cnt=navItem.querySelector('.rh-nav-cnt');if(cnt)cnt.textContent=visible;}
  });
}

// ── Report list row render ──
function _rptRenderCard(key,dept,favs){
  const r=RPT[key];if(!r)return'';
  const icName=_RH_CARD_IC[key]||'file-text';
  const colHex=dept.col;
  const searchStr=((r.lbl||'')+' '+(r.sub||'')+' '+(dept.title||'')+' '+(_RPT_TAGS[key]||'')).toLowerCase();
  return `<div class="rh-row" onclick="openRptViewer('${key}')" data-key="${key}" data-search="${searchStr}">
    <div class="rh-row-ic" style="background:${colHex}1A;color:${colHex}">${_rhi(icName,16)}</div>
    <div class="rh-row-body">
      <div class="rh-row-name">${esc(r.lbl)}</div>
      <div class="rh-row-desc">${esc(r.sub)}</div>
    </div>
    <div class="rh-row-lastrun" title="Last run">${_rhi('clock',12)} ${_rptLastRunLabel(key)}</div>
    <div class="rh-row-acts">
      <button class="rh-row-run" onclick="event.stopPropagation();openRptViewer('${key}')">Run &#9654;</button>
      <button class="rh-row-dl" onclick="event.stopPropagation();_rhRunExcel('${key}')">Excel &#8595;</button>
    </div>
  </div>`;
}

// ── Section render ──
function _rptRenderDept(d,favs){
  const rows=d.reports.map(k=>_rptRenderCard(k,d,favs)).filter(Boolean).join('');
  if(!rows)return'';
  const collapsed=_rptGetCollapsed().includes(d.id);
  return `<div class="rh-section${collapsed?' collapsed':''}" id="rh-sec-${d.id}" data-dept="${d.id}">
    <a class="rh-section-anchor" id="rh-anchor-${d.id}"></a>
    <div class="rh-sec-hdr" onclick="_rhToggleSection('${d.id}')" title="Click to expand / collapse">
      <span class="rh-sec-chev">${_rhi('chevron-down',14)}</span>
      <div class="rh-sec-dot" style="background:${d.col}"></div>
      <span class="rh-sec-title">${esc(d.title)}</span>
      <span class="rh-sec-cnt">${d.reports.length}</span>
    </div>
    <div class="rh-list" id="rh-list-${d.id}">${rows}</div>
  </div>`;
}

// Collapse / expand a category section (persisted per user)
function _rhToggleSection(id){
  const sec=document.getElementById('rh-sec-'+id);
  if(!sec)return;
  sec.classList.toggle('collapsed');
  const set=_rptGetCollapsed().filter(x=>x!==id);
  if(sec.classList.contains('collapsed'))set.push(id);
  _rptSetCollapsed(set);
}

// Re-apply persisted collapsed state to all sections
function _rhApplyCollapsedState(){
  const set=_rptGetCollapsed();
  document.querySelectorAll('.rh-section[data-dept]').forEach(sec=>{
    sec.classList.toggle('collapsed', set.includes(sec.dataset.dept));
  });
}

// Run + download Excel straight from a list row (opens viewer, exports once rendered)
function _rhRunExcel(key){
  _rptSetLastRun(key);
  openRptViewer(key);
  let tries=0;
  const iv=setInterval(()=>{
    tries++;
    const ct=document.getElementById('r-ct');
    const ready=ct&&!ct.querySelector('[style*="rops-spin"]')&&(ct.querySelector('table')||ct.querySelector('.empty')||ct.querySelector('.card'));
    if(ready){clearInterval(iv);try{expRptExcel();}catch(e){}}
    else if(tries>40)clearInterval(iv);
  },150);
}

// ── Recently viewed strip ──
function _rhRecentStrip(views){
  const recent=_rptGetRecent().slice(0,6).filter(k=>RPT[k]);
  if(!recent.length)return'';
  const chips=recent.map(k=>{
    const r=RPT[k];const d=_DEPTS.find(x=>x.reports.includes(k));
    const col=d?d.col:'#4F46E5';
    const vc=views[k]||0;
    const ts=vc>0?`${vc}×`:'';
    return `<button class="rh-recent-chip" onclick="openRptViewer('${k}')" style="--rh-cc:${col}">
      <span style="color:${col};display:flex">${_rhi(_RH_CARD_IC[k]||'file-text',14)}</span>
      <span>${esc(r.lbl)}</span>
      ${ts?`<span class="rh-recent-chip-ts">${ts}</span>`:''}
    </button>`;
  }).join('');
  return `<div class="rh-recent-strip">
    <div class="rh-recent-hdr">
      <span class="rh-recent-title">Recently Viewed</span>
      <button class="rh-recent-all" onclick="_rptSetTab('recent',document.querySelector('.rh-pill[data-filter=recent]'))">View all →</button>
    </div>
    <div class="rh-recent-chips">${chips}</div>
  </div>`;
}

// ── Scroll-spy ──
function _rhInitScrollSpy(){
  const main=document.getElementById('rh-main');if(!main)return;
  const sections=document.querySelectorAll('.rh-section[data-dept]');
  if(!sections.length)return;
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        const id=e.target.dataset.dept;
        document.querySelectorAll('.rh-nav-item').forEach(n=>n.classList.toggle('active',n.dataset.dept===id));
      }
    });
  },{root:main,rootMargin:'-20% 0px -60% 0px',threshold:0});
  sections.forEach(s=>obs.observe(s));
}

function _rhJumpTo(id){
  const sec=document.getElementById('rh-sec-'+id);
  const main=document.getElementById('rh-main');
  if(!sec||!main)return;
  const mainRect=main.getBoundingClientRect();
  const secRect=sec.getBoundingClientRect();
  main.scrollBy({top:secRect.top-mainRect.top-96,behavior:'smooth'});
}

// ── Keyboard shortcuts ──
function _rhInitKeyboard(){
  document.addEventListener('keydown',function _rhKB(e){
    if(!document.getElementById('rh-main')){document.removeEventListener('keydown',_rhKB);return;}
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();const s=document.getElementById('rh-srch');if(s)s.focus();}
    if(e.key==='Escape'){const s=document.getElementById('rh-srch');if(s&&s===document.activeElement){s.blur();_rhClearSearch();}}
  });
}

// ── Left nav HTML ──
function _rhNavHTML(favs,views){
  const total=Object.keys(RPT).length;
  const favCnt=favs.length;
  const recentCnt=Math.min(_rptGetRecent().length,10);
  const muCnt=Math.min(Object.keys(views).length,10);
  let h=`<span class="rh-nav-sec-lbl">Browse</span>`;
  h+=`<div class="rh-nav-item active" data-filter="all" onclick="_rptSetTab('all',this)"><span class="rh-nav-lbl">All Reports</span><span class="rh-nav-cnt">${total}</span></div>`;
  h+=`<div class="rh-nav-item" data-filter="favorites" onclick="_rptSetTab('favorites',this)"><span class="rh-nav-lbl">Saved</span><span class="rh-nav-cnt">${favCnt}</span></div>`;
  h+=`<div class="rh-nav-item" data-filter="recent" onclick="_rptSetTab('recent',this)"><span class="rh-nav-lbl">Recent</span><span class="rh-nav-cnt">${recentCnt}</span></div>`;
  h+=`<div class="rh-nav-item" data-filter="mostused" onclick="_rptSetTab('mostused',this)"><span class="rh-nav-lbl">Most Used</span><span class="rh-nav-cnt">${muCnt}</span></div>`;
  h+=`<span class="rh-nav-sec-lbl">By Category</span>`;
  _DEPTS.forEach(d=>{
    h+=`<div class="rh-nav-item" data-dept="${d.id}" onclick="_rhJumpTo('${d.id}')">
      <div class="rh-nav-dot" style="background:${d.col}"></div>
      <span class="rh-nav-lbl">${esc(d.title)}</span>
      <span class="rh-nav-cnt">${d.reports.length}</span>
    </div>`;
  });
  return h;
}

// ── Main hub entry point ──
function rReports(){
  document.querySelector('.pw')?.classList.remove('rpt-mode');
  const pg=document.getElementById('pg-reports');if(!pg)return;
  const favs=_rptGetFavs();
  const views=_rptGetViews();
  const favCnt=favs.length;
  const recentCnt=Math.min(_rptGetRecent().length,10);
  const muCnt=Math.min(Object.keys(views).length,10);
  pg.innerHTML=`<div class="rh" id="rh-hub">
    <!-- Left Nav -->
    <nav class="rh-nav" id="rh-nav">${_rhNavHTML(favs,views)}</nav>
    <!-- Right Main -->
    <div class="rh-main" id="rh-main">
      <!-- Sticky Header -->
      <div class="rh-hdr">
        <div class="rh-hdr-row1">
          <span class="rh-title">Reports &amp; Analytics</span>
          <div class="rh-hdr-actions">
            <button class="rh-export-btn" onclick="openReportHub()" title="Open A4 print report hub in new tab" style="background:#1e2d47;color:#fff;border-color:#1e2d47">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print Hub
            </button>
          </div>
        </div>
        <div class="rh-hdr-row2">
          <div class="rh-search-wrap">
            <span class="rh-search-ic">${_rhi('search',13)}</span>
            <input class="rh-search" id="rh-srch" type="search" placeholder="Search ${Object.keys(RPT).length} reports… ⌘K" autocomplete="off" oninput="_rptDoSearch(this.value)">
          </div>
          <div class="rh-filters">
            <button class="rh-pill active" data-filter="all" onclick="_rptSetTab('all',this)">All</button>
            <button class="rh-pill" data-filter="favorites" onclick="_rptSetTab('favorites',this)">Saved${favCnt?' '+favCnt:''}</button>
            <button class="rh-pill" data-filter="recent" onclick="_rptSetTab('recent',this)">Recent${recentCnt?' '+recentCnt:''}</button>
            <button class="rh-pill" data-filter="mostused" onclick="_rptSetTab('mostused',this)">Top${muCnt?' '+muCnt:''}</button>
          </div>
        </div>
      </div>
      <!-- Report Sections -->
      <div class="rh-body" id="rh-body">
        ${_DEPTS.map(d=>_rptRenderDept(d,favs)).join('')}
      </div>
    </div>
  </div>`;
  setTimeout(_rhInitScrollSpy, 100);
  _rhInitKeyboard();
}

function _rhSetView(v,btn){
  document.querySelectorAll('.rh-view-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.rh-grid').forEach(g=>{
    if(v==='list')g.classList.add('list-view');else g.classList.remove('list-view');
  });
}

let _rptGenId=0;

function openRptViewer(key){
  if(key){_rt=key;_rs=(RPT[key]?.subs?.[0]?.id)||'all';_rptAddRecent(key);_rptAddView(key);_rptSetLastRun(key);}
  _rptGenId++;
  const cur=RPT[_rt]||{};
  const col=_RPT_SEC_COL[cur.sec||'']||'var(--brand)';
  const pg=document.getElementById('pg-reports');
  document.querySelector('.pw')?.classList.add('rpt-mode');
  pg.innerHTML=`<div class="rpt-viewer">
    <div class="rpt-vh">
      <button class="rpt-vback" onclick="closeRptViewer()">‹ All Reports</button>
      <div class="rpt-vh-div"></div>
      <div class="rpt-vh-ic">${cur.ic||'<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'}</div>
      <div class="rpt-vh-info">
        <div class="rpt-vh-name">${cur.lbl||'Report'}</div>
        <div class="rpt-vh-sec" style="color:${col}">${(cur.sec||'').replace(/^\S+\s/,'')}</div>
      </div>
      <div class="rpt-vh-acts">
        <button class="btn btn-gr btn-sm" onclick="expRptExcel()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Excel</button>
        <button class="btn btn-d btn-sm" onclick="printRpt()" style="display:inline-flex;align-items:center;gap:5px"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print</button>
        <button class="btn btn-gh btn-sm" onclick="expRpt()" title="Export CSV">↓ CSV</button>
      </div>
    </div>
    ${(cur.subs||[]).length>1?`<div class="rpt-stabs">
      <span class="rpt-stabs-lbl">View</span>
      ${(cur.subs||[]).map(s=>`<button class="rpt-stab${_rs===s.id?' active':''}" onclick="setRS('${s.id}')">${s.lbl}</button>`).join('')}
    </div>`:''}
    ${_rt==='recovery_position' ? _rpControlsBar() : _rptPeriodBar(_rt)}
    <div class="rpt-vbody crystal-rpt" id="r-ct">
      <div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading…</div>
    </div>
  </div>`;
  _injectCrystalStyle();
  runRpt();
}

// ── Per-report date mode (Part C audit) ──────────────────────────────────────
// 'period'   = consumes getDF()→RPC date params (from/to). Default = current month.
// 'snapshot' = point-in-time (cache / "now"); no range — never fake one.
function _rptDateMode(rt){
  var PERIOD={outstanding:1,sales_register:1,cancelled:1,recovery:1,agent_recovery:1,monthly_trend:1,pdc:1,staff:1,tax_report:1,discount:1};
  return PERIOD[rt]?'period':'snapshot';
}
// Shared period/snapshot control bar (recovery_position uses its own _rpControlsBar).
function _rptPeriodBar(rt){
  var ctl='font:500 12px/1 inherit;padding:6px 9px;border-radius:7px;border:1px solid var(--line);background:var(--canvas);color:var(--text)';
  if(_rptDateMode(rt)==='period'){
    var ms=_rpMonthStart(), tdy=td();
    return '<div class="rpt-fbar">'
      +'<input type="hidden" id="r-fr" value="'+ms+'"><input type="hidden" id="r-to" value="'+tdy+'">'
      +'<span class="rpt-stabs-lbl">From</span>'
      +'<input type="date" id="r-fr-pick" value="'+ms+'" style="'+ctl+'" onchange="_rptSetFromTo()">'
      +'<span class="rpt-stabs-lbl">To</span>'
      +'<input type="date" id="r-to-pick" value="'+tdy+'" style="'+ctl+'" onchange="_rptSetFromTo()">'
      +'<span class="rpt-stabs-lbl" style="margin-left:10px">Quick</span>'
      +'<button class="rpt-stab" onclick="setRng(this,\'\')">All Time</button>'
      +'<button class="rpt-stab active" onclick="setRng(this,\'month\')">This Month</button>'
      +'<button class="rpt-stab" onclick="setRng(this,\'lastmonth\')">Last Month</button>'
      +'<button class="rpt-stab" onclick="setRng(this,\'year\')">This Year</button>'
    +'</div>';
  }
  // snapshot — point-in-time, no range control
  return '<div class="rpt-fbar">'
    +'<input type="hidden" id="r-fr"><input type="hidden" id="r-to">'
    +'<span class="rpt-stabs-lbl">As of</span><b style="font-size:12px">'+_rpAsofLbl(td())+'</b>'
    +'<span class="rpt-stabs-lbl" style="margin-left:10px;color:var(--t4)">point-in-time snapshot</span>'
  +'</div>';
}
// From/To date-picker change → sync hidden inputs + reload.
function _rptSetFromTo(){
  var fr=document.getElementById('r-fr-pick'), to=document.getElementById('r-to-pick');
  var h1=document.getElementById('r-fr'), h2=document.getElementById('r-to');
  if(h1&&fr)h1.value=fr.value; if(h2&&to)h2.value=to.value;
  document.querySelectorAll('.rpt-fbar .rpt-stab').forEach(function(b){b.classList.remove('active');});
  runRpt();
}

function closeRptViewer(){document.querySelector('.pw')?.classList.remove('rpt-mode');rReports();}

function setRT(t){_rt=t;_rs=(RPT[t]?.subs?.[0]?.id)||'all';openRptViewer(t);}
function setRS(s){_rs=s;runRpt();
  document.querySelectorAll('.rpt-stab').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.rpt-stab[onclick="setRS('${s}')"]`)?.classList.add('active');
}
function getDF(){
  const fr=document.getElementById('r-fr')?.value||'';
  const to=document.getElementById('r-to')?.value||'';
  return{fr,to};
}
function setRng(btn,preset){
  document.querySelectorAll('.rpt-fbar .rpt-stab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const t=td();
  const fr=document.getElementById('r-fr');
  const to=document.getElementById('r-to');
  if(!fr||!to)return;
  if(preset==='week'){const d=new Date();d.setDate(d.getDate()-d.getDay());fr.value=d.toISOString().slice(0,10);to.value=t;}
  else if(preset==='month'){const d=new Date();d.setDate(1);fr.value=d.toISOString().slice(0,10);to.value=t;}
  else if(preset==='lastmonth'){const d=new Date();d.setDate(1);const e=new Date(d);e.setDate(0);d.setMonth(d.getMonth()-1);fr.value=d.toISOString().slice(0,10);to.value=e.toISOString().slice(0,10);}
  else if(preset==='year'){const yr=new Date().getFullYear();fr.value=yr+'-01-01';to.value=t;}
  else{fr.value='';to.value='';}
  // keep visible From/To date pickers in sync with the preset
  const frp=document.getElementById('r-fr-pick'),top=document.getElementById('r-to-pick');
  if(frp)frp.value=fr.value;if(top)top.value=to.value;
  runRpt();
}

// ── REPORT SUMMARY BANNER ──
function rptBanner(items){
  const df=getDF();
  let drTxt='All Time';
  if(df.fr&&df.to&&df.fr===df.to)drTxt='Date: '+fD(df.fr);
  else if(df.fr&&df.to)drTxt=fD(df.fr)+' → '+fD(df.to);
  else if(df.fr)drTxt='From '+fD(df.fr);
  else if(df.to)drTxt='Until '+fD(df.to);
  const drHtml=`<span style="color:var(--t3);font-size:11px"><b>${drTxt}</b></span><span style="color:var(--t4)">·</span>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;background:var(--canvas);border-radius:var(--rm);margin-bottom:10px;font-size:12px;align-items:center">
    ${drHtml}${items.map(i=>`<span style="color:${i.c||'var(--text)'}">${i.ic||''} <b>${i.v}</b> ${i.l}</span>`).join('<span style="color:var(--t4)">·</span>')}
  </div>`;
}

async function runRpt(){
  const ct=document.getElementById('r-ct');if(!ct)return;
  const _gid=_rptGenId;
  const _set=(h)=>{if(_rptGenId===_gid){const el=document.getElementById('r-ct');if(el)el.innerHTML=h;}};
  const df=getDF();let html='';

  // ── Recovery Position (Grand Summary) — {rows, officer_summary, totals} ──
  if(_rt==='recovery_position'){ await _rpRun(); return; }

  // ══ ASYNC SUPABASE REPORTS ══════════════════════════════════

  if(_rt==='commission'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading commission data…</div>`;
    const [{data:agentRows=[]},{data:paysFull=[]}]=await Promise.all([
      supabase.rpc('list_agents_for_reports', { p_company_id: S.cid }),
      supabase.rpc('list_agent_commission_payments', { p_company_id: S.cid })
    ]);
    const pays = (paysFull || []).map(p => ({ agent_id: p.agent_id, amount: p.amount }));
    const payMap={};pays.forEach(p=>{if(!payMap[p.agent_id])payMap[p.agent_id]=0;payMap[p.agent_id]+=Number(p.amount||0);});
    let agRows=agentRows.map(a=>({...a,commPaid:payMap[a.id]||0,commPending:Math.max(0,Number(a.total_commission_earned||0)-(payMap[a.id]||0))}));
    if(_rs==='pending')agRows=agRows.filter(r=>r.commPending>0);
    const tEarned=agRows.reduce((s,r)=>s+Number(r.total_commission_earned||0),0);
    const tPaid=agRows.reduce((s,r)=>s+r.commPaid,0);
    const tPending=agRows.reduce((s,r)=>s+r.commPending,0);
    html=rptBanner([{v:agRows.length,l:'agents'},{v:fM(tEarned),l:'total earned'},{v:fM(tPaid),l:'paid',c:'var(--ok)'},{v:fM(tPending),l:'pending',c:'var(--err)'}]);
    if(agRows.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>#</th><th>Agent</th><th>Code</th><th>Phone</th><th class="r">Commission%</th><th class="r">Total Earned</th><th class="r">Total Paid</th><th class="r">Pending</th><th>Status</th></tr></thead>
      <tbody>${agRows.map((r,i)=>`<tr>
        <td style="font-size:11px;color:var(--t3)">${i+1}</td>
        <td style="font-weight:700">${esc(r.full_name)}</td>
        <td style="font-family:monospace;font-size:11px">${esc(r.agent_code||'—')}</td>
        <td style="font-size:11px">${esc(r.phone||'—')}</td>
        <td class="r mono">${r.commission_percent||0}%</td>
        <td class="r mono" style="font-weight:600">${fM(r.total_commission_earned||0)}</td>
        <td class="r mono c-g">${fM(r.commPaid)}</td>
        <td class="r mono" style="color:${r.commPending>0?'var(--err)':'var(--ok)'};font-weight:700">${r.commPending>0?fM(r.commPending):'Paid'}</td>
        <td>${r.status==='active'?'<span class="badge bo">Active</span>':'<span class="badge bi">'+esc(r.status||'inactive')+'</span>'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700">
        <td colspan="5">TOTAL</td>
        <td class="r mono">${fM(tEarned)}</td><td class="r mono c-g">${fM(tPaid)}</td>
        <td class="r mono" style="color:var(--err)">${fM(tPending)}</td><td></td>
      </tr></tfoot></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></div><div class="et">No commission data found</div></div>`;
    }
    _set(html);return;
  }

  if(_rt==='pdc'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading cheque data…</div>`;
    const pdcFilters = { payment_method: 'cheque', cheque_from: df.fr || null, cheque_to: df.to || null, limit: 500 };
    if (_rs === 'pending') pdcFilters.deposit_confirmed = 'false';
    else if (_rs === 'cleared') pdcFilters.deposit_confirmed = 'true';
    const {data:pdcRaw,error:pdcErr}=await supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: pdcFilters });
    if(pdcErr){_set(`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div class="et">Could not load cheque data</div><div class="es">${esc(pdcErr.message)}</div></div>`);return;}
    const pdcs=(pdcRaw||[]).map(p=>{const cl=(window._clientsCache||[]).find(c=>c.id===p.client_id)||null;return {...p,clientName:cl?.fullName||'—',clientPhone:cl?.phone||'—'};});
    const tAmt=pdcs.reduce((s,p)=>s+Number(p.amount||0),0);
    const pdcBadge=confirmed=>confirmed?'<span class="badge bo">Cleared</span>':'<span class="badge bi">Pending</span>';
    html=rptBanner([{v:pdcs.length,l:'cheques'},{v:fM(tAmt),l:'total'},{v:pdcs.filter(p=>!p.deposit_confirmed).length,l:'pending'},{v:pdcs.filter(p=>p.deposit_confirmed).length,l:'cleared',c:'var(--ok)'}]);
    if(pdcs.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Cheque Date</th><th>Reference No.</th><th>Bank</th><th>Client</th><th>Phone</th><th class="r">Amount</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${pdcs.map(p=>`<tr>
        <td style="font-size:11px;white-space:nowrap">${fD(p.cheque_date||p.payment_date)}</td>
        <td style="font-family:monospace;font-weight:700">${esc(p.reference_no||'—')}</td>
        <td style="font-size:11px">${esc(p.bank_name||'—')}</td>
        <td style="font-weight:600">${esc(p.clientName)}</td>
        <td style="font-size:11px">${esc(p.clientPhone)}</td>
        <td class="r mono" style="font-weight:700">${fM(p.amount)}</td>
        <td>${pdcBadge(p.deposit_confirmed)}</td>
        <td style="font-size:11px;color:var(--t3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.notes||'')}">${esc(p.notes||'—')}</td>
      </tr>`).join('')}</tbody></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div><div class="et">No cheques found</div><div class="es">Try a different date range or status filter</div></div>`;
    }
    _set(html);return;
  }

  if(_rt==='cancelled'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading cancellation data…</div>`;
    const {data:cansales}=await supabase.rpc('list_sales_for_report', {
      p_company_id: S.cid,
      p_filters: { status: 'cancelled', cancel_from: df.fr || null, cancel_to: df.to || null }
    });
    const cTotal=(cansales||[]).reduce((s,r)=>s+Number(r.total_amount||0),0);
    html=rptBanner([{v:(cansales||[]).length,l:'cancellations'},{v:fM(cTotal),l:'cancelled value',c:'var(--err)'}]);
    if((cansales||[]).length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Cancel Date</th><th>Unit</th><th>Client</th><th>Phone</th><th>Sale No.</th><th>Sale Date</th><th class="r">Sale Amount</th><th>Reason</th><th>Cancelled By</th></tr></thead>
      <tbody>${(cansales||[]).map(r=>{const u=gunit(r.unit_id);return `<tr>
        <td style="font-size:11px;white-space:nowrap;color:var(--err);font-weight:700">${fD(r.cancellation_date||'')}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td style="font-size:11px">${esc(u?.phone||'—')}</td>
        <td style="font-size:11px;font-family:monospace">${esc(r.sale_number||'—')}</td>
        <td style="font-size:11px">${fD(r.sale_date||'')}</td>
        <td class="r mono">${fM(r.total_amount)}</td>
        <td style="font-size:11px;max-width:160px;word-break:break-word">${esc(r.cancellation_reason||'—')}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(r.cancelled_by||'—')}</td>
      </tr>`}).join('')}</tbody></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div class="et">No cancellations found</div><div class="es">Try a different date range</div></div>`;
    }
    _set(html);return;
  }

  // ── OUTSTANDING DUES ──
  if(_rt==='outstanding'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading outstanding dues…</div>`;
    const todayOS=td();
    const in30dOS=new Date();in30dOS.setDate(in30dOS.getDate()+30);const in30OS=in30dOS.toISOString().slice(0,10);
    const osFilters = { due_from: df.fr || null, due_to: df.to || null, limit: 500 };
    if (_rs === 'overdue') { osFilters.due_lt = todayOS; osFilters.status_in = 'pending,partial,overdue'; }
    else if (_rs === 'upcoming') { osFilters.due_gte = todayOS; osFilters.due_to = in30OS; osFilters.status_in = 'pending,partial'; }
    else osFilters.status_in = 'pending,partial,overdue';
    const {data:osInsts=[]} = await supabase.rpc('list_installments_for_report', { p_company_id: S.cid, p_filters: osFilters });
    const osIds=[...new Set(osInsts.map(i=>i.sale_id).filter(Boolean))];
    let osSmMap={};
    if(osIds.length){const {data:osSd=[]}=await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: osIds });(osSd||[]).forEach(s=>{osSmMap[s.id]=s.unit_id;});}
    const osTotDue=osInsts.reduce((s,r)=>s+Number(r.amount_due||0),0);
    const osTotPaid=osInsts.reduce((s,r)=>s+Number(r.amount_paid||0),0);
    const osTotPend=osInsts.reduce((s,r)=>s+Math.max(0,Number(r.amount_due||0)-Number(r.amount_paid||0)),0);
    html=rptBanner([{v:osInsts.length,l:'due items'},{v:fM(osTotDue),l:'billed'},{v:fM(osTotPaid),l:'paid',c:'var(--ok)'},{v:fM(osTotPend),l:'outstanding',c:'var(--err)'}]);
    if(osInsts.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Due Date</th><th>Unit</th><th>Client</th><th>Phone</th><th>Install#</th><th class="r">Amount Due</th><th class="r">Paid</th><th class="r">Outstanding</th><th>Status</th></tr></thead>
      <tbody>${osInsts.map(r=>{const uid=osSmMap[r.sale_id];const u=uid?gunit(uid):null;const pend=Math.max(0,Number(r.amount_due||0)-Number(r.amount_paid||0));const isOv=r.due_date<todayOS;
        return `<tr class="${uid?'cr':''}" onclick="${uid?`openUD('${uid}')`:''}" >
        <td style="font-size:11px;white-space:nowrap;color:${isOv?'var(--err)':'var(--t1)'};font-weight:${isOv?700:400}">${fD(r.due_date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td style="font-size:11px">${esc(u?.phone||'—')}</td>
        <td style="font-size:11px;color:var(--t3)">${r.installment_number?'#'+r.installment_number:r.installment_type||'—'}</td>
        <td class="r mono">${fM(r.amount_due)}</td>
        <td class="r mono c-g">${fM(r.amount_paid)}</td>
        <td class="r mono" style="color:${pend>0?'var(--err)':'var(--ok)'};font-weight:700">${pend>0?fM(pend):'Paid'}</td>
        <td>${isOv?'<span class="badge br">Overdue</span>':r.status==='partial'?'<span class="badge bj">Partial</span>':'<span class="badge bi">Pending</span>'}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="et">No outstanding dues found</div><div class="es">All installments are up to date</div></div>`;
    }
    _set(html);return;
  }

  // ── SALES REGISTER ──
  if(_rt==='sales_register'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading sales data…</div>`;
    const {data:srSales}=await supabase.rpc('list_sales_for_report', {
      p_company_id: S.cid,
      p_filters: { sale_from: df.fr || null, sale_to: df.to || null, limit: 500 }
    });
    let srRows=(srSales||[]);
    if(_rs==='installment')srRows=srRows.filter(r=>{const u=gunit(r.unit_id);return u&&u.status!=='CashSale'&&u.status!=='Available'&&u.status!=='Dead';});
    else if(_rs==='cash')srRows=srRows.filter(r=>gunit(r.unit_id)?.status==='CashSale');
    const srVal=srRows.reduce((s,r)=>s+Number(r.total_amount||0),0);
    const srDp=srRows.reduce((s,r)=>s+Number(r.down_payment||0),0);
    const srDisc=srRows.reduce((s,r)=>s+Number(r.discount||0),0);
    html=rptBanner([{v:srRows.length,l:'sales'},{v:fM(srVal),l:'total value'},{v:fM(srDp),l:'down payment'},{v:fM(srDisc),l:'discounts',c:'var(--warn)'}]);
    if(srRows.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Sale Date</th><th>Unit</th><th>Client</th><th>Phone</th><th>Sale No.</th><th>Type</th><th>Agent</th><th class="r">Total Price</th><th class="r">Down Payment</th><th class="r">Discount</th><th>Status</th></tr></thead>
      <tbody>${srRows.map(r=>{const u=gunit(r.unit_id);const isCash=u?.status==='CashSale';return `<tr class="${r.unit_id?'cr':''}" onclick="${r.unit_id?`openUD('${r.unit_id}')`:''}" >
        <td style="font-size:11px;white-space:nowrap">${fD(r.sale_date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td style="font-size:11px">${esc(u?.phone||'—')}</td>
        <td style="font-size:11px;font-family:monospace">${esc(r.sale_number||'—')}</td>
        <td><span class="badge ${isCash?'bo':'bi'}">${isCash?'Cash':'Installment'}</span></td>
        <td style="font-size:11px">${esc(u?.soldBy||'—')}</td>
        <td class="r mono" style="font-weight:700">${fM(r.total_amount)}</td>
        <td class="r mono c-g">${r.down_payment?fM(r.down_payment):'—'}</td>
        <td class="r mono" style="color:${Number(r.discount)>0?'var(--warn)':'var(--t3)'}">${Number(r.discount)>0?fM(r.discount):'—'}</td>
        <td>${r.status==='active'?'<span class="badge bo">Active</span>':r.status==='cancelled'?'<span class="badge br">Cancelled</span>':'<span class="badge bi">'+esc(r.status||'—')+'</span>'}</td>
      </tr>`}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="7">TOTAL</td><td class="r mono">${fM(srVal)}</td><td class="r mono c-g">${fM(srDp)}</td><td class="r mono" style="color:var(--warn)">${srDisc?fM(srDisc):'—'}</td><td></td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div><div class="et">No sales found</div><div class="es">Try a different date range</div></div>`;
    }
    _set(html);return;
  }

  // ── DISCOUNT REPORT ──
  if(_rt==='discount'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading discount data…</div>`;
    const {data:drSales}=await supabase.rpc('list_sales_for_report', {
      p_company_id: S.cid,
      p_filters: { sale_from: df.fr || null, sale_to: df.to || null, discount_gt: 0, limit: 500 }
    });
    const drDisc=(drSales||[]).reduce((s,r)=>s+Number(r.discount||0),0);
    const drVal=(drSales||[]).reduce((s,r)=>s+Number(r.total_amount||0),0);
    html=rptBanner([{v:(drSales||[]).length,l:'sales with discount'},{v:fM(drVal),l:'total sale value'},{v:fM(drDisc),l:'total discounts',c:'var(--warn)'},{v:drVal?Math.round(drDisc/drVal*100)+'%':'0%',l:'avg discount rate',c:'var(--err)'}]);
    if((drSales||[]).length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Sale Date</th><th>Unit</th><th>Client</th><th>Sale No.</th><th>Agent</th><th class="r">Sale Value</th><th class="r">Discount</th><th class="r">Discount %</th><th>By</th></tr></thead>
      <tbody>${(drSales||[]).map(r=>{const u=gunit(r.unit_id);const pct2=r.total_amount?Math.round(r.discount/r.total_amount*100):0;return `<tr class="${r.unit_id?'cr':''}" onclick="${r.unit_id?`openUD('${r.unit_id}')`:''}" >
        <td style="font-size:11px">${fD(r.sale_date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td style="font-size:11px;font-family:monospace">${esc(r.sale_number||'—')}</td>
        <td style="font-size:11px">${esc(u?.soldBy||'—')}</td>
        <td class="r mono">${fM(r.total_amount)}</td>
        <td class="r mono" style="color:var(--warn);font-weight:700">${fM(r.discount)}</td>
        <td class="r" style="color:var(--warn);font-weight:700">${pct2}%</td>
        <td style="font-size:11px;color:var(--t3)">${esc(r.created_by||'—')}</td>
      </tr>`}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="5">TOTAL</td><td class="r mono">${fM(drVal)}</td><td class="r mono" style="color:var(--warn)">${fM(drDisc)}</td><td class="r" style="color:var(--warn)">${drVal?Math.round(drDisc/drVal*100):0}%</td><td></td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg></div><div class="et">No discounts found</div><div class="es">No sales with discounts in this period</div></div>`;
    }
    _set(html);return;
  }

  // ── COMMISSION HISTORY ──
  if(_rt==='commission_hist'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading commission payments…</div>`;
    const {data:chHistAll=[]}=await supabase.rpc('list_agent_commissions_with_agent', { p_company_id: S.cid });
    const chHist = chHistAll.filter(r => (!df.fr || r.payment_date >= df.fr) && (!df.to || r.payment_date <= df.to)).slice(0,500);
    const chTot=chHist.reduce((s,r)=>s+Number(r.amount||0),0);
    html=rptBanner([{v:chHist.length,l:'payments'},{v:fM(chTot),l:'total paid out',c:'var(--ok)'}]);
    if(chHist.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th>Agent</th><th>Code</th><th>Method</th><th>Reference</th><th>Notes</th><th class="r">Amount Paid</th><th>By</th></tr></thead>
      <tbody>${chHist.map(r=>`<tr>
        <td style="font-size:11px;white-space:nowrap">${fD(r.payment_date)}</td>
        <td style="font-weight:700">${esc(r.agents?.full_name||'—')}</td>
        <td style="font-size:11px;font-family:monospace">${esc(r.agents?.agent_code||'—')}</td>
        <td style="font-size:11px">${esc(r.payment_method||'—')}</td>
        <td style="font-size:11px">${esc(r.reference||'—')}</td>
        <td style="font-size:11px;color:var(--t3);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes||'')}">${esc(r.notes||'—')}</td>
        <td class="r mono c-g" style="font-weight:700">${fM(r.amount)}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(r.paid_by||'—')}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="6">TOTAL</td><td class="r mono c-g">${fM(chTot)}</td><td></td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><div class="et">No commission payments found</div><div class="es">Try a different date range</div></div>`;
    }
    _set(html);return;
  }

  // ── POSSESSION STATUS ──
  if(_rt==='possession'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading possession data…</div>`;
    const {data:psAll=[]}=await supabase.rpc('list_possessions_filtered', { p_company_id: S.cid });
    let psPoss = psAll;
    if (_rs === 'pending') psPoss = psPoss.filter(p => p.status === 'pending');
    else if (_rs === 'completed') psPoss = psPoss.filter(p => p.status === 'completed');
    if (df.fr) psPoss = psPoss.filter(p => !p.possession_date || p.possession_date >= df.fr);
    if (df.to) psPoss = psPoss.filter(p => !p.possession_date || p.possession_date <= df.to);
    psPoss = psPoss.slice(0, 500);
    const psComp=psPoss.filter(p=>p.status==='completed').length;
    const psPend=psPoss.filter(p=>p.status!=='completed').length;
    html=rptBanner([{v:psPoss.length,l:'possession records'},{v:psComp,l:'completed',c:'var(--ok)'},{v:psPend,l:'pending',c:'var(--warn)'}]);
    if(psPoss.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Unit</th><th>Client</th><th>Phone</th><th>Possession Date</th><th>Handover By</th><th>Received By</th><th>Status</th><th>Checklist</th><th>Snagging</th><th></th></tr></thead>
      <tbody>${psPoss.map(p=>{const u=gunit(p.unit_id);const ck=Array.isArray(p.checklist)?p.checklist:[];const sn=Array.isArray(p.snagging_items)?p.snagging_items:[];const ckDone=ck.filter(i=>i.checked).length;const snOpen=sn.filter(i=>i.status!=='resolved').length;
        return `<tr>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(p.client_name||u?.customerName||'—')}</td>
        <td style="font-size:11px">${esc(p.client_phone||u?.phone||'—')}</td>
        <td style="font-size:11px;white-space:nowrap">${p.possession_date?fD(p.possession_date):'—'}</td>
        <td style="font-size:11px">${esc(p.handover_by||'—')}</td>
        <td style="font-size:11px">${esc(p.created_by||'—')}</td>
        <td>${p.status==='completed'?'<span class="badge bo">Completed</span>':'<span class="badge bi">Pending</span>'}</td>
        <td style="font-size:11px;text-align:center">${ckDone}/${ck.length}</td>
        <td style="font-size:11px;text-align:center;color:${snOpen>0?'var(--warn)':'var(--ok)'}">${snOpen>0?snOpen+' open':'Done'}</td>
        <td><button class="btn btn-gh btn-xs" onclick="openPossessionModal('${p.unit_id}')">Open</button></td>
      </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div class="et">No possession records found</div></div>`;
    }
    _set(html);return;
  }

  // ── POST-POSSESSION DUES ──
  if(_rt==='post_possession_dues'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading post-possession dues…</div>`;
    const {data:ppd,error:ppdErr}=await supabase.rpc('get_post_possession_dues',{p_company_id:S.cid});
    if(ppdErr){_set(`<div class="empty"><div class="et">Could not load post-possession dues</div><div class="es">${esc(ppdErr.message)}</div></div>`);return;}
    const rows=ppd?.rows||[];
    const tOuts=rows.reduce((s,r)=>s+Number(r.total_outstanding||0),0);
    const tOverdue=rows.filter(r=>Number(r.overdue_count||0)>0).length;
    html=rptBanner([
      {v:rows.length,l:'units with dues'},
      {v:fM(tOuts),l:'total outstanding',c:'var(--err)'},
      {v:tOverdue,l:'with overdue inst.',c:'var(--err)'},
    ]);
    if(rows.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Unit</th><th>Project</th><th>Client</th><th>Phone</th><th>Possession Date</th><th class="r">Outstanding</th><th class="r">Pending Inst.</th><th class="r">Overdue</th><th>Next Due</th><th>Oldest Overdue</th></tr></thead>
      <tbody>${rows.map(r=>{
        const hasOverdue=Number(r.overdue_count||0)>0;
        return `<tr>
        <td style="font-weight:700">${esc(r.unit_no||'—')}</td>
        <td style="font-size:11px;color:var(--t2)">${esc(r.project_name||'—')}</td>
        <td>${esc(r.client_name||'—')}</td>
        <td style="font-size:11px">${esc(r.client_phone||'—')}</td>
        <td style="font-size:11px;white-space:nowrap">${r.possession_date?fD(r.possession_date):'—'}</td>
        <td class="r mono" style="font-weight:700;color:var(--err)">${fM(r.total_outstanding)}</td>
        <td class="r" style="font-size:12px">${r.pending_count||0}</td>
        <td class="r" style="font-size:12px;color:${hasOverdue?'var(--err)':'var(--ok)'};font-weight:${hasOverdue?700:400}">${r.overdue_count||0}</td>
        <td style="font-size:11px;white-space:nowrap">${r.next_due_date?fD(r.next_due_date):'—'}</td>
        <td style="font-size:11px;white-space:nowrap;color:${hasOverdue?'var(--err)':'var(--t3)'}">${r.oldest_overdue_date?fD(r.oldest_overdue_date):'—'}</td>
      </tr>`;}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700">
        <td colspan="5">TOTAL (${rows.length} units)</td>
        <td class="r mono" style="color:var(--err)">${fM(tOuts)}</td>
        <td colspan="4"></td>
      </tr></tfoot></table></div></div>`;
    }else{
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div><div class="et">No post-possession dues found</div><div class="es">All completed possessions are fully paid up</div></div>`;
    }
    _set(html);return;
  }

  // ── LEGAL CASES PORTFOLIO ──
  if(_rt==='legal_portfolio'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading legal cases…</div>`;
    const {data:lcAll,error:lcErr}=await supabase.rpc('list_legal_cases',{p_company_id:S.cid});
    if(lcErr){_set(`<div class="empty"><div class="et">Could not load legal cases</div><div class="es">${esc(lcErr.message)}</div></div>`);return;}
    const resolved=['settled','closed'];
    let lcRows=Array.isArray(lcAll)?lcAll:[];
    if(_rs==='active') lcRows=lcRows.filter(r=>!resolved.includes(r.stage||''));
    if(_rs==='resolved') lcRows=lcRows.filter(r=>resolved.includes(r.stage||''));
    const tClaim=lcRows.reduce((s,r)=>s+Number(r.claim_amount||0),0);
    const tSettled=lcRows.reduce((s,r)=>s+Number(r.settled_amount||0),0);
    const activeCount=lcRows.filter(r=>!resolved.includes(r.stage||'')).length;
    const lcStageLabel=v=>({pre_legal:'Pre-Legal',notice_sent:'Notice Sent',filed:'Filed',hearing:'Hearing',judgment:'Judgment',appeal:'Appeal',settled:'Settled',closed:'Closed'}[v]||v||'—');
    const lcTypeLabel=v=>({notice:'Notice',court:'Court',arbitration:'Arbitration',settlement:'Settlement'}[v]||v||'—');
    html=rptBanner([
      {v:lcRows.length,l:'total cases'},
      {v:activeCount,l:'active',c:'var(--err)'},
      {v:fM(tClaim),l:'total claim',c:'var(--brand)'},
      {v:fM(tSettled),l:'total settled',c:'var(--ok)'},
    ]);
    if(lcRows.length){
      const stageBadge=s=>{const isResolved=resolved.includes(s);const col=isResolved?'var(--ok)':'var(--err)';return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;background:${col}18;color:${col}">${lcStageLabel(s)}</span>`;};
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Case #</th><th>Client</th><th>Unit</th><th>Type</th><th>Stage</th><th>Lawyer</th><th>Filed</th><th>Next Hearing</th><th class="r">Claim (PKR)</th><th class="r">Settled (PKR)</th><th>Outcome</th></tr></thead>
      <tbody>${lcRows.map(r=>{
        const linkedUnit=(window._unitsCache||[]).find(u=>u.id===r.unit_id);
        return `<tr>
        <td style="font-weight:700;white-space:nowrap">${esc(r.case_number||'—')}</td>
        <td>${esc(r.clients?.client_name||'—')}</td>
        <td style="font-size:11px;color:var(--t2)">${linkedUnit?esc(linkedUnit.unitNo||linkedUnit.unit_no||'—'):'<span style="color:var(--t3)">—</span>'}</td>
        <td style="font-size:11px">${lcTypeLabel(r.case_type)}</td>
        <td>${stageBadge(r.stage||'')}</td>
        <td style="font-size:11px;color:var(--t2)">${esc(r.lawyer_name||'—')}</td>
        <td style="font-size:11px;white-space:nowrap">${r.filed_date?fD(r.filed_date):'—'}</td>
        <td style="font-size:11px;white-space:nowrap;color:${r.next_hearing_date&&r.next_hearing_date>=td()?'var(--brand)':'var(--t3)'}">${r.next_hearing_date?fD(r.next_hearing_date):'—'}</td>
        <td class="r mono" style="font-size:12px">${r.claim_amount?fM(r.claim_amount):'—'}</td>
        <td class="r mono" style="font-size:12px;color:var(--ok)">${r.settled_amount?fM(r.settled_amount):'—'}</td>
        <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.outcome||'')}">${esc(r.outcome||'—')}</td>
      </tr>`;}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700">
        <td colspan="8">TOTAL (${lcRows.length} cases)</td>
        <td class="r mono">${fM(tClaim)}</td>
        <td class="r mono" style="color:var(--ok)">${fM(tSettled)}</td>
        <td></td>
      </tr></tfoot></table></div></div>`;
    }else{
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="et">No legal cases found</div><div class="es">No cases match the current filter</div></div>`;
    }
    _set(html);return;
  }

  // ── TRANSFERS REGISTER ──
  if(_rt==='transfers_register'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading transfers…</div>`;
    const {data:trAll,error:trErr}=await supabase.rpc('list_unit_transfers_search',{p_company_id:S.cid,p_limit:500});
    if(trErr){_set(`<div class="empty"><div class="et">Could not load transfers</div><div class="es">${esc(trErr.message)}</div></div>`);return;}
    const trRows=Array.isArray(trAll)?trAll:[];
    const tFee=trRows.reduce((s,r)=>s+Number(r.transfer_fee||0),0);
    html=rptBanner([
      {v:trRows.length,l:'total transfers'},
      {v:fM(tFee),l:'total fees collected',c:'var(--ok)'},
    ]);
    if(trRows.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Voucher No.</th><th>Transfer Date</th><th>Unit</th><th>Project</th><th class="r">Transfer Fee (PKR)</th></tr></thead>
      <tbody>${trRows.map(r=>{
        const u=(window._unitsCache||[]).find(x=>x.id===r.unit_id);
        return `<tr>
        <td style="font-weight:700;white-space:nowrap">${esc(r.transfer_voucher_no||'—')}</td>
        <td style="white-space:nowrap">${r.transfer_date?fD(r.transfer_date):'—'}</td>
        <td style="font-weight:600">${u?esc(u.unitNo||u.unit_no||'—'):'<span style="color:var(--t3)">—</span>'}</td>
        <td style="font-size:11px;color:var(--t2)">${u?esc(u.projectName||u.project_name||'—'):'—'}</td>
        <td class="r mono" style="font-weight:700">${r.transfer_fee?fM(r.transfer_fee):'—'}</td>
      </tr>`;}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700">
        <td colspan="4">TOTAL (${trRows.length} transfers)</td>
        <td class="r mono">${fM(tFee)}</td>
      </tr></tfoot></table></div></div>`;
    }else{
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div><div class="et">No transfers found</div><div class="es">No unit ownership transfers have been recorded yet</div></div>`;
    }
    _set(html);return;
  }

  // ── UPCOMING PDC CHEQUES ──
  if(_rt==='pdc_upcoming'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading upcoming cheques…</div>`;
    const todayPU=td();
    const inXdPU=new Date();inXdPU.setDate(inXdPU.getDate()+(_rs==='7d'?7:30));const inXdPUStr=inXdPU.toISOString().slice(0,10);
    const {data:puRaw,error:puErr}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid,
      p_filters: { payment_method: 'cheque', deposit_confirmed: 'false', cheque_from: todayPU, cheque_to: inXdPUStr, limit: 500 }
    });
    if(puErr){_set(`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="et">Could not load upcoming cheques</div><div class="es">${esc(puErr.message)}</div></div>`);return;}
    const puPdcs=(puRaw||[]).map(p=>{const cl=(window._clientsCache||[]).find(c=>c.id===p.client_id)||null;return {...p,clientName:cl?.fullName||'—',clientPhone:cl?.phone||'—'};});
    const puAmt=puPdcs.reduce((s,p)=>s+Number(p.amount||0),0);
    const puToday=puPdcs.filter(p=>(p.cheque_date||p.payment_date)===todayPU).length;
    html=rptBanner([{v:puPdcs.length,l:'upcoming cheques'},{v:fM(puAmt),l:'total value'},{v:puToday,l:'due today',c:'var(--err)'}]);
    if(puPdcs.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Cheque Date</th><th>Days Left</th><th>Reference No.</th><th>Bank</th><th>Client</th><th>Phone</th><th class="r">Amount</th><th>Notes</th></tr></thead>
      <tbody>${puPdcs.map(p=>{const cdt=p.cheque_date||p.payment_date;const dLeft=Math.round((new Date(cdt)-new Date(todayPU))/(864e5));const urgCl=dLeft===0?'var(--err)':dLeft<=3?'#f59e0b':dLeft<=7?'var(--warn)':'var(--t1)';
        return `<tr>
        <td style="font-size:11px;white-space:nowrap;font-weight:700;color:${urgCl}">${fD(cdt)}</td>
        <td style="font-size:11px;font-weight:700;color:${urgCl}">${dLeft===0?'TODAY!':dLeft+' day'+(dLeft!==1?'s':'')}</td>
        <td style="font-family:monospace;font-weight:700">${esc(p.reference_no||'—')}</td>
        <td style="font-size:11px">${esc(p.bank_name||'—')}</td>
        <td style="font-weight:600">${esc(p.clientName)}</td>
        <td style="font-size:11px">${esc(p.clientPhone)}</td>
        <td class="r mono" style="font-weight:700">${fM(p.amount)}</td>
        <td style="font-size:11px;color:var(--t3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.notes||'—')}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="et">No upcoming cheques in this period</div></div>`;
    }
    _set(html);return;
  }

  // ── TAX / WHT REPORT ──
  if(_rt==='tax_report'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading tax data…</div>`;
    const {data:trPays=[],error:trErr}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid,
      p_filters: { tax_gt: 0, date_from: df.fr || null, date_to: df.to || null, limit: 500 }
    });
    if(trErr){html=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></div><div class="et">Could not load tax data</div><div class="es">${esc(trErr.message)}</div></div>`;ct.innerHTML=html;return;}
    const trTax=trPays.reduce((s,p)=>s+Number(p.tax_amount||0),0);
    const trAmt=trPays.reduce((s,p)=>s+Number(p.amount||0),0);
    const trSids=[...new Set(trPays.map(p=>p.sale_id).filter(Boolean))];
    let trSmMap={};
    if(trSids.length){const {data:trSd=[]}=await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: trSids });(trSd||[]).forEach(s=>{trSmMap[s.id]=s.unit_id;});}
    html=rptBanner([{v:trPays.length,l:'tax payments'},{v:fM(trAmt),l:'gross amount'},{v:fM(trTax),l:'total tax / WHT',c:'var(--warn)'}]);
    if(trPays.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Tax Type</th><th class="r">Payment</th><th class="r">Tax / WHT</th><th class="r">Tax %</th><th>Received By</th></tr></thead>
      <tbody>${trPays.map(p=>{const uid=trSmMap[p.sale_id];const u=uid?gunit(uid):null;const taxPct=p.amount?Math.round(p.tax_amount/p.amount*100):0;
        return `<tr class="${uid?'cr':''}" onclick="${uid?`openUD('${uid}')`:''}" >
        <td style="font-size:11px;white-space:nowrap">${fD(p.payment_date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'—')}</td>
        <td>${esc(u?.customerName||'—')}</td>
        <td><span class="badge bi">${esc(p.tax_type||'WHT')}</span></td>
        <td class="r mono">${fM(p.amount)}</td>
        <td class="r mono" style="color:var(--warn);font-weight:700">${fM(p.tax_amount)}</td>
        <td class="r" style="color:var(--warn)">${taxPct}%</td>
        <td style="font-size:11px;color:var(--t3)">${esc(p.created_by||'—')}</td>
      </tr>`;}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="4">TOTAL</td><td class="r mono">${fM(trAmt)}</td><td class="r mono" style="color:var(--warn)">${fM(trTax)}</td><td class="r" style="color:var(--warn)">${trAmt?Math.round(trTax/trAmt*100):0}%</td><td></td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></div><div class="et">No tax records found</div><div class="es">No payments with tax amounts in this period</div></div>`;
    }
    _set(html);return;
  }

  // ══ PAYMENTS / RECOVERY ════════════════════════════════════════════
  if(_rt==='recovery'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading payment records…</div>`;
    const {data:recPays=[],error:recErr}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid,
      p_filters: { date_from: df.fr || null, date_to: df.to || null, limit: 1000 }
    });
    if(recErr){_set(`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="et">Could not load payments</div><div class="es">${esc(recErr.message)}</div></div>`);return;}
    const recSids=[...new Set(recPays.map(p=>p.sale_id).filter(Boolean))];
    let recSmMap={};
    if(recSids.length){const {data:recSd=[]}=await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: recSids });(recSd||[]).forEach(s=>{recSmMap[s.id]=s.unit_id;});}
    const recRows=recPays.map(r=>({...r,unitId:recSmMap[r.sale_id]||null}));
    if(_rs==='daily'){
      const gp={};recRows.forEach(r=>{const d=r.payment_date;if(!gp[d])gp[d]={n:0,t:0};gp[d].n++;gp[d].t+=Number(r.amount);});
      const days=Object.keys(gp).sort().reverse();
      html=rptBanner([{v:recRows.length,l:'payments'},{v:fM(recRows.reduce((s,r)=>s+Number(r.amount),0)),l:'total',c:'var(--ok)'}]);
      html+=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Date</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead><tbody>${days.map(d=>`<tr><td><b>${fD(d)}</b></td><td class="r">${gp[d].n}</td><td class="r mono c-g" style="font-weight:700">${fM(gp[d].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='monthly'){
      const gp={};recRows.forEach(r=>{const m=r.payment_date.slice(0,7);if(!gp[m])gp[m]={n:0,t:0};gp[m].n++;gp[m].t+=Number(r.amount);});
      html=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead><tbody>${Object.keys(gp).sort().reverse().map(m=>`<tr><td><b>${m}</b></td><td class="r">${gp[m].n}</td><td class="r mono c-g">${fM(gp[m].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bytype'){
      const types=['cash','bank_transfer','cheque','online','other'];
      html=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Payment Method</th><th class="r">Count</th><th class="r">Total (PKR)</th></tr></thead><tbody>${types.map(tp=>{const tr=recRows.filter(r=>r.payment_method===tp);const t=tr.reduce((s,r)=>s+Number(r.amount),0);return tr.length?`<tr><td>${pbadge(tp)}</td><td class="r">${tr.length}</td><td class="r mono c-g" style="font-weight:700">${fM(t)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bystaff'){
      const um={};recRows.forEach(r=>{const k=r.created_by||'Unknown';if(!um[k])um[k]={n:0,t:0};um[k].n++;um[k].t+=Number(r.amount);});
      html=rptBanner([{v:recRows.length,l:'payments'},{v:fM(recRows.reduce((s,r)=>s+Number(r.amount),0)),l:'total',c:'var(--ok)'}]);
      html+=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Staff Member</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead><tbody>${Object.entries(um).sort((a,b)=>b[1].t-a[1].t).map(([id,d])=>`<tr><td><b>${gunm(id)||esc(id)}</b></td><td class="r">${d.n}</td><td class="r mono c-g" style="font-weight:700">${fM(d.t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else {
      const tot=recRows.reduce((s,r)=>s+Number(r.amount),0);
      const cash=recRows.filter(r=>r.payment_method==='cash').reduce((s,r)=>s+Number(r.amount),0);
      const bank=recRows.filter(r=>r.payment_method==='bank_transfer'||r.payment_method==='cheque').reduce((s,r)=>s+Number(r.amount),0);
      html=rptBanner([{v:recRows.length,l:'payments'},{v:fM(tot),l:'total',c:'var(--ok)'},{v:fM(cash),l:'cash'},{v:fM(bank),l:'bank/cheque'}]);
      html+=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Floor</th><th>Type</th><th>Method</th><th>Ref / Receipt</th><th>Notes</th><th>By</th><th class="r">Amount</th></tr></thead><tbody>${recRows.map(r=>{const u=r.unitId?gunit(r.unitId):null;return `<tr class="${r.unitId?'cr':''}" onclick="${r.unitId?`openUD('${r.unitId}')`:''}" ><td style="white-space:nowrap">${fD(r.payment_date)}</td><td style="font-weight:700">${esc(u?.unitNo||'—')}</td><td>${esc(u?.customerName||'—')}</td><td style="font-size:11px">${esc(u?.floorLabel||u?.floor||'—')}</td><td style="font-size:11px">${esc(u?.type||'—')}</td><td>${pbadge(r.payment_method)}</td><td style="font-size:11px;color:var(--t3)">${esc(r.reference_no||'—')}</td><td style="font-size:11px;color:var(--t3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.notes||'—')}</td><td style="font-size:11px;color:var(--t3)">${gunm(r.created_by)||esc(r.created_by)||'—'}</td><td class="r mono c-g" style="font-weight:700">+${fM(r.amount)}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    }
    _set(html);return;
  }

  // ══ STAFF REPORT ═══════════════════════════════════════════════════
  if(_rt==='staff'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading staff data…</div>`;
    const users=(window._appUsersCache||[]);
    const cons=gcons();
    const {data:stPays=[]}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid,
      p_filters: { date_from: df.fr || null, date_to: df.to || null, columns: 'sale_id,amount,payment_method,created_by,payment_date' }
    });
    if(_rs==='payments'){
      html=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Staff Member</th><th>Role</th><th class="r">Payments</th><th class="r">Cash</th><th class="r">Bank/Cheque</th><th class="r">Total</th></tr></thead><tbody>${users.map(usr=>{const ur=stPays.filter(r=>r.created_by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amount),0);const cash=ur.filter(r=>r.payment_method==='cash').reduce((s,r)=>s+Number(r.amount),0);const bank=ur.filter(r=>r.payment_method==='bank_transfer'||r.payment_method==='cheque').reduce((s,r)=>s+Number(r.amount),0);return ur.length?`<tr><td><b>${esc(usr.name)}</b></td><td style="font-size:11px">${usr.role}</td><td class="r">${ur.length}</td><td class="r mono">${cash?fM(cash):'—'}</td><td class="r mono">${bank?fM(bank):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(tot)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='calls'){
      html=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Staff</th><th class="r">Total</th><th class="r">Calls</th><th class="r">WA</th><th class="r">Meeting</th><th class="r">Will Pay</th><th class="r">No Resp</th></tr></thead><tbody>${users.map(usr=>{const uc=cons.filter(c=>c.agent_id===usr.id);return uc.length?`<tr><td><b>${esc(usr.name)}</b></td><td class="r" style="font-weight:700">${uc.length}</td><td class="r">${uc.filter(c=>c.channel==='Call').length||'—'}</td><td class="r">${uc.filter(c=>c.channel==='WhatsApp').length||'—'}</td><td class="r">${uc.filter(c=>c.channel==='Meeting').length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.response_received==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.response_received==='NoResponse').length||'—'}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else {
      html=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>Staff</th><th>Role</th><th class="r">Payments</th><th class="r">Collected</th><th class="r">Calls</th><th class="r">Will Pay</th><th class="r">No Response</th></tr></thead><tbody>${users.map(usr=>{const ur=stPays.filter(r=>r.created_by===usr.id);const uc=cons.filter(c=>c.agent_id===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amount),0);return `<tr><td><b>${esc(usr.name)}</b></td><td style="font-size:11px">${usr.role==='admin'?'<span class="badge bj">Admin</span>':'<span class="badge bi">Staff</span>'}</td><td class="r">${ur.length||'—'}</td><td class="r mono c-g">${tot?fM(tot):'—'}</td><td class="r">${uc.length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.response_received==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.response_received==='NoResponse').length||'—'}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    }
    _set(html);return;
  }

  // ══ AGENT RECOVERY ═════════════════════════════════════════════════
  if(_rt==='agent_recovery'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading agent recovery data…</div>`;
    const {data:arPays=[]}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid,
      p_filters: { date_from: df.fr || null, date_to: df.to || null }
    });
    const arSids=[...new Set(arPays.map(p=>p.sale_id).filter(Boolean))];
    let arSmMap={};
    if(arSids.length){const {data:arSd=[]}=await supabase.rpc('get_sales_unit_map', { p_company_id: S.cid, p_sale_ids: arSids });(arSd||[]).forEach(s=>{arSmMap[s.id]=s.unit_id;});}
    const arMap={};
    arPays.forEach(r=>{const u=r.sale_id?gunit(arSmMap[r.sale_id]):null;const ag=u?.soldBy||'Unassigned';if(!arMap[ag])arMap[ag]={count:0,total:0,cash:0,bank:0,units:new Set()};arMap[ag].count++;arMap[ag].total+=Number(r.amount||0);if(r.payment_method==='cash')arMap[ag].cash+=Number(r.amount||0);else if(r.payment_method==='bank_transfer'||r.payment_method==='cheque')arMap[ag].bank+=Number(r.amount||0);if(arSmMap[r.sale_id])arMap[ag].units.add(arSmMap[r.sale_id]);});
    const arRows=Object.entries(arMap).sort((a,b)=>b[1].total-a[1].total);
    const arGrandTot=arRows.reduce((s,[,d])=>s+d.total,0);
    html=rptBanner([{v:arRows.length,l:'agents'},{v:fM(arGrandTot),l:'total collected'},{v:arPays.length,l:'payments'}]);
    if(arRows.length){
      html+=`<div class="card"><div class="tw"><table class="t"><thead><tr><th>#</th><th>Agent / Staff</th><th class="r">Payments</th><th class="r">Units</th><th class="r">Cash</th><th class="r">Bank</th><th class="r">Total Collected</th><th class="r">Share</th></tr></thead><tbody>${arRows.map(([ag,d],i)=>{const share=arGrandTot?Math.round(d.total/arGrandTot*100):0;return `<tr><td style="font-size:11px;color:var(--t3)">${i+1}</td><td style="font-weight:700">${esc(ag)}</td><td class="r">${d.count}</td><td class="r">${d.units.size}</td><td class="r mono">${d.cash?fM(d.cash):'—'}</td><td class="r mono">${d.bank?fM(d.bank):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(d.total)}</td><td class="r"><span style="font-size:11px;font-weight:700;color:var(--brand)">${share}%</span></td></tr>`;}).join('')}</tbody><tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="6">TOTAL</td><td class="r mono c-g">${fM(arGrandTot)}</td><td class="r">100%</td></tr></tfoot></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div class="et">No recovery data found</div><div class="es">Try a different date range</div></div>`;
    }
    _set(html);return;
  }

  // ══ MONTHLY COLLECTION TREND ════════════════════════════════════════
  if(_rt==='monthly_trend'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading collection trend…</div>`;
    const mtFilters = { date_from: df.fr || null, date_to: df.to || null, limit: 2000 };
    if (_rs === 'year') { const yr = new Date().getFullYear(); mtFilters.date_from = yr+'-01-01'; mtFilters.date_to = yr+'-12-31'; }
    const {data:mtPays=[]}=await supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: mtFilters });
    const mtMap={};mtPays.forEach(r=>{const m=r.payment_date.slice(0,7);if(!mtMap[m])mtMap[m]={count:0,total:0,cash:0,bank:0};mtMap[m].count++;mtMap[m].total+=Number(r.amount||0);if(r.payment_method==='cash')mtMap[m].cash+=Number(r.amount||0);else if(r.payment_method==='bank_transfer'||r.payment_method==='cheque')mtMap[m].bank+=Number(r.amount||0);});
    const mtMonths=Object.keys(mtMap).sort().reverse();
    const mtMaxT=Math.max(...mtMonths.map(m=>mtMap[m].total),1);
    const mtGrandT=mtMonths.reduce((s,m)=>s+mtMap[m].total,0);
    html=rptBanner([{v:mtMonths.length,l:'months'},{v:fM(mtGrandT),l:'total collected'},{v:mtPays.length,l:'payments'}]);
    if(mtMonths.length){
      html+=`<div class="card" style="margin-bottom:14px"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Monthly Collection Trend</div><div style="position:relative;height:240px"><canvas id="rpt-trend-chart"></canvas></div></div><div class="card"><div class="tw"><table class="t"><thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Cash</th><th class="r">Bank</th><th class="r">Total Collected</th></tr></thead><tbody>${mtMonths.map(m=>{const d=mtMap[m];const [yr,mo]=m.split('-');const mName=new Date(yr,parseInt(mo)-1,1).toLocaleString('en-PK',{month:'long',year:'numeric'});return `<tr><td style="font-weight:700">${mName}</td><td class="r">${d.count}</td><td class="r mono">${d.cash?fM(d.cash):'—'}</td><td class="r mono">${d.bank?fM(d.bank):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(d.total)}</td></tr>`;}).join('')}</tbody><tfoot><tr style="background:var(--hover);font-weight:700"><td>TOTAL</td><td class="r">${mtPays.length}</td><td colspan="2"></td><td class="r mono c-g">${fM(mtGrandT)}</td></tr></tfoot></table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div class="et">No collection data found</div></div>`;
    }
    _set(html);
    if(_rptGenId===_gid&&mtMonths.length&&typeof Chart!=='undefined'){
      const cvs=document.getElementById('rpt-trend-chart');
      if(cvs){
        const lbs=mtMonths.slice(0,24).reverse().map(m=>{const[yr,mo]=m.split('-');return new Date(yr,parseInt(mo)-1,1).toLocaleString('en-PK',{month:'short',year:'2-digit'});});
        const vals=mtMonths.slice(0,24).reverse().map(m=>mtMap[m].total);
        const cashV=mtMonths.slice(0,24).reverse().map(m=>mtMap[m].cash||0);
        new Chart(cvs,{type:'bar',data:{labels:lbs,datasets:[{label:'Total',data:vals,backgroundColor:'rgba(99,102,241,0.28)',borderColor:'#6366f1',borderWidth:2,borderRadius:5,borderSkipped:false},{label:'Cash',data:cashV,backgroundColor:'rgba(16,185,129,0.28)',borderColor:'#10b981',borderWidth:2,borderRadius:5,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,labels:{color:'#94a3b8',font:{size:11},boxWidth:12}},tooltip:{callbacks:{label:c=>'PKR '+fM(c.raw)}}},scales:{y:{ticks:{callback:v=>fM(v),color:'#94a3b8',font:{size:10}},grid:{color:'rgba(148,163,184,0.1)'},border:{dash:[4,4]}},x:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:10}}}}}});
      }
    }
    return;
  }

  // ══ EXECUTIVE SUMMARY ══════════════════════════════════════════════
  if(_rt==='executive'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading executive summary…</div>`;
    const exAllU=gunits();const exSoldU=exAllU.filter(u=>u.status!=='Available'&&u.status!=='Dead');const exAvailU=exAllU.filter(u=>u.status==='Available');
    const exToday=td();const exMonthStart=exToday.slice(0,7)+'-01';
    const {data:exMonthPays=[]}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid, p_filters: { date_from: exMonthStart, date_to: exToday }
    });
    const exTotVal=exSoldU.reduce((s,u)=>s+Number(u.totalPrice||0),0);
    const exTotColl=exSoldU.reduce((s,u)=>s+actualPaid(u),0);
    const exTotPend=exSoldU.reduce((s,u)=>s+actualPending(u),0);
    const exMonthColl=exMonthPays.reduce((s,r)=>s+Number(r.amount||0),0);
    const exMonthCount=exMonthPays.length;
    const exTodayColl=exMonthPays.filter(r=>r.payment_date===exToday).reduce((s,r)=>s+Number(r.amount||0),0);
    const exTodayCount=exMonthPays.filter(r=>r.payment_date===exToday).length;
    const exOverdueU=exSoldU.filter(u=>actualPending(u)>0&&daysSincePay(u)!==null&&daysSincePay(u)>30);
    const exRecovPct=exTotVal?Math.round(exTotColl/exTotVal*100):0;
    const exProjs=window._projectsCache||[];
    const exKpi=(lbl,val,sub,col)=>`<div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;border-left:4px solid ${col}"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${lbl}</div><div style="font-size:22px;font-weight:700;color:${col};font-family:DM Mono,monospace">${val}</div><div style="font-size:11px;color:var(--t3);margin-top:3px">${sub}</div></div>`;
    html=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:18px">${exKpi('Total Portfolio',fM(exTotVal),exSoldU.length+' sold units','var(--brand)')}${exKpi('Total Collected',fM(exTotColl),exRecovPct+'% recovery rate','var(--ok)')}${exKpi('Outstanding',fM(exTotPend),exOverdueU.length+' overdue units','var(--err)')}${exKpi('This Month',fM(exMonthColl),exMonthCount+' payments','var(--info)')}${exKpi('Today',fM(exTodayColl),exTodayCount+' payments','var(--warn)')}${exKpi('Projects',exProjs.length,exAvailU.length+' units available','#7C3AED')}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div class="card"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Recovery Progress</div><div style="margin-bottom:8px;font-size:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--t3)">Overall Recovery</span><span style="font-weight:700;color:${exRecovPct>=80?'var(--ok)':exRecovPct>=50?'var(--warn)':'var(--err)'}">${exRecovPct}%</span></div><div style="height:8px;background:var(--hover);border-radius:4px;overflow:hidden"><div style="height:100%;width:${exRecovPct}%;background:${exRecovPct>=80?'var(--ok)':exRecovPct>=50?'var(--warn)':'var(--err)'};border-radius:4px;transition:width .4s"></div></div></div><div style="display:flex;gap:12px;font-size:11px;flex-wrap:wrap;margin-top:10px"><span style="color:var(--t3)">Collected: <b style="color:var(--ok)">${fM(exTotColl)}</b></span><span style="color:var(--t3)">Pending: <b style="color:var(--err)">${fM(exTotPend)}</b></span></div></div><div class="card"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Unit Summary</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center"><div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--t1)">${exAllU.length}</div><div style="font-size:10px;color:var(--t3)">Total</div></div><div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--ok)">${exSoldU.length}</div><div style="font-size:10px;color:var(--t3)">Sold</div></div><div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--info)">${exAvailU.length}</div><div style="font-size:10px;color:var(--t3)">Available</div></div></div><div style="position:relative;height:130px;margin-top:12px"><canvas id="rpt-exec-donut"></canvas></div></div></div>`;
    _set(html);
    if(_rptGenId===_gid&&typeof Chart!=='undefined'){
      const exCvs=document.getElementById('rpt-exec-donut');
      if(exCvs){const dead=exAllU.filter(u=>u.status==='Dead').length;new Chart(exCvs,{type:'doughnut',data:{labels:['Sold/Booked','Available','Dead/Other'],datasets:[{data:[exSoldU.length,exAvailU.length,dead],backgroundColor:['rgba(99,102,241,0.7)','rgba(16,185,129,0.7)','rgba(107,114,128,0.4)'],borderColor:['#6366f1','#10b981','#6b7280'],borderWidth:2,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:10},boxWidth:10,padding:8}},tooltip:{callbacks:{label:c=>c.label+': '+c.raw+' units'}}}}});}
    }
    return;
  }

  // ── UNITS ──
  if(_rt==='unit'){
    let u=gunits();
    if(_rs==='sold')u=u.filter(x=>x.status!=='Available'&&x.status!=='Dead');
    else if(_rs==='available')u=u.filter(x=>x.status==='Available');
    else if(_rs==='adjustment')u=u.filter(x=>x.status==='Adjustment');
    else if(_rs==='cashsale')u=u.filter(x=>x.status==='CashSale');
    else if(_rs==='overdue'){const od=getOverdueDays();u=u.filter(x=>isOverdue(x,od)&&actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));}
    const tPd=u.reduce((s,x)=>s+actualPaid(x),0);
    const tPn=u.reduce((s,x)=>s+actualPending(x),0);
    html=rptBanner([
      {v:u.length,l:'units',c:'var(--text)'},
      {v:fM(tPd),l:'collected',c:'var(--ok)'},
      {v:fM(tPn),l:'pending',c:'var(--err)'}
    ])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Unit</th><th>Floor</th><th>Type</th><th>Area</th><th>Status</th><th>Client</th><th>Phone</th><th>Booking</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Recovery</th><th>Last Pay</th><th>Sold By</th><th>Remarks</th></tr></thead>
    <tbody>${u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice),d=daysSincePay(x);
      return `<tr class="cr" onclick="openUD('${x.id}')">
        <td style="font-weight:700">${esc(x.unitNo)}</td>
        <td style="font-size:11px">${x.floorLabel||x.floor}</td>
        <td style="font-size:11px">${x.type}</td>
        <td style="font-size:11px">${x.area}</td>
        <td>${sbadge(x.status)}</td>
        <td style="font-weight:600">${esc(x.customerName)||'<span style="color:var(--t3)">—</span>'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.phone)||'—'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.bookingNo)||'—'}</td>
        <td class="mono">${x.totalPrice?fM(x.totalPrice):'—'}</td>
        <td class="mono c-g">${x.totalPrice?fM(pd):'—'}</td>
        <td class="mono" style="color:${rm>0?'var(--err)':'var(--ok)'};font-weight:${rm===0?700:400}">${x.totalPrice?(rm===0?'Paid':fM(rm)):'—'}</td>
        <td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        <td style="font-size:11px;color:${d!==null&&d>30?'var(--err)':'var(--t3)'}">${d!==null?d+'d ago':'Never'}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(x.soldBy)||'—'}</td>
        <td style="font-size:11px;color:var(--t3);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.remarks)}">${esc(x.remarks)||'—'}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;

  // ── UNITS BY STATUS ──
  } else if(_rt==='unit_status'){
    const u=gunits();
    const G={};
    u.forEach(x=>{
      const k=x.status||'—';
      if(!G[k])G[k]={n:0,val:0,paid:0,pend:0,color:x.statusColor||'#6b7280',avail:!!x.isAvailable};
      const g=G[k];g.n++;g.val+=Number(x.totalPrice||0);g.paid+=actualPaid(x);g.pend+=actualPending(x);
    });
    const rows=Object.entries(G).sort((a,b)=>b[1].n-a[1].n);
    const tN=u.length;
    const tVal=u.reduce((s,x)=>s+Number(x.totalPrice||0),0);
    const tPd=u.reduce((s,x)=>s+actualPaid(x),0);
    const tPn=u.reduce((s,x)=>s+actualPending(x),0);
    const cashN=u.filter(x=>Number(x.totalPrice||0)>0&&actualPending(x)===0).length;     // fully paid (100% cash)
    const instN=u.filter(x=>Number(x.totalPrice||0)>0&&actualPending(x)>0).length;        // dues still open
    const _badge=(name,color)=>`<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600"><span style="width:9px;height:9px;border-radius:3px;background:${color};flex-shrink:0"></span>${esc(name)}</span>`;

    if(_rs==='detail'){
      const su=[...u].sort((a,b)=>(a.status||'').localeCompare(b.status||'')||(a.unitNo||'').localeCompare(b.unitNo||''));
      html=rptBanner([{v:tN,l:'units'},{v:fM(tVal),l:'value'},{v:fM(tPd),l:'collected',c:'var(--ok)'},{v:fM(tPn),l:'pending',c:'var(--err)'}])
      +`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Status</th><th>Unit</th><th>Floor</th><th>Type</th><th>Client</th><th class="r">Total Price</th><th class="r">Paid</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${su.map(x=>{const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice);
        return `<tr class="cr" onclick="openUD('${x.id}')">
          <td>${_badge(x.status,x.statusColor||'#6b7280')}</td>
          <td style="font-weight:700">${esc(x.unitNo)}</td>
          <td style="font-size:11px">${esc(x.floorLabel||x.floor)}</td>
          <td style="font-size:11px">${esc(x.type)}</td>
          <td>${esc(x.customerName)||'<span style="color:var(--t3)">—</span>'}</td>
          <td class="r mono">${x.totalPrice?fM(x.totalPrice):'—'}</td>
          <td class="r mono c-g">${x.totalPrice?fM(pd):'—'}</td>
          <td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${x.totalPrice?(rm===0?'Paid':fM(rm)):'—'}</td>
          <td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      html=rptBanner([{v:tN,l:'total units'},{v:fM(tVal),l:'portfolio value'},{v:fM(tPd),l:'collected',c:'var(--ok)'},{v:fM(tPn),l:'pending',c:'var(--err)'}])
      +`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Status</th><th class="r">Units</th><th class="r">Share</th><th class="r">Total Value</th><th class="r">Collected</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${rows.map(([name,g])=>{const p2=pct(g.paid,g.val);const share=tN?Math.round(g.n/tN*100):0;
        return `<tr class="cr" onclick="setRS('detail')" title="Open detailed list">
          <td>${_badge(name,g.color)}${g.avail?' <span style="font-size:9px;color:var(--ok);font-weight:700">·AVAIL</span>':''}</td>
          <td class="r" style="font-weight:700">${g.n}</td>
          <td class="r" style="font-size:11px;color:var(--t3)">${share}%</td>
          <td class="r mono">${fM(g.val)}</td>
          <td class="r mono c-g">${fM(g.paid)}</td>
          <td class="r mono" style="color:${g.pend>0?'var(--err)':'var(--ok)'}">${fM(g.pend)}</td>
          <td><div style="display:flex;align-items:center;gap:5px"><div style="width:50px;height:5px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:${g.color};border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        </tr>`;}).join('')}
        <tr style="border-top:2px solid var(--bd);font-weight:700"><td>Total</td><td class="r">${tN}</td><td class="r">100%</td><td class="r mono">${fM(tVal)}</td><td class="r mono c-g">${fM(tPd)}</td><td class="r mono" style="color:var(--err)">${fM(tPn)}</td><td></td></tr>
      </tbody></table></div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;margin-top:10px;background:var(--canvas);border-radius:var(--rm);font-size:12px;align-items:center">
        <span style="color:var(--t3);font-size:11px;font-weight:700;letter-spacing:0.04em">FINANCIAL CUTS</span><span style="color:var(--t4)">·</span>
        <span style="color:var(--text)"><b>${cashN}</b> fully paid (100% cash)</span><span style="color:var(--t4)">·</span>
        <span style="color:var(--text)"><b>${instN}</b> with open dues (installment)</span>
        <span style="color:var(--t4)">·</span><span style="color:var(--t3);font-size:11px">Cash / Adjustment are financial cuts, not statuses — adjust via Unit status master if needed.</span>
      </div>`;
    }

  // ── SALES BY TYPE ──
  } else if(_rt==='sale_type'){
    const u=gunits().filter(x=>x.saleId);                       // only actual sales/bookings
    const STM={}; (window._saleTypesCache||[]).forEach(t=>{STM[t.id]={name:t.name,color:t.color};});
    const G={};
    u.forEach(x=>{
      const t=STM[x.saleTypeId]||{name:'Unspecified',color:'#94A3B8'};
      const k=t.name;
      if(!G[k])G[k]={n:0,val:0,paid:0,pend:0,color:t.color};
      const g=G[k];g.n++;g.val+=Number(x.totalPrice||0);g.paid+=actualPaid(x);g.pend+=actualPending(x);
    });
    const rows=Object.entries(G).sort((a,b)=>b[1].n-a[1].n);
    const tN=u.length;
    const tVal=u.reduce((s,x)=>s+Number(x.totalPrice||0),0);
    const tPd=u.reduce((s,x)=>s+actualPaid(x),0);
    const tPn=u.reduce((s,x)=>s+actualPending(x),0);
    const _b=(name,color)=>`<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600"><span style="width:9px;height:9px;border-radius:3px;background:${color};flex-shrink:0"></span>${esc(name)}</span>`;

    if(_rs==='detail'){
      const su=[...u].sort((a,b)=>(STM[a.saleTypeId]?.name||'~').localeCompare(STM[b.saleTypeId]?.name||'~')||(a.unitNo||'').localeCompare(b.unitNo||''));
      html=rptBanner([{v:tN,l:'sold units'},{v:fM(tVal),l:'value'},{v:fM(tPd),l:'collected',c:'var(--ok)'},{v:fM(tPn),l:'pending',c:'var(--err)'}])
      +`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Sale Type</th><th>Unit</th><th>Client</th><th>Booking</th><th class="r">Total Price</th><th class="r">Paid</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${su.map(x=>{const t=STM[x.saleTypeId]||{name:'Unspecified',color:'#94A3B8'};const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice);
        return `<tr class="cr" onclick="openUD('${x.id}')">
          <td>${_b(t.name,t.color)}</td>
          <td style="font-weight:700">${esc(x.unitNo)}</td>
          <td>${esc(x.customerName)||'<span style="color:var(--t3)">—</span>'}</td>
          <td style="font-size:11px;color:var(--t3)">${esc(x.bookingNo)||'—'}</td>
          <td class="r mono">${x.totalPrice?fM(x.totalPrice):'—'}</td>
          <td class="r mono c-g">${x.totalPrice?fM(pd):'—'}</td>
          <td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${x.totalPrice?(rm===0?'Paid':fM(rm)):'—'}</td>
          <td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      html=rptBanner([{v:tN,l:'sold units'},{v:fM(tVal),l:'total value'},{v:fM(tPd),l:'collected',c:'var(--ok)'},{v:fM(tPn),l:'pending',c:'var(--err)'}])
      +(rows.length?'':`<div style="padding:10px 16px;margin-bottom:10px;background:var(--canvas);border-radius:var(--rm);font-size:12px;color:var(--t3)">No sales yet, or sale types not assigned. Set a Sale Type on the sale form (and add types in Types &amp; Floors).</div>`)
      +`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Sale Type</th><th class="r">Deals</th><th class="r">Share</th><th class="r">Total Value</th><th class="r">Collected</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${rows.map(([name,g])=>{const p2=pct(g.paid,g.val);const share=tN?Math.round(g.n/tN*100):0;
        return `<tr class="cr" onclick="setRS('detail')" title="Open detailed list">
          <td>${_b(name,g.color)}</td>
          <td class="r" style="font-weight:700">${g.n}</td>
          <td class="r" style="font-size:11px;color:var(--t3)">${share}%</td>
          <td class="r mono">${fM(g.val)}</td>
          <td class="r mono c-g">${fM(g.paid)}</td>
          <td class="r mono" style="color:${g.pend>0?'var(--err)':'var(--ok)'}">${fM(g.pend)}</td>
          <td><div style="display:flex;align-items:center;gap:5px"><div style="width:50px;height:5px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:${g.color};border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td>
        </tr>`;}).join('')}
        ${rows.length?`<tr style="border-top:2px solid var(--bd);font-weight:700"><td>Total</td><td class="r">${tN}</td><td class="r">100%</td><td class="r mono">${fM(tVal)}</td><td class="r mono c-g">${fM(tPd)}</td><td class="r mono" style="color:var(--err)">${fM(tPn)}</td><td></td></tr>`:''}
      </tbody></table></div></div>`;
    }

  // ── CLIENTS ──
  } else if(_rt==='client'){
    let u=gunits().filter(x=>x.customerName);
    if(_rs==='defaulters')u=u.filter(x=>actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));
    if(_rs==='ledger'){
      const cl={};u.forEach(x=>{const k=x.customerName;if(!cl[k])cl[k]={units:[],phone:x.phone};cl[k].units.push(x);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>#</th><th>Client Name</th><th>Phone</th><th>Units</th><th>Total Value</th><th>Paid</th><th class="r">Pending</th><th>Recovery</th></tr></thead>
      <tbody>${Object.entries(cl).sort((a,b)=>a[0].localeCompare(b[0])).map(([nm,d],i)=>{
        const tv=d.units.reduce((s,x)=>s+Number(x.totalPrice||0),0);
        const tp=d.units.reduce((s,x)=>s+actualPaid(x),0);
        const rm=d.units.reduce((s,x)=>s+actualPending(x),0);
        const p2=pct(tp,tv);
        return `<tr><td style="font-size:11px;color:var(--t3)">${i+1}</td><td><b>${esc(nm)}</b></td><td style="font-size:11px">${esc(d.phone)||'—'}</td><td>${d.units.length}</td><td class="mono">${fM(tv)}</td><td class="mono c-g">${fM(tp)}</td><td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${fM(rm)}</td><td><div style="display:flex;align-items:center;gap:5px"><div style="width:40px;height:4px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:${p2}%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px;color:var(--t3)">${p2}%</span></div></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    } else {
      html=rptBanner([{v:u.length,l:'clients'},{v:fM(u.reduce((s,x)=>s+actualPaid(x),0)),l:'paid',c:'var(--ok)'},{v:fM(u.reduce((s,x)=>s+actualPending(x),0)),l:'pending',c:'var(--err)'}])+`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Unit</th><th>Floor</th><th>Client</th><th>Phone</th><th>Booking</th><th>Sale Type</th><th>Sold By</th><th>Last Pay</th><th>Remarks</th><th>Paid</th><th class="r">Pending</th></tr></thead>
      <tbody>${u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),d=daysSincePay(x);
        return `<tr class="cr" onclick="openUD('${x.id}')"><td style="font-weight:700">${esc(x.unitNo)}</td><td style="font-size:11px">${x.floorLabel||x.floor}</td><td><b>${esc(x.customerName)}</b></td><td style="font-size:11px">${esc(x.phone)||'—'}</td><td style="font-size:11px">${esc(x.bookingNo)||'—'}</td><td>${sbadge(x.status)}</td><td style="font-size:11px">${esc(x.soldBy)||'—'}</td><td style="font-size:11px;color:${d!==null&&d>30?'var(--err)':'var(--t3)'}">${d!==null?d+'d ago':'—'}</td><td style="font-size:11px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.remarks)||'—'}</td><td class="mono c-g">${fM(pd)}</td><td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${fM(rm)}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    }

  // ── PAYMENTS / RECOVERY ──
  } else if(_rt==='recovery'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading payment data…</div>`;
    const {data:_rpRaw=[]}=await supabase.rpc('list_payments_with_sales_unit', {
      p_company_id: S.cid,
      p_filters: { date_from: df.fr || null, date_to: df.to || null }
    });
    const recs=_rpRaw.map(r=>({id:r.id,date:r.payment_date||'',amt:Number(r.amount||0),ptype:r.payment_method||'',by:r.created_by||'',uid:r.sales?.unit_id||null,rcpt:r.reference_no||'',notes:r.notes||''}));
    if(_rs==='daily'){
      const gp={};recs.forEach(r=>{const d=r.date;if(!gp[d])gp[d]={n:0,t:0};gp[d].n++;gp[d].t+=Number(r.amt);});
      const days=Object.keys(gp).sort().reverse();
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${days.map(d=>`<tr><td><b>${fD(d)}</b></td><td class="r">${gp[d].n}</td><td class="r mono c-g" style="font-weight:700">${fM(gp[d].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='monthly'){
      const gp={};recs.forEach(r=>{const m=r.date.slice(0,7);if(!gp[m])gp[m]={n:0,t:0};gp[m].n++;gp[m].t+=Number(r.amt);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${Object.keys(gp).sort().reverse().map(m=>`<tr><td><b>${m}</b></td><td class="r">${gp[m].n}</td><td class="r mono c-g">${fM(gp[m].t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bytype'){
      const types=['Cash','Bank','Adjustment'];
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Payment Type</th><th class="r">Count</th><th class="r">Total (PKR)</th></tr></thead>
      <tbody>${types.map(tp=>{const tr=recs.filter(r=>r.ptype===tp);const t=tr.reduce((s,r)=>s+Number(r.amt),0);return tr.length?`<tr><td>${pbadge(tp)}</td><td class="r">${tr.length}</td><td class="r mono c-g" style="font-weight:700">${fM(t)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='bystaff'){
      const um={};recs.forEach(r=>{if(!um[r.by])um[r.by]={n:0,t:0};um[r.by].n++;um[r.by].t+=Number(r.amt);});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff Member</th><th class="r">Payments</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${Object.entries(um).sort((a,b)=>b[1].t-a[1].t).map(([id,d])=>`<tr><td><b>${gunm(id)}</b></td><td class="r">${d.n}</td><td class="r mono c-g" style="font-weight:700">${fM(d.t)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else {
      recs.sort((a,b)=>b.date.localeCompare(a.date));const tot=recs.reduce((s,r)=>s+Number(r.amt),0);
      const cash=recs.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);
      const bank=recs.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);
      html=rptBanner([{v:recs.length,l:'payments'},{v:fM(tot),l:'total',c:'var(--ok)'},{v:fM(cash),l:'cash'},{v:fM(bank),l:'bank'}])+`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Floor</th><th>Type</th><th>Payment Type</th><th>Receipt</th><th>Notes</th><th>By</th><th class="r">Amount</th></tr></thead>
      <tbody>${recs.map(r=>{const u=gunit(r.uid);return `<tr class="cr" onclick="${r.uid?`openUD('${r.uid}')`:''}" ><td>${fD(r.date)}</td><td style="font-weight:700">${esc(u?.unitNo||'?')}</td><td>${esc(u?.customerName||'—')}</td><td style="font-size:11px">${u?.floorLabel||''}</td><td style="font-size:11px">${u?.type||''}</td><td>${pbadge(r.ptype)}</td><td style="font-size:11px;color:var(--t3)">${r.rcpt||'—'}</td><td style="font-size:11px;color:var(--t3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.notes||'—'}</td><td style="font-size:11px;color:var(--t3)">${gunm(r.by)}</td><td class="r mono c-g" style="font-weight:700">+${fM(r.amt)}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    }

  // ── STAFF ──
  } else if(_rt==='staff'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading staff data…</div>`;
    const users=window._appUsersCache||[];
    const cons=gcons();
    let staffRecs=[];
    if(_rs!=='calls'){
      const {data:stPays=[]}=await supabase.rpc('list_payments_filtered', {
        p_company_id: S.cid,
        p_filters: { date_from: df.fr || null, date_to: df.to || null, limit: 2000 }
      });
      staffRecs=stPays.map(r=>({id:r.id,date:r.payment_date||'',amt:Number(r.amount||0),ptype:r.payment_method||'',by:r.created_by||''}));
    }
    if(_rs==='payments'){
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff Member</th><th>Role</th><th class="r">Payments</th><th class="r">Cash</th><th class="r">Bank</th><th class="r">Adj</th><th class="r">Total</th></tr></thead>
      <tbody>${users.map(usr=>{const ur=staffRecs.filter(r=>r.by===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);const cash=ur.filter(r=>r.ptype==='Cash').reduce((s,r)=>s+Number(r.amt),0);const bank=ur.filter(r=>r.ptype==='Bank').reduce((s,r)=>s+Number(r.amt),0);const adj=ur.filter(r=>r.ptype==='Adjustment').reduce((s,r)=>s+Number(r.amt),0);return ur.length?`<tr><td><b>${esc(usr.name||usr.fullName||'')}</b></td><td style="font-size:11px">${usr.role}</td><td class="r">${ur.length}</td><td class="r mono">${cash?fM(cash):'—'}</td><td class="r mono">${bank?fM(bank):'—'}</td><td class="r mono">${adj?fM(adj):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(tot)}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else if(_rs==='calls'){
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff</th><th class="r">Total</th><th class="r">Calls</th><th class="r">WA</th><th class="r">Meeting</th><th class="r">Will Pay</th><th class="r">No Resp</th></tr></thead>
      <tbody>${users.map(usr=>{const uc=cons.filter(c=>(c.agent_id||c.created_by)===usr.id);return uc.length?`<tr><td><b>${esc(usr.name||usr.fullName||'')}</b></td><td class="r" style="font-weight:700">${uc.length}</td><td class="r">${uc.filter(c=>c.channel==='Call').length||'—'}</td><td class="r">${uc.filter(c=>c.channel==='WhatsApp').length||'—'}</td><td class="r">${uc.filter(c=>c.channel==='Meeting').length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.response_received==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.response_received==='NoResponse').length||'—'}</td></tr>`:''}).join('')}</tbody></table></div></div>`;
    } else {
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Staff</th><th>Role</th><th class="r">Payments</th><th class="r">Collected</th><th class="r">Calls</th><th class="r">Will Pay</th><th class="r">No Response</th></tr></thead>
      <tbody>${users.map(usr=>{const ur=staffRecs.filter(r=>r.by===usr.id);const uc=cons.filter(c=>(c.agent_id||c.created_by)===usr.id);const tot=ur.reduce((s,r)=>s+Number(r.amt),0);return `<tr><td><b>${esc(usr.name||usr.fullName||'')}</b></td><td style="font-size:11px">${usr.role==='admin'?'<span class="badge bj">Admin</span>':'<span class="badge bi">Staff</span>'}</td><td class="r">${ur.length||'—'}</td><td class="r mono c-g">${tot?fM(tot):'—'}</td><td class="r">${uc.length||'—'}</td><td class="r" style="color:var(--ok)">${uc.filter(c=>c.response_received==='WillPay').length||'—'}</td><td class="r" style="color:var(--err)">${uc.filter(c=>c.response_received==='NoResponse').length||'—'}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    }

  // ── CONTACT LOGS / COMMENTS ──
  } else if(_rt==='contacts'){
    const t=td();let cons=gcons().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    if(_rs==='overdue')cons=cons.filter(c=>c.next_followup_date&&c.next_followup_date<t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date));
    else if(_rs==='today')cons=cons.filter(c=>c.next_followup_date===t);
    else if(_rs==='upcoming')cons=cons.filter(c=>c.next_followup_date&&c.next_followup_date>t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date));
    else if(_rs==='willpay')cons=cons.filter(c=>c.response_received==='WillPay');
    html=rptBanner([{v:cons.length,l:'logs'},{v:cons.filter(c=>c.response_received==='WillPay').length,l:'will pay',c:'var(--ok)'},{v:cons.filter(c=>c.next_followup_date&&c.next_followup_date<t).length,l:'follow-up overdue',c:'var(--err)'}])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Date</th><th>Unit</th><th>Client</th><th>Phone</th><th>Channel</th><th>Response</th><th>Remarks</th><th>Follow-up</th><th>Agent</th></tr></thead>
    <tbody>${cons.map(c=>{const u=gunit(c.unit_id);const fuOv=c.next_followup_date&&c.next_followup_date<t;const fuTdy=c.next_followup_date===t;
      return `<tr class="cr" onclick="openUD('${c.unit_id}')">
        <td style="white-space:nowrap">${fD(c.contact_date)}</td>
        <td style="font-weight:700">${esc(u?.unitNo||'?')}</td>
        <td>${esc(u?.customerName||c.client_name||'—')}</td>
        <td style="font-size:11px">${esc(u?.phone||'—')}</td>
        <td>${ctic(c.channel)} ${c.channel}</td>
        <td>${cbadge(c.response_received)}</td>
        <td style="font-size:11px;color:var(--t2);max-width:200px;word-break:break-word">${esc(c.remarks||'—')}</td>
        <td style="font-size:11px;color:${fuOv?'var(--err)':fuTdy?'var(--warn)':'var(--t3)'};font-weight:${fuOv||fuTdy?700:400};white-space:nowrap">${c.next_followup_date?fD(c.next_followup_date):'—'}</td>
        <td style="font-size:11px;color:var(--t3)">${gunm(c.agent_id)}</td>
      </tr>`;}).join('')}</tbody></table></div></div>`;

  // ── FOLLOW-UPS ──
  } else if(_rt==='followup'){
    const t=td();const allCons=gcons().filter(c=>c.next_followup_date);
    let cons=allCons;
    if(_rs==='overdue')cons=allCons.filter(c=>c.next_followup_date<t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date));
    else if(_rs==='today')cons=allCons.filter(c=>c.next_followup_date===t);
    else if(_rs==='upcoming')cons=allCons.filter(c=>c.next_followup_date>t).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date));
    html=rptBanner([{v:cons.length,l:'follow-ups'},{v:allCons.filter(c=>c.next_followup_date<t).length,l:'overdue',c:'var(--err)'},{v:allCons.filter(c=>c.next_followup_date===t).length,l:'today',c:'var(--warn)'}])+`<div class="card"><div class="tw"><table class="t">
    <thead><tr><th>Unit</th><th>Customer</th><th>Phone</th><th>Channel</th><th>Response</th><th>Follow-up Date</th><th>Remarks</th><th>Agent</th></tr></thead>
    <tbody>${cons.map(c=>{const u=gunit(c.unit_id);const isOv=c.next_followup_date<t;const isTo=c.next_followup_date===t;
      return `<tr class="cr" onclick="openUD('${c.unit_id}')"><td style="font-weight:700">${esc(u?.unitNo||'?')}</td><td><b>${esc(u?.customerName||c.client_name||'—')}</b></td><td style="font-size:11px">${esc(u?.phone||'—')}</td><td>${ctic(c.channel)} ${c.channel}</td><td>${cbadge(c.response_received)}</td><td style="color:${isOv?'var(--err)':isTo?'var(--warn)':'var(--t3)'};font-weight:${isOv||isTo?700:400}">${fD(c.next_followup_date)}</td><td style="font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.remarks||'—')}</td><td style="font-size:11px;color:var(--t3)">${gunm(c.agent_id)}</td></tr>`;}).join('')}</tbody></table></div></div>`;

  // ══ DAILY ACTIVITY REPORT ══════════════════════════════════
  } else if(_rt==='activity'){
    var t2=td();
    var actCons=gcons().sort(function(a,b){return b.contact_date.localeCompare(a.contact_date)||(b.created_at||'').localeCompare(a.created_at||'');});
    if(df.fr)actCons=actCons.filter(function(c){return c.contact_date>=df.fr;});
    if(df.to)actCons=actCons.filter(function(c){return c.contact_date<=df.to;});
    var actStaffVal=ssVal('act-staff-sel');
    if(actStaffVal&&actStaffVal!=='all')actCons=actCons.filter(function(c){return c.agent_id===actStaffVal;});
    if(!actCons.length){
      html='<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><div class="et">No activity found</div><div class="es">Try a different date range or staff filter</div></div>';
    } else {
      var actByDate={};
      actCons.forEach(function(c){if(!actByDate[c.contact_date])actByDate[c.contact_date]=[];actByDate[c.contact_date].push(c);});
      var actDates=Object.keys(actByDate).sort().reverse();
      var actTot=actCons.length;
      var actWP=actCons.filter(function(c){return c.response_received==='WillPay';}).length;
      var actNR=actCons.filter(function(c){return c.response_received==='NoResponse';}).length;
      html=rptBanner([{v:actTot,l:'total calls'},{v:actWP,l:'will pay',c:'var(--ok)'},{v:actNR,l:'no response',c:'var(--err)'},{v:actDates.length,l:'days'}]);
      html+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">';
      html+='<label style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Filter Staff:</label>';
      html+='<div id="act-staff-wrap" style="min-width:160px"></div>';
      html+='<button class="btn btn-g btn-sm" onclick="runRpt()">Apply</button></div>';
      actDates.forEach(function(date){
        var dl=actByDate[date];
        var dn=new Date(date+'T00:00:00').toLocaleDateString('en-PK',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
        var dwp=dl.filter(function(c){return c.response_received==='WillPay';}).length;
        var dnr=dl.filter(function(c){return c.response_received==='NoResponse';}).length;
        html+='<div style="margin-bottom:20px">';
        html+='<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:linear-gradient(135deg,var(--ink),#1E2D47);border-radius:var(--r) 12px 0 0;color:#fff">';
        html+='<svg width="16" height="16" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        html+='<div><div style="font-size:14px;font-weight:700">'+dn+'</div>';
        html+='<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:2px">'+dl.length+' contact'+(dl.length!==1?'s':'')+' &nbsp;·&nbsp; '+dwp+' will pay &nbsp;·&nbsp; '+dnr+' no response</div></div></div>';
        html+='<div class="card" style="border-radius:0 0 12px 12px;border-top:none"><div class="tw"><table class="t">';
        html+='<thead><tr><th>Agent</th><th>Unit</th><th>Client</th><th>Phone</th><th>Channel</th><th>Response</th><th>Remarks</th><th>Follow-up</th></tr></thead><tbody>';
        dl.forEach(function(c){
          var u=gunit(c.unit_id);
          var fuOv=c.next_followup_date&&c.next_followup_date<t2;
          var fuTdy=c.next_followup_date&&c.next_followup_date===t2;
          var rowClr=c.response_received==='WillPay'?'var(--ok)':c.response_received==='Dispute'?'var(--err)':c.response_received==='NoResponse'?'#CBD5E1':'var(--info)';
          html+='<tr style="border-left:3px solid '+rowClr+'">';
          html+='<td style="font-size:12px;font-weight:600;white-space:nowrap">'+gunm(c.agent_id)+'</td>';
          html+='<td style="font-family:\'DM Mono\',monospace;font-size:12px;font-weight:700;cursor:pointer;color:var(--info)" onclick="openUD(\''+c.unit_id+'\')">'+esc(u?u.unitNo:'?')+'</td>';
          html+='<td style="font-size:12px">'+esc(u&&u.customerName?u.customerName:c.client_name||'—')+'</td>';
          html+='<td style="font-size:11px;color:var(--t3)">'+esc(u&&u.phone?u.phone:'—')+'</td>';
          html+='<td>'+ctic(c.channel)+' <span style="font-size:11px">'+c.channel+'</span></td>';
          html+='<td>'+cbadge(c.response_received)+'</td>';
          html+='<td style="font-size:12px;color:var(--t2);max-width:260px;word-break:break-word">'+(c.remarks?esc(c.remarks):'<i style="color:var(--t4)">No notes</i>')+'</td>';
          html+='<td style="font-size:11px;color:'+(fuOv?'var(--err)':fuTdy?'var(--warn)':'var(--t3)')+';font-weight:'+(fuOv||fuTdy?700:400)+'">'+(c.next_followup_date?fD(c.next_followup_date):'—')+'</td>';
          html+='</tr>';
        });
        html+='</tbody></table></div></div></div>';
      });
    }


  // ══ AGING ANALYSIS ══════════════════════════════════════════
  } else if(_rt==='aging'){
    const od=getOverdueDays();
    let ov=gunits().filter(function(u){return u.status!=='Available'&&u.status!=='Dead'&&actualPending(u)>0;});
    const minDays={'all':0,'30':30,'60':60,'90':90,'180':180}[_rs]||0;
    ov=ov.filter(function(u){var d=daysSincePay(u);return d===null||d>=minDays;}).sort(function(a,b){return actualPending(b)-actualPending(a);});
    var b0=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d<30;});
    var b30=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=30&&d<60;});
    var b60=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=60&&d<90;});
    var b90=ov.filter(function(u){var d=daysSincePay(u);return d!==null&&d>=90&&d<180;});
    var b180=ov.filter(function(u){var d=daysSincePay(u);return d===null||d>=180;});
    var tot0=b0.reduce(function(s,u){return s+actualPending(u);},0);
    var tot30=b30.reduce(function(s,u){return s+actualPending(u);},0);
    var tot60=b60.reduce(function(s,u){return s+actualPending(u);},0);
    var tot90=b90.reduce(function(s,u){return s+actualPending(u);},0);
    var tot180=b180.reduce(function(s,u){return s+actualPending(u);},0);
    var totAll=ov.reduce(function(s,u){return s+actualPending(u);},0);
    html='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">';
    var buckets=[
      {lbl:'0–30 Days',n:b0.length,t:tot0,c:'var(--warn)'},
      {lbl:'31–60 Days',n:b30.length,t:tot30,c:'#EA580C'},
      {lbl:'61–90 Days',n:b60.length,t:tot60,c:'var(--err)'},
      {lbl:'91–180 Days',n:b90.length,t:tot90,c:'#7F1D1D'},
      {lbl:'180+ / Never',n:b180.length,t:tot180,c:'#450A0A'},
    ];
    buckets.forEach(function(bk){
      html+='<div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;border-top:4px solid '+bk.c+'">';
      html+='<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">'+bk.lbl+'</div>';
      html+='<div style="font-family:DM Mono,monospace;font-size:20px;font-weight:700;color:'+bk.c+'">'+fM(bk.t)+'</div>';
      html+='<div style="font-size:11px;color:var(--t3);margin-top:3px">'+bk.n+' units</div>';
      html+='</div>';
    });
    html+='</div>';
    html+='<div class="card" style="margin-bottom:14px"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Aging Bucket Analysis</div><div style="position:relative;height:150px"><canvas id="rpt-aging-chart"></canvas></div></div>';
    html+=rptBanner([{v:ov.length,l:'overdue units'},{v:fM(totAll),l:'total pending',c:'var(--err)'}]);
    html+='<div class="card"><div class="tw"><table class="t"><thead><tr>';
    html+='<th>Unit</th><th>Floor</th><th>Client</th><th>Phone</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Last Payment</th><th>Days Overdue</th><th>Bucket</th><th>Last Contact</th></tr></thead><tbody>';
    ov.forEach(function(u){
      var d=daysSincePay(u);var pd=actualPaid(u);var rm=actualPending(u);
      var bucket=d===null||d>=180?'180+ / Never':d>=90?'91–180 Days':d>=60?'61–90 Days':d>=30?'31–60 Days':'0–30 Days';
      var bcolor=d===null||d>=180?'#450A0A':d>=90?'#7F1D1D':d>=60?'var(--err)':d>=30?'#EA580C':'var(--warn)';
      var lastCons=gcons(u.id).sort(function(a,b){return (b.created_at||'').localeCompare(a.created_at||'');})[0];
      html+='<tr onclick="openUD(\''+u.id+'\')" class="cr" style="cursor:pointer">';
      html+='<td style="font-weight:700">'+esc(u.unitNo)+'</td>';
      html+='<td style="font-size:11px">'+esc(u.floorLabel||u.floor)+'</td>';
      html+='<td>'+esc(u.customerName||'—')+'</td>';
      html+='<td style="font-size:11px">'+esc(u.phone||'—')+'</td>';
      html+='<td class="mono">'+fM(u.totalPrice)+'</td>';
      html+='<td class="mono c-g">'+fM(pd)+'</td>';
      html+='<td class="mono" style="color:var(--err);font-weight:700">'+fM(rm)+'</td>';
      html+='<td style="font-size:11px">'+(u.lastPaymentDate?fD(u.lastPaymentDate):'Never')+'</td>';
      html+='<td style="font-weight:700;color:'+bcolor+'">'+(d===null?'Never paid':d+' days')+'</td>';
      html+='<td><span style="background:'+bcolor+'22;color:'+bcolor+';padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap">'+bucket+'</span></td>';
      html+='<td style="font-size:11px;color:var(--t3)">'+(lastCons?fD(lastCons.contact_date)+' ('+lastCons.response_received+')':'Never contacted')+'</td>';
      html+='</tr>';
    });
    html+='</tbody></table></div></div>';

  // ══ CLIENT STATEMENT ════════════════════════════════════════
  } else if(_rt==='statement'){
    var stUnits=gunits().filter(function(u){return u.customerName&&u.status!=='Available'&&u.status!=='Dead';});
    if(_rs==='client'){
      var stMap={};
      stUnits.forEach(function(u){var k=u.customerName;if(!stMap[k])stMap[k]=[];stMap[k].push(u);});
      html='<div style="margin-bottom:10px;font-size:12px;color:var(--t3)">'+Object.keys(stMap).length+' clients — click a client to view full statement</div>';
      html+='<div class="card"><div class="tw"><table class="t"><thead><tr><th>Client</th><th>Phone</th><th>Units</th><th>Total Value</th><th>Total Paid</th><th>Pending</th><th>Recovery</th><th></th></tr></thead><tbody>';
      Object.entries(stMap).sort(function(a,b){return a[0].localeCompare(b[0]);}).forEach(function(entry){
        var nm=entry[0],units=entry[1];
        var tv=units.reduce(function(s,u){return s+Number(u.totalPrice||0);},0);
        var tp=units.reduce(function(s,u){return s+actualPaid(u);},0);
        var rm=units.reduce(function(s,u){return s+actualPending(u);},0);
        var p2=tv?Math.round(tp/tv*100):0;
        html+='<tr><td><b>'+esc(nm)+'</b></td><td style="font-size:11px">'+esc(units[0].phone||'—')+'</td>';
        html+='<td>'+units.length+'</td><td class="mono">'+fM(tv)+'</td>';
        html+='<td class="mono c-g">'+fM(tp)+'</td>';
        html+='<td class="mono" style="color:'+(rm>0?'var(--err)':'var(--ok)')+'">'+fM(rm)+'</td>';
        html+='<td><div style="display:flex;align-items:center;gap:5px"><div style="width:50px;height:5px;background:#EEF0F5;border-radius:2px;overflow:hidden"><div style="height:100%;width:'+p2+'%;background:var(--ok);border-radius:2px"></div></div><span style="font-size:10px">'+p2+'%</span></div></td>';
        html+='<td><button class="btn btn-gh btn-xs" onclick="printClientStatement(\''+esc(nm)+'\')">Statement</button></td>';
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
    } else {
      html=rptBanner([{v:stUnits.length,l:'units'}]);
      html+='<div class="card"><div class="tw"><table class="t"><thead><tr><th>Unit</th><th>Floor</th><th>Type</th><th>Client</th><th>Phone</th><th>Sale Type</th><th>Total Price</th><th>Paid</th><th>Pending</th><th>Last Pay</th><th></th></tr></thead><tbody>';
      stUnits.forEach(function(u){
        var pd=actualPaid(u);var rm=actualPending(u);var d=daysSincePay(u);
        html+='<tr class="cr" onclick="openUD(\''+u.id+'\')">';
        html+='<td style="font-weight:700">'+esc(u.unitNo)+'</td>';
        html+='<td style="font-size:11px">'+esc(u.floorLabel||u.floor)+'</td>';
        html+='<td style="font-size:11px">'+esc(u.type)+'</td>';
        html+='<td><b>'+esc(u.customerName)+'</b></td>';
        html+='<td style="font-size:11px">'+esc(u.phone||'—')+'</td>';
        html+='<td>'+sbadge(u.status)+'</td>';
        html+='<td class="mono">'+fM(u.totalPrice)+'</td>';
        html+='<td class="mono c-g">'+fM(pd)+'</td>';
        html+='<td class="mono" style="color:'+(rm>0?'var(--err)':'var(--ok)')+'">'+fM(rm)+'</td>';
        html+='<td style="font-size:11px;color:'+(d!==null&&d>30?'var(--err)':'var(--t3)')+'">'+(d!==null?d+'d ago':'Never')+'</td>';
        html+='<td><button class="btn btn-gh btn-xs" onclick="event.stopPropagation();printUnitStatement(\''+u.id+'\')">Print</button></td>';
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
    }

  }// end statement

  // ── PROJECT FINANCIAL SUMMARY ──
  else if(_rt==='project'){
    const projs=window._projectsCache||[];
    const allUnits=gunits().filter(u=>u.status!=='Dead');
    if(_rs==='units'){
      html=rptBanner([{v:projs.length,l:'projects'},{v:allUnits.filter(u=>u.status!=='Available').length,l:'sold'},{v:allUnits.filter(u=>u.status==='Available').length,l:'available'}]);
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Project</th><th>Unit</th><th>Floor</th><th>Type</th><th>Status</th><th>Client</th><th class="r">Total Price</th><th class="r">Paid</th><th class="r">Pending</th></tr></thead>
      <tbody>${allUnits.sort((a,b)=>(a.projectId||'').localeCompare(b.projectId||'')||a.unitNo.localeCompare(b.unitNo)).map(u=>{
        const p=projs.find(pr=>pr.id===u.projectId);const pd=actualPaid(u),rm=actualPending(u);
        return `<tr class="cr" onclick="openUD('${u.id}')">
          <td style="font-size:11px;font-weight:600;color:var(--brand)">${esc(p?.name||'—')}</td>
          <td style="font-weight:700">${esc(u.unitNo)}</td>
          <td style="font-size:11px">${esc(u.floorLabel||u.floor)}</td>
          <td style="font-size:11px">${esc(u.type)}</td>
          <td>${sbadge(u.status)}</td>
          <td>${esc(u.customerName||'<span style="color:var(--t3)">—</span>')}</td>
          <td class="r mono">${u.totalPrice?fM(u.totalPrice):'—'}</td>
          <td class="r mono c-g">${u.totalPrice?fM(pd):'—'}</td>
          <td class="r mono" style="color:${rm>0?'var(--err)':'var(--ok)'}">${u.totalPrice?(rm===0?'Paid':fM(rm)):'—'}</td>
        </tr>`;}).join('')}</tbody></table></div></div>`;
    } else {
      const pRows=projs.map(p=>{
        const pu=allUnits.filter(u=>u.projectId===p.id);
        const tv=pu.reduce((s,u)=>s+Number(u.totalPrice||0),0);
        const tp=pu.reduce((s,u)=>s+actualPaid(u),0);
        const rm=pu.reduce((s,u)=>s+actualPending(u),0);
        const pct2=tv?Math.round(tp/tv*100):0;
        return {p,pu,sold:pu.filter(u=>u.status!=='Available').length,avail:pu.filter(u=>u.status==='Available').length,tv,tp,rm,pct2};
      }).filter(r=>r.pu.length>0);
      const tvAll=pRows.reduce((s,r)=>s+r.tv,0),tpAll=pRows.reduce((s,r)=>s+r.tp,0),rmAll=pRows.reduce((s,r)=>s+r.rm,0);
      html=rptBanner([{v:pRows.length,l:'projects'},{v:fM(tpAll),l:'collected',c:'var(--ok)'},{v:fM(rmAll),l:'pending',c:'var(--err)'}]);
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Project</th><th>Location</th><th>Status</th><th class="r">Units</th><th class="r">Sold</th><th class="r">Available</th><th class="r">Total Value</th><th class="r">Collected</th><th class="r">Pending</th><th class="r">Recovery</th></tr></thead>
      <tbody>${pRows.map(r=>`<tr>
        <td style="font-weight:700">${esc(r.p.name)}</td>
        <td style="font-size:11px;color:var(--t3)">${esc(r.p.city||r.p.location||'—')}</td>
        <td>${r.p.status==='active'?'<span class="badge bo">Active</span>':'<span class="badge bi">'+esc(r.p.status)+'</span>'}</td>
        <td class="r">${r.pu.length}</td>
        <td class="r" style="color:var(--ok);font-weight:600">${r.sold}</td>
        <td class="r" style="color:var(--info)">${r.avail}</td>
        <td class="r mono">${fM(r.tv)}</td>
        <td class="r mono c-g" style="font-weight:700">${fM(r.tp)}</td>
        <td class="r mono" style="color:${r.rm>0?'var(--err)':'var(--ok)'}">${r.rm===0?'Paid':fM(r.rm)}</td>
        <td class="r"><span style="font-size:12px;font-weight:700;color:${r.pct2>=80?'var(--ok)':r.pct2>=50?'var(--warn)':'var(--err)'}">${r.pct2}%</span></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700">
        <td colspan="6">TOTAL</td>
        <td class="r mono">${fM(tvAll)}</td><td class="r mono c-g">${fM(tpAll)}</td>
        <td class="r mono" style="color:var(--err)">${fM(rmAll)}</td>
        <td class="r"><span style="font-size:12px;font-weight:700">${tvAll?Math.round(tpAll/tvAll*100):0}%</span></td>
      </tr></tfoot></table></div></div>`;
    }
  }

  // ── FLOOR / TYPE BREAKDOWN ──
  else if(_rt==='floor_type'){
    if(_rs==='type'){
      const ftTypeMap={};const ftAvMap={};
      gunits().filter(u=>u.status!=='Dead').forEach(u=>{const t=u.type||'Unknown';if(!ftTypeMap[t])ftTypeMap[t]={total:0,sold:0,avail:0,tv:0,tp:0};ftTypeMap[t].total++;if(u.status==='Available')ftTypeMap[t].avail++;else{ftTypeMap[t].sold++;ftTypeMap[t].tv+=Number(u.totalPrice||0);ftTypeMap[t].tp+=actualPaid(u);}});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Unit Type</th><th class="r">Total</th><th class="r">Sold</th><th class="r">Available</th><th class="r">Total Value</th><th class="r">Collected</th><th class="r">Pending</th><th class="r">Recovery</th></tr></thead>
      <tbody>${Object.entries(ftTypeMap).sort((a,b)=>b[1].tv-a[1].tv).map(([t,d])=>{const pend=d.tv-d.tp;const p2=d.tv?Math.round(d.tp/d.tv*100):0;
        return `<tr><td style="font-weight:700">${esc(t)}</td><td class="r">${d.total}</td><td class="r" style="color:var(--ok)">${d.sold}</td><td class="r" style="color:var(--info)">${d.avail}</td><td class="r mono">${d.tv?fM(d.tv):'—'}</td><td class="r mono c-g">${d.tp?fM(d.tp):'—'}</td><td class="r mono" style="color:${pend>0?'var(--err)':'var(--ok)'}">${pend>0?fM(pend):'Paid'}</td><td class="r"><span style="font-size:11px;font-weight:700;color:${p2>=80?'var(--ok)':p2>=50?'var(--warn)':'var(--err)'}">${p2}%</span></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    } else {
      const ftFlMap={};
      gunits().filter(u=>u.status!=='Dead').forEach(u=>{const f=u.floorLabel||u.floor||'Unknown';if(!ftFlMap[f])ftFlMap[f]={total:0,sold:0,avail:0,tv:0,tp:0};ftFlMap[f].total++;if(u.status==='Available')ftFlMap[f].avail++;else{ftFlMap[f].sold++;ftFlMap[f].tv+=Number(u.totalPrice||0);ftFlMap[f].tp+=actualPaid(u);}});
      html=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Floor</th><th class="r">Total</th><th class="r">Sold</th><th class="r">Available</th><th class="r">Total Value</th><th class="r">Collected</th><th class="r">Pending</th><th class="r">Recovery</th></tr></thead>
      <tbody>${Object.entries(ftFlMap).map(([f,d])=>{const pend=d.tv-d.tp;const p2=d.tv?Math.round(d.tp/d.tv*100):0;
        return `<tr><td style="font-weight:700">${esc(f)}</td><td class="r">${d.total}</td><td class="r" style="color:var(--ok)">${d.sold}</td><td class="r" style="color:var(--info)">${d.avail}</td><td class="r mono">${d.tv?fM(d.tv):'—'}</td><td class="r mono c-g">${d.tp?fM(d.tp):'—'}</td><td class="r mono" style="color:${pend>0?'var(--err)':'var(--ok)'}">${pend>0?fM(pend):'✅'}</td><td class="r"><span style="font-size:11px;font-weight:700;color:${p2>=80?'var(--ok)':p2>=50?'var(--warn)':'var(--err)'}">${p2}%</span></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    }

  // ── AGENT RECOVERY ──
  } else if(_rt==='agent_recovery'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading agent recovery data…</div>`;
    const {data:arRaw=[]}=await supabase.rpc('list_payments_with_sales_unit', {
      p_company_id: S.cid, p_filters: { date_from: df.fr || null, date_to: df.to || null }
    });
    const arRecs=arRaw.map(r=>({date:r.payment_date||'',amt:Number(r.amount||0),ptype:r.payment_method||'',uid:r.sales?.unit_id||null}));
    const arMap={};
    arRecs.forEach(r=>{const u=gunit(r.uid);const ag=u?.soldBy||'Unassigned';if(!arMap[ag])arMap[ag]={count:0,total:0,cash:0,bank:0,units:new Set()};arMap[ag].count++;arMap[ag].total+=Number(r.amt||0);if(r.ptype==='Cash')arMap[ag].cash+=Number(r.amt||0);else if(r.ptype==='Bank')arMap[ag].bank+=Number(r.amt||0);arMap[ag].units.add(r.uid);});
    const arRows=Object.entries(arMap).sort((a,b)=>b[1].total-a[1].total);
    const arGrandTot=arRows.reduce((s,[,d])=>s+d.total,0);
    html=rptBanner([{v:arRows.length,l:'agents'},{v:fM(arGrandTot),l:'total collected'},{v:arRecs.length,l:'payments'}]);
    if(arRows.length){
      html+=`<div class="card"><div class="tw"><table class="t">
      <thead><tr><th>#</th><th>Agent / Staff</th><th class="r">Payments</th><th class="r">Units</th><th class="r">Cash</th><th class="r">Bank</th><th class="r">Total Collected</th><th class="r">Share</th></tr></thead>
      <tbody>${arRows.map(([ag,d],i)=>{const share=arGrandTot?Math.round(d.total/arGrandTot*100):0;
        return `<tr><td style="font-size:11px;color:var(--t3)">${i+1}</td><td style="font-weight:700">${esc(ag)}</td><td class="r">${d.count}</td><td class="r">${d.units.size}</td><td class="r mono">${d.cash?fM(d.cash):'—'}</td><td class="r mono">${d.bank?fM(d.bank):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(d.total)}</td><td class="r"><span style="font-size:11px;font-weight:700;color:var(--brand)">${share}%</span></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td colspan="6">TOTAL</td><td class="r mono c-g">${fM(arGrandTot)}</td><td class="r">100%</td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></div><div class="et">No recovery data found</div><div class="es">Try a different date range</div></div>`;
    }

  // ── MONTHLY COLLECTION TREND ──
  } else if(_rt==='monthly_trend'){
    ct.innerHTML=`<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading collection trend…</div>`;
    const mt2Filters = { date_from: df.fr || null, date_to: df.to || null, limit: 2000 };
    if (_rs === 'year') { const yr = new Date().getFullYear().toString(); mt2Filters.date_from = yr+'-01-01'; mt2Filters.date_to = yr+'-12-31'; }
    const {data:mtRaw=[]}=await supabase.rpc('list_payments_filtered', { p_company_id: S.cid, p_filters: mt2Filters });
    const mtRecs=mtRaw.map(r=>({date:r.payment_date||'',amt:Number(r.amount||0),ptype:r.payment_method||''}));
    const mtMap={};mtRecs.forEach(r=>{const m=r.date.slice(0,7);if(!mtMap[m])mtMap[m]={count:0,total:0,cash:0,bank:0};mtMap[m].count++;mtMap[m].total+=Number(r.amt||0);if(r.ptype==='Cash')mtMap[m].cash+=Number(r.amt||0);else if(r.ptype==='Bank')mtMap[m].bank+=Number(r.amt||0);});
    const mtMonths=Object.keys(mtMap).sort().reverse();
    const mtMaxT=Math.max(...mtMonths.map(m=>mtMap[m].total),1);
    const mtGrandT=mtMonths.reduce((s,m)=>s+mtMap[m].total,0);
    html=rptBanner([{v:mtMonths.length,l:'months'},{v:fM(mtGrandT),l:'total collected'},{v:mtRecs.length,l:'payments'}]);
    if(mtMonths.length){
      html+=`<div class="card" style="margin-bottom:14px"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Monthly Bar Chart</div>
      <div style="display:flex;flex-direction:column;gap:6px">
      ${mtMonths.slice(0,24).map(m=>{const d=mtMap[m];const w=Math.round(d.total/mtMaxT*100);const [yr,mo]=m.split('-');const mName=new Date(yr,parseInt(mo)-1,1).toLocaleString('en-PK',{month:'short',year:'numeric'});
        return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <div style="min-width:80px;text-align:right;color:var(--t3);font-weight:600">${mName}</div>
        <div style="flex:1;background:var(--hover);border-radius:3px;height:22px;overflow:hidden"><div style="height:100%;width:${w}%;background:var(--brand);border-radius:3px;display:flex;align-items:center;padding-left:8px;color:#fff;font-size:10px;font-weight:700;white-space:nowrap;min-width:30px">${w>15?fM(d.total):''}</div></div>
        <div style="min-width:90px;font-family:monospace;font-weight:700;color:var(--ok)">${fM(d.total)}</div>
        <div style="min-width:30px;font-size:10px;color:var(--t3)">${d.count}x</div>
      </div>`;}).join('')}
      </div></div>
      <div class="card"><div class="tw"><table class="t">
      <thead><tr><th>Month</th><th class="r">Payments</th><th class="r">Cash</th><th class="r">Bank</th><th class="r">Total Collected</th></tr></thead>
      <tbody>${mtMonths.map(m=>{const d=mtMap[m];const [yr,mo]=m.split('-');const mName=new Date(yr,parseInt(mo)-1,1).toLocaleString('en-PK',{month:'long',year:'numeric'});
        return `<tr><td style="font-weight:700">${mName}</td><td class="r">${d.count}</td><td class="r mono">${d.cash?fM(d.cash):'—'}</td><td class="r mono">${d.bank?fM(d.bank):'—'}</td><td class="r mono c-g" style="font-weight:700">${fM(d.total)}</td></tr>`;}).join('')}</tbody>
      <tfoot><tr style="background:var(--hover);font-weight:700"><td>TOTAL</td><td class="r">${mtRecs.length}</td><td colspan="2"></td><td class="r mono c-g">${fM(mtGrandT)}</td></tr></tfoot>
      </table></div></div>`;
    } else {
      html+=`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div><div class="et">No collection data found</div></div>`;
    }

  // ── EXECUTIVE SUMMARY ──
  } else if(_rt==='executive'){
    const exAllU=gunits();const exSoldU=exAllU.filter(u=>u.status!=='Available'&&u.status!=='Dead');const exAvailU=exAllU.filter(u=>u.status==='Available');
    const exToday=td();const exMonthStart=exToday.slice(0,7)+'-01';
    const {data:exRaw=[]}=await supabase.rpc('list_payments_filtered', {
      p_company_id: S.cid, p_filters: { date_from: exMonthStart, date_to: exToday, limit: 500 }
    });
    const exMonthRecs=exRaw.map(r=>({date:r.payment_date||'',amt:Number(r.amount||0)}));
    const exTodayRecs=exMonthRecs.filter(r=>r.date===exToday);
    const exTotVal=exSoldU.reduce((s,u)=>s+Number(u.totalPrice||0),0);
    const exTotColl=exSoldU.reduce((s,u)=>s+actualPaid(u),0);
    const exTotPend=exSoldU.reduce((s,u)=>s+actualPending(u),0);
    const exMonthColl=exMonthRecs.reduce((s,r)=>s+Number(r.amt||0),0);
    const exTodayColl=exTodayRecs.reduce((s,r)=>s+Number(r.amt||0),0);
    const exOverdueU=exSoldU.filter(u=>actualPending(u)>0&&daysSincePay(u)!==null&&daysSincePay(u)>30);
    const exRecovPct=exTotVal?Math.round(exTotColl/exTotVal*100):0;
    const exProjs=window._projectsCache||[];
    const exKpi=(lbl,val,sub,col)=>`<div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;border-left:4px solid ${col}"><div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${lbl}</div><div style="font-size:22px;font-weight:700;color:${col};font-family:DM Mono,monospace">${val}</div><div style="font-size:11px;color:var(--t3);margin-top:3px">${sub}</div></div>`;
    html=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:18px">
      ${exKpi('Total Portfolio',fM(exTotVal),exSoldU.length+' sold units','var(--brand)')}
      ${exKpi('Total Collected',fM(exTotColl),exRecovPct+'% recovery rate','var(--ok)')}
      ${exKpi('Outstanding',fM(exTotPend),exOverdueU.length+' overdue units','var(--err)')}
      ${exKpi('This Month',fM(exMonthColl),exMonthRecs.length+' payments','var(--info)')}
      ${exKpi('Today',fM(exTodayColl),exTodayRecs.length+' payments','var(--warn)')}
      ${exKpi('Projects',exProjs.length,exAvailU.length+' units available','#7C3AED')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Recovery Progress</div>
        <div style="margin-bottom:8px;font-size:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--t3)">Overall Recovery</span><span style="font-weight:700;color:${exRecovPct>=80?'var(--ok)':exRecovPct>=50?'var(--warn)':'var(--err)'}">${exRecovPct}%</span></div><div style="height:8px;background:var(--hover);border-radius:4px;overflow:hidden"><div style="height:100%;width:${exRecovPct}%;background:${exRecovPct>=80?'var(--ok)':exRecovPct>=50?'var(--warn)':'var(--err)'};border-radius:4px;transition:width .4s"></div></div></div>
        <div style="display:flex;gap:12px;font-size:11px;flex-wrap:wrap;margin-top:10px">
          <span style="color:var(--t3)">Collected: <b style="color:var(--ok)">${fM(exTotColl)}</b></span>
          <span style="color:var(--t3)">Pending: <b style="color:var(--err)">${fM(exTotPend)}</b></span>
        </div>
      </div>
      <div class="card"><div style="font-weight:700;font-size:13px;margin-bottom:12px">Unit Summary</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
          <div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--t1)">${exAllU.length}</div><div style="font-size:10px;color:var(--t3)">Total</div></div>
          <div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--ok)">${exSoldU.length}</div><div style="font-size:10px;color:var(--t3)">Sold</div></div>
          <div style="padding:10px;background:var(--canvas);border-radius:var(--rm)"><div style="font-size:22px;font-weight:700;color:var(--info)">${exAvailU.length}</div><div style="font-size:10px;color:var(--t3)">Available</div></div>
        </div>
      </div>
    </div>`;
  }

  _set(html||`<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="et">Select a report type above</div><div class="es">Click Run to generate the report</div></div>`);
  if(_rt==='aging'&&typeof Chart!=='undefined'){
    const agCvs=document.getElementById('rpt-aging-chart');
    if(agCvs){new Chart(agCvs,{type:'bar',data:{labels:['0–30 Days','31–60 Days','61–90 Days','91–180 Days','180+ / Never'],datasets:[{data:[tot0,tot30,tot60,tot90,tot180],backgroundColor:['rgba(245,158,11,0.4)','rgba(234,88,12,0.4)','rgba(239,68,68,0.4)','rgba(127,29,29,0.5)','rgba(69,10,10,0.6)'],borderColor:['#f59e0b','#ea580c','#ef4444','#7f1d1d','#450a0a'],borderWidth:2,borderRadius:4}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'PKR '+fM(c.raw)+' ('+[b0,b30,b60,b90,b180][c.dataIndex].length+' units)'}}},scales:{x:{ticks:{callback:v=>fM(v),color:'#94a3b8',font:{size:10}},grid:{color:'rgba(148,163,184,0.1)'},border:{dash:[4,4]}},y:{grid:{display:false},ticks:{color:'#94a3b8',font:{size:10,weight:600}}}}}});}
  }
  if(_rt==='activity'){
    var actWrap=document.getElementById('act-staff-wrap');
    if(actWrap&&!actWrap.querySelector('input')){
      var su=(window._appUsersCache||[]);
      var aopts=[{v:'all',l:'All Staff'}].concat(su.map(function(u){return {v:u.id,l:u.name||u.fullName};}));
      var csv=ssVal('act-staff-sel')||'all';
      var ass=mkSS('act-staff-sel',aopts,csv,null);
      ass.style.minWidth='160px';
      actWrap.appendChild(ass);
    }
  }
}

// ── EXCEL EXPORT — ALL COLUMNS ──
function expRptExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  if(_rt==='recovery_position'){ return _rpExcel(); }
  const d=td();let ws,wb,fname;const df=getDF();

  if(_rt==='unit'){
    let u=gunits();
    if(_rs==='sold')u=u.filter(x=>x.status!=='Available'&&x.status!=='Dead');
    else if(_rs==='available')u=u.filter(x=>x.status==='Available');
    else if(_rs==='adjustment')u=u.filter(x=>x.status==='Adjustment');
    else if(_rs==='cashsale')u=u.filter(x=>x.status==='CashSale');
    else if(_rs==='overdue'){const od=getOverdueDays();u=u.filter(x=>isOverdue(x,od)&&actualPending(x)>0);}
    const rows=u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),p2=pct(pd,x.totalPrice),dd=daysSincePay(x);
      return {'Unit No':x.unitNo,'Floor':x.floorLabel||x.floor,'Type':x.type,'Area (sqft)':x.area,'Status':x.status,'Customer Name':x.customerName||'','Phone':x.phone||'','Booking No':x.bookingNo||'','Total Price (PKR)':x.totalPrice||0,'Amount Paid (PKR)':pd,'Pending Amount (PKR)':rm,'Recovery %':p2,'Last Payment Date':x.lastPaymentDate||'Never','Days Since Last Pay':dd!==null?dd:'Never','Sold By':x.soldBy||'','Remarks':x.remarks||''};
    });
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Units_${_rs}_${d}.xlsx`;

  } else if(_rt==='client'){
    let u=gunits().filter(x=>x.customerName);
    if(_rs==='defaulters')u=u.filter(x=>actualPending(x)>0).sort((a,b)=>actualPending(b)-actualPending(a));
    if(_rs==='ledger'){
      const cl={};u.forEach(x=>{const k=x.customerName;if(!cl[k])cl[k]={units:[],phone:x.phone};cl[k].units.push(x);});
      const rows=Object.entries(cl).map(([nm,dd])=>{const tv=dd.units.reduce((s,x)=>s+Number(x.totalPrice||0),0);const tp=dd.units.reduce((s,x)=>s+actualPaid(x),0);const rm=dd.units.reduce((s,x)=>s+actualPending(x),0);return {'Client Name':nm,'Phone':dd.phone||'','Units Count':dd.units.length,'Total Value (PKR)':tv,'Total Paid (PKR)':tp,'Pending (PKR)':rm,'Recovery %':tv?Math.round(tp/tv*100):0};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Client_Ledger_${d}.xlsx`;
    } else {
      const rows=u.map(x=>{const pd=actualPaid(x),rm=actualPending(x),dd=daysSincePay(x);return {'Unit No':x.unitNo,'Floor':x.floorLabel||x.floor,'Type':x.type,'Customer Name':x.customerName||'','Phone':x.phone||'','Booking No':x.bookingNo||'','Sale Type':x.status,'Sold By':x.soldBy||'','Total Price (PKR)':x.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Recovery %':x.totalPrice?Math.round(pd/x.totalPrice*100):0,'Last Payment':x.lastPaymentDate||'Never','Days Since Pay':dd!==null?dd:'Never','Remarks':x.remarks||''};});
      ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Clients_${_rs}_${d}.xlsx`;
    }

  } else if(_rt==='recovery'||_rt==='staff'||_rt==='agent_recovery'||_rt==='monthly_trend'||_rt==='executive'){
    // These reports render from Supabase async data — export from the rendered HTML table
    const tbl=document.querySelector('#r-ct table');
    if(!tbl){toast('Run the report first, then export.','warn');return;}
    ws=XLSX.utils.table_to_sheet(tbl);fname=`Nexunova_${_rt}_${_rs}_${d}.xlsx`;

  } else if(_rt==='contacts'){
    const t2=td();let cons=gcons().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    if(_rs==='overdue')cons=cons.filter(c=>c.next_followup_date&&c.next_followup_date<t2).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date));
    else if(_rs==='today')cons=cons.filter(c=>c.next_followup_date===t2);
    else if(_rs==='upcoming')cons=cons.filter(c=>c.next_followup_date&&c.next_followup_date>t2);
    else if(_rs==='willpay')cons=cons.filter(c=>c.response_received==='WillPay');
    const rows=cons.map(c=>{const u=gunit(c.unit_id);return {'Date':c.contact_date,'Unit No':u?.unitNo||'?','Customer Name':u?.customerName||c.client_name||'','Phone':u?.phone||'','Channel':c.channel,'Client Response':c.response_received,'Remarks':c.remarks||'','Follow-up Date':c.next_followup_date||'','Agent':gunm(c.agent_id)};});
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_CallLogs_${_rs}_${d}.xlsx`;

  } else if(_rt==='followup'){
    const t2=td();const allFU=gcons().filter(c=>c.next_followup_date);
    let fuCons=allFU;
    if(_rs==='overdue')fuCons=allFU.filter(c=>c.next_followup_date<t2);
    else if(_rs==='today')fuCons=allFU.filter(c=>c.next_followup_date===t2);
    else if(_rs==='upcoming')fuCons=allFU.filter(c=>c.next_followup_date>t2);
    const rows=fuCons.map(c=>{const u=gunit(c.unit_id);return {'Unit No':u?.unitNo||'?','Customer Name':u?.customerName||c.client_name||'','Phone':u?.phone||'','Channel':c.channel,'Response':c.response_received,'Contact Date':c.contact_date,'Follow-up Date':c.next_followup_date||'','Remarks':c.remarks||'','Agent':gunm(c.agent_id)};});
    ws=XLSX.utils.json_to_sheet(rows);fname=`Nexunova_Followups_${_rs}_${d}.xlsx`;

  } else if(_rt==='activity'){
    var adf=getDF();
    var acx=gcons().sort(function(a,b){return b.contact_date.localeCompare(a.contact_date);});
    if(adf.fr)acx=acx.filter(function(c){return c.contact_date>=adf.fr;});
    if(adf.to)acx=acx.filter(function(c){return c.contact_date<=adf.to;});
    var asv=ssVal('act-staff-sel');if(asv&&asv!=='all')acx=acx.filter(function(c){return c.agent_id===asv;});
    var rows=acx.map(function(c){var u=gunit(c.unit_id);return {'Date':c.contact_date,'Day':new Date(c.contact_date+'T00:00:00').toLocaleDateString('en-PK',{weekday:'long'}),'Agent':gunm(c.agent_id),'Unit No':u?u.unitNo:'?','Floor':u?u.floorLabel||'':'','Client Name':u?u.customerName||c.client_name||'':'','Phone':u?u.phone||'':'','Channel':c.channel,'Client Response':c.response_received,'Remarks':c.remarks||'','Follow-up Date':c.next_followup_date||''};});
    ws=XLSX.utils.json_to_sheet(rows);fname='Nexunova_DailyActivity_'+d+'.xlsx';

  } else if(_rt==='aging'){
    var aOD=getOverdueDays();
    var aUnits=gunits().filter(function(u){return u.status!=='Available'&&u.status!=='Dead'&&actualPending(u)>0;});
    var aMinDays={'all':0,'30':30,'60':60,'90':90,'180':180}[_rs]||0;
    aUnits=aUnits.filter(function(u){var dd=daysSincePay(u);return dd===null||dd>=aMinDays;});
    var aRows=aUnits.map(function(u){var d2=daysSincePay(u);var pd=actualPaid(u);var rm=actualPending(u);var bkt=d2===null||d2>=180?'180+ / Never':d2>=90?'91–180 Days':d2>=60?'61–90 Days':d2>=30?'31–60 Days':'0–30 Days';return {'Unit No':u.unitNo,'Floor':u.floorLabel||u.floor,'Client':u.customerName||'','Phone':u.phone||'','Total Price (PKR)':u.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Last Payment Date':u.lastPaymentDate||'Never','Days Overdue':d2===null?'Never paid':d2,'Bucket':bkt,'Remarks':u.remarks||''};});
    ws=XLSX.utils.json_to_sheet(aRows);fname='Nexunova_AgingReport_'+_rs+'_'+d+'.xlsx';

  } else if(_rt==='statement'){
    var stUnits2=gunits().filter(function(u){return u.customerName&&u.status!=='Available'&&u.status!=='Dead';});
    var stRows=stUnits2.map(function(u){var pd=actualPaid(u);var rm=actualPending(u);var cons2=gcons(u.id);var lastCon=cons2.sort(function(a,b){return (b.created_at||'').localeCompare(a.created_at||'');})[0];return {'Unit No':u.unitNo,'Floor':u.floorLabel||u.floor,'Type':u.type,'Client Name':u.customerName||'','Phone':u.phone||'','Booking No':u.bookingNo||'','Sale Type':u.status,'Total Price (PKR)':u.totalPrice||0,'Amount Paid (PKR)':pd,'Pending (PKR)':rm,'Recovery %':u.totalPrice?Math.round(pd/u.totalPrice*100):0,'Contacts Count':cons2.length,'Last Contact Date':lastCon?lastCon.contact_date:'Never','Last Contact Response':lastCon?lastCon.response_received:'','Sold By':u.soldBy||'','Remarks':u.remarks||''};});
    ws=XLSX.utils.json_to_sheet(stRows);fname='Nexunova_ClientStatement_'+d+'.xlsx';

  } else {
    const tbl=document.querySelector('#r-ct table');
    if(!tbl){toast('No report to export. Click Run first.','warn');return;}
    ws=XLSX.utils.table_to_sheet(tbl);fname=`Nexunova_Report_${_rt}_${d}.xlsx`;
  }

  xlsxWesternNumFmt(ws);
  wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Report');
  XLSX.writeFile(wb,fname);
  toast(`Exported: ${fname}`,'ok');
}

// ── PRINT — opens clean new window, no UI clutter ──
function printRpt(){
  const ct=document.getElementById('r-ct');
  if(!ct||!ct.children.length){toast('Run a report first, then print','warn');return;}
  if(_rt==='recovery_position'){ return _rpPrint(); }
  const rptName=RPT[_rt]?.lbl||'Report';
  const subName=(RPT[_rt]?.subs||[]).find(s=>s.id===_rs)?.lbl||'';
  const frVal=document.getElementById('r-fr')?.value||'';
  const toVal=document.getElementById('r-to')?.value||'';
  let drLabel='All Time';
  if(frVal&&toVal)drLabel=frVal+' to '+toVal;
  else if(frVal)drLabel='From '+frVal;
  else if(toVal)drLabel='Until '+toVal;
  let _rptHtml = '';
  const INK='#1E2D47';
  const css=
    ':root{--ok:#059669;--ok-bg:#dcfce7;--err:#dc2626;--err-bg:#fee2e2;--warn:#d97706;--warn-bg:#fef3c7;--info:#0891b2;--info-bg:#dbeafe;--brand:#'+INK.slice(1)+';--t1:#111;--t2:#333;--t3:#555;--t4:#888;--text:#111;--hover:#f0f4f8;--surface:#f9fafb;--surface2:#f0f4f8;--canvas:#fff;--line:#dde;--line2:#eee}'+
    '*{box-sizing:border-box;margin:0;padding:0}'+
    'body{font-family:"Times New Roman",Georgia,serif;font-size:11px;color:#1a1a1a;padding:16px;background:#fff}'+
    'h1{font-size:18px;margin:0 0 2px;color:#fff;font-family:inherit}'+
    '.hdr{background:'+INK+';color:white;padding:14px 18px;border-radius:6px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.hdr-r{text-align:right;font-size:10px;color:rgba(255,255,255,.75);white-space:nowrap;line-height:1.6}'+
    '.sub{color:#C9A84C;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-top:2px}'+
    // bordered info box (Crystal)
    '.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 16px;padding:10px 14px;background:#fff;border:1px solid #333;border-radius:4px;margin-bottom:12px;font-size:10px}'+
    '.meta-item{display:flex;flex-direction:column;gap:2px}'+
    '.meta-item b{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#555;font-weight:700}'+
    '.card{border:1px solid #333;border-radius:4px;overflow:hidden;margin-bottom:12px}'+
    '.tw{overflow-x:auto}'+
    // ruled serif tables, repeating header, no zebra, #E8E8E8 totals
    'table,.t{width:100%;border-collapse:collapse;margin:0;font-size:9pt;font-variant-numeric:tabular-nums;background:#fff}'+
    'thead{display:table-header-group}'+
    'th{background:#fff;color:#1a1a1a;padding:5px 8px;text-align:left;font-size:9pt;font-weight:700;border:1px solid #333;border-bottom:2.5px double #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    'th.r,td.r,.num{text-align:right;font-variant-numeric:tabular-nums}'+
    'td{padding:5px 8px;border:1px solid #333;vertical-align:top;word-break:break-word}'+
    'tr:nth-child(even) td{background:#fff}'+
    'tfoot td{background:#E8E8E8!important;font-weight:700;border-top:3px double #333}'+
    '.mono,.r.mono{font-family:inherit}'+
    '.c-g{color:#059669!important}.c-r{color:#dc2626!important}'+
    '.badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:99px;font-size:9px;font-weight:700;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '.bo,.ba,.bwp{background:#dcfce7;color:#16a34a}'+
    '.br,.bni{background:#fee2e2;color:#b91c1c}'+
    '.bi,.bin{background:#dbeafe;color:#1e40af}'+
    '.bj,.bdi{background:#fef3c7;color:#92400e}'+
    '.bc{background:#f3e8ff;color:#6d28d9}'+
    '.bd,.bnr{background:#f1f5f9;color:#64748b}'+
    '.empty{text-align:center;padding:30px;color:#888}'+
    '.day-hdr{background:#dcdcdc;color:#1a1a1a;padding:7px 12px;margin-top:14px;font-weight:700;font-size:11px;border:1px solid #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}'+
    '@media print{body{padding:8px}@page{margin:1cm;size:A4 landscape}.hdr,.day-hdr,th,tfoot td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  _rptHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<title>Nexunova '+esc(rptName)+' Report</title>'+
    '<style>'+css+'</style></head><body>'+
    '<div class="hdr">'+
      '<div><h1>Nexunova Recovery Management System</h1><div class="sub">'+esc(rptName)+' Report'+(subName?' — '+esc(subName):'')+'</div></div>'+
      '<div class="hdr-r">Printed: '+new Date().toLocaleString('en-PK',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+'<br>'+esc(S?S.coName||'Nexunova':'Nexunova')+'<br>By: '+esc(S?S.name||'—':'—')+'</div>'+
    '</div>'+
    '<div class="meta">'+
      '<div class="meta-item"><b>Company</b>'+esc(S?S.coName||'Nexunova':'Nexunova')+'</div>'+
      '<div class="meta-item"><b>Report</b>'+esc(rptName)+(subName?' — '+esc(subName):'')+'</div>'+
      '<div class="meta-item"><b>Period</b>'+(drLabel==='All Time'?'All Time (point-in-time)':drLabel)+'</div>'+
      '<div class="meta-item"><b>Generated</b>'+new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'})+' · '+esc(S?S.name||'—':'—')+'</div>'+
    '</div>'+
    ct.innerHTML+
    '</body></html>';
  _printHTML(_rptHtml, 'Nexunova ' + rptName + ' Report');
}

// ── CSV EXPORT ──
function expRpt(){
  const tbl=document.querySelector('#r-ct table');if(!tbl){toast('No report to export','warn');return;}
  const rows=[];tbl.querySelectorAll('tr').forEach(tr=>{const r=[];tr.querySelectorAll('th,td').forEach(td=>r.push(td.innerText.replace(/\n/g,' ').trim()));rows.push(r);});
  const csv=rows.map(r=>r.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download=`Nexunova_${_rt}_${td()}.csv`;a.click();
  toast('Exported to CSV','ok');
}

// \u2550\u2550 RECOVERY POSITION (GRAND SUMMARY) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Backend: get_recovery_position(p_company_id, p_project_id, p_from_date, p_to_date) \u2192
// { rows, officer_summary, totals }. A4 LANDSCAPE grand summary grouped by
// category, with per-section subtotals, a grand-total row (RPC totals preferred,
// missing keys computed client-side + console.warn on disagreement), 7 summary
// cards and an officer recovery block. Reuses fM (en-IN), fD, _lh/_pCSS/_sigBlock
// (Crystal letterhead) for print and SheetJS for Excel.
const RP_COLS=[
  {k:'_sno',               l:'S#',               t:'sno',   w:34},
  {k:'client_code',        l:'Client Code',      t:'text',  w:84},
  {k:'client_name',        l:'Client Name',      t:'name',  w:170},
  {k:'floor_name',         l:'Floor',            t:'text',  w:84},
  {k:'unit_no',            l:'Unit',             t:'text',  w:66},
  {k:'reg_date',           l:'Reg. Date',        t:'date',  w:88},
  {k:'area',               l:'Area',             t:'num',   w:62},
  {k:'unit_rate',          l:'Rate',             t:'num',   w:68},
  {k:'total_price',        l:'Total Price',      t:'money', sub:1, w:98},
  {k:'discount',           l:'Discount',         t:'money', sub:1, w:80},
  {k:'net_price',          l:'Net Price',        t:'money', sub:1, w:98},
  {k:'dp_total',           l:'DP Total',         t:'money', sub:1, w:92},
  {k:'dp_received',        l:'DP Recd',          t:'money', sub:1, w:90},
  {k:'dp_remaining',       l:'DP Remaining',     t:'money', sub:1, w:96},
  {k:'old_outstanding',    l:'Old Outstanding',  t:'money', sub:1, w:104},
  {k:'recd_old',           l:'Recd\u2192Old (Dead)',  t:'money', sub:1, w:108},
  {k:'outstanding_old_net',l:'Outstg Old Net',   t:'money', sub:1, w:100},
  {k:'month_installment',  l:'Month Instalment', t:'money', sub:1, w:104},
  {k:'recd_current',       l:'Recd\u2192Current',     t:'money', sub:1, w:100},
  {k:'net_outstanding',    l:'Net Outstanding',  t:'money', sub:1, w:104},
  {k:'last_payment_date',  l:'Last Pay',         t:'lastpay', w:112},
  {k:'pdc_in_hand',        l:'PDC in Hand',      t:'money', sub:1, w:94},
  {k:'paid_pct',           l:'Paid %',           t:'pct',   w:64},
  {k:'flag_legal',         l:'\u2696',                t:'flag',  w:38},
];
// Total fixed width \u2248 2138px \u2192 horizontal scroll on screen; print uses proportional %.
function _rpColgroup(mode){
  var tot=RP_COLS.reduce(function(s,c){return s+(c.w||60);},0);
  return '<colgroup>'+RP_COLS.map(function(c){
    var w=(c.w||60);
    return '<col style="width:'+(mode==='print'?((w/tot*100).toFixed(2)+'%'):(w+'px'))+'">';
  }).join('')+'</colgroup>';
}
// Scoped screen stylesheet \u2014 classic Crystal-Reports accounting look.
// Everything under .rp-report so nothing leaks outside this report.
function _rpInjectStyle(){
  if(document.getElementById('rp-screen-style'))return;
  var s=document.createElement('style');s.id='rp-screen-style';
  s.textContent=[
    // serif body for the whole report (figures tabular-aligned)
    '.rp-report{font-family:"Times New Roman",Georgia,serif;color:#1a1a1a}',
    '.rp-report .rp-title{text-align:center;font-weight:700;font-size:16px;text-decoration:underline;letter-spacing:.3px;margin:2px 0 12px}',
    // bordered info box (Label : Value pairs, two columns)
    '.rp-report .rp-infobox{border:1px solid #333;border-radius:4px;padding:10px 14px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:4px 28px}',
    '.rp-report .rp-info-row{display:flex;gap:8px;font-size:12.5px}',
    '.rp-report .rp-info-row .lbl{font-weight:700;min-width:104px}',
    '.rp-report .rp-info-row .val{font-weight:600}',
    // compact summary chips (kept on top, serif)
    '.rp-report .rp-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
    '.rp-report .rp-chip{flex:1;min-width:120px;border:1px solid #333;border-radius:4px;padding:8px 11px}',
    '.rp-report .rp-chip .l{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#444}',
    '.rp-report .rp-chip .v{font-size:15px;font-weight:700;margin-top:3px}',
    // ruled table \u2014 full borders, no zebra, white rows
    '.rp-report .rp-scroll{overflow:auto;max-height:68vh;border:1px solid #333}',
    '.rp-report table.rp-tbl{border-collapse:collapse;table-layout:fixed;width:100%;background:#fff;font-size:11px;font-variant-numeric:tabular-nums}',
    '.rp-report .rp-tbl th,.rp-report .rp-tbl td{border:1px solid #333;padding:5px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;vertical-align:middle}',
    '.rp-report .rp-tbl thead th{position:sticky;top:0;z-index:2;background:#fff;color:#1a1a1a;font-size:11px;font-weight:700;text-align:left;border-bottom:3px double #333;padding-top:7px;padding-bottom:7px}',
    '.rp-report .rp-tbl th.num,.rp-report .rp-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '.rp-report .rp-tbl td.cname{font-weight:700}',
    '.rp-report .rp-tbl td.flag{text-align:center;overflow:visible}',
    // section header / subtotal / grand-total shaded rows (print-safe grays)
    '.rp-report .rp-tbl tbody tr.rp-sec td{background:#dcdcdc;font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:normal}',
    '.rp-report .rp-tbl tbody tr.rp-sub td{background:#E8E8E8;font-weight:700}',
    '.rp-report .rp-tbl tbody tr.rp-grand td{background:#cfcfcf;font-weight:700;border-top:3px double #333}',
    // 90+ days / never \u2014 pale print-safe red (after the gray rules so it wins on data rows)
    '.rp-report .rp-tbl tbody tr.rp-late td{background:#fbeaea}',
    '.rp-report .rp-sno{font-size:11px}',
    // officer ruled table + block titles
    '.rp-report .rp-blocktitle{font-size:13px;font-weight:700;margin:18px 0 8px}',
    '.rp-report table.rp-off-tbl{border-collapse:collapse;width:100%;max-width:560px;font-size:12px;background:#fff}',
    '.rp-report .rp-off-tbl th,.rp-report .rp-off-tbl td{border:1px solid #333;padding:5px 9px}',
    '.rp-report .rp-off-tbl thead th{background:#E8E8E8;font-weight:700;text-align:left}',
    '.rp-report .rp-off-tbl th.num,.rp-report .rp-off-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '.rp-report .rp-off-tbl tr.rp-sub td{background:#E8E8E8;font-weight:700}',
    // bottom Summary box (Label : underlined-value rows)
    '.rp-report .rp-summary{margin-top:18px;border:1px solid #333;border-radius:6px;padding:12px 16px;max-width:520px}',
    '.rp-report .rp-summary h4{font-size:13px;font-weight:700;text-decoration:underline;margin:0 0 8px;text-align:center}',
    '.rp-report .rp-sum-row{display:flex;justify-content:space-between;gap:16px;padding:4px 0;border-bottom:1px dotted #bbb;font-size:12.5px}',
    '.rp-report .rp-sum-row:last-child{border-bottom:0}',
    '.rp-report .rp-sum-row .lbl{font-weight:700}',
    '.rp-report .rp-sum-row .val{font-weight:700;text-decoration:underline;font-variant-numeric:tabular-nums}'
  ].join('');
  document.head.appendChild(s);
}

// ── Shared Crystal accounting style for ALL hub reports ──────────────────────
// Scoped to the report viewer container only (#r-ct.crystal-rpt) so nothing
// leaks to non-report pages. Restyles the generic report markup every runRpt
// branch emits: rptBanner strip → bordered info box; .card/.t tables → serif,
// fully-ruled, no zebra; tfoot/total rows → #E8E8E8. Single source of truth for
// the in-app report tables (Recovery Position keeps its own .rp-report sheet,
// same design tokens). Injected once.
// _injectCrystalStyle() is the single shared Crystal stylesheet injector — defined
// in js/helpers.js (loaded first) so BOTH reports.js and ledgers.js use one source.

// First day of the current month, ISO (local) — default FROM bound.
function _rpMonthStart(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';}

// Project + FROM/TO controls (replaces the period bar for this report).
function _rpControlsBar(){
  var projs=(typeof gprojects==='function'?gprojects():[]).slice()
    .sort(function(a,b){return String(a.name||a.projectName||'').localeCompare(String(b.name||b.projectName||''));});
  var opts='<option value="">All Projects</option>'+projs.map(function(p){
    return '<option value="'+p.id+'">'+esc(p.name||p.projectName||'Project')+'</option>';}).join('');
  var c='font:500 12px/1 inherit;padding:6px 10px;border-radius:7px;border:1px solid var(--line);background:var(--canvas);color:var(--text)';
  return '<div class="rpt-fbar">'
    +'<span class="rpt-stabs-lbl">Project</span>'
    +'<select id="rp-proj" style="'+c+'" onchange="runRpt()">'+opts+'</select>'
    +'<span class="rpt-stabs-lbl" style="margin-left:12px">From</span>'
    +'<input type="date" id="rp-from" value="'+_rpMonthStart()+'" style="'+c+'" onchange="runRpt()">'
    +'<span class="rpt-stabs-lbl" style="margin-left:8px">To</span>'
    +'<input type="date" id="rp-to" value="'+td()+'" style="'+c+'" onchange="runRpt()">'
  +'</div>';
}

function _rpDaysAgo(lastISO,asofISO){
  if(!lastISO)return null;
  try{var a=new Date(asofISO+'T00:00:00'),l=new Date(lastISO+'T00:00:00');return Math.round((a-l)/86400000);}catch(e){return null;}
}
function _rpAsofLbl(asofISO){try{var d=new Date(asofISO+'T00:00:00');var p=function(n){return String(n).padStart(2,'0');};return p(d.getDate())+'-'+p(d.getMonth()+1)+'-'+d.getFullYear();}catch(e){return asofISO;}}

// Grand-total value: prefer RPC totals; compute client-side for keys RPC omits; warn on mismatch.
function _rpGrand(data,totals,k){
  var comp=data.reduce(function(s,r){return s+Number(r[k]||0);},0);
  if(totals&&totals[k]!=null){
    if(Math.round(Number(totals[k]))!==Math.round(comp))
      console.warn('[recovery_position] grand-total mismatch for "'+k+'": RPC='+totals[k]+' computed='+comp);
    return Number(totals[k]);
  }
  return comp;
}

function _rpEmpty(t,s){
  return '<div class="empty"><div class="ei"><svg width="32" height="32" fill="none" stroke="#D1D5DB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="et">'+esc(t)+'</div>'+(s?'<div class="es">'+esc(s)+'</div>':'')+'</div>';
}

// Group rows by category_name, preserving the RPC's category/floor/unit order.
function _rpGroups(rows){
  var groups=[],idx={};
  rows.forEach(function(r){var cat=r.category_name||'Uncategorized';if(idx[cat]==null){idx[cat]=groups.length;groups.push({cat:cat,items:[]});}groups[idx[cat]].items.push(r);});
  return groups;
}

async function _rpRun(){
  var ct=document.getElementById('r-ct');if(!ct)return;
  var gid=_rptGenId;
  var proj=(document.getElementById('rp-proj')||{}).value||'';
  var from=(document.getElementById('rp-from')||{}).value||_rpMonthStart();
  var to  =(document.getElementById('rp-to')||{}).value||td();
  ct.innerHTML='<div style="text-align:center;padding:40px;color:var(--t3);font-size:13px"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="animation:rops-spin 0.8s linear infinite;vertical-align:middle;margin-right:6px"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>Loading recovery position\u2026</div>';
  var res=null,err=null;
  try{ var r=await supabase.rpc('get_recovery_position',{p_company_id:S.cid,p_project_id:proj||null,p_from_date:from,p_to_date:to}); err=r.error; res=r.data; }
  catch(e){ err=e; }
  if(_rptGenId!==gid)return;
  if(err){
    if(typeof toast==='function')toast('Could not load Recovery Position: '+(err.message||err),'err');
    ct.innerHTML=_rpEmpty('Could not load report',(err&&err.message)||String(err));
    window._rpData=null;
    return;
  }
  res=res||{};
  var projName=proj?(((typeof gproject==='function'?gproject(proj):null)||{}).name||''):'';
  window._rpData={res:res,from:from,to:to,projName:projName,fromLbl:_rpAsofLbl(from),toLbl:_rpAsofLbl(to),periodLbl:_rpAsofLbl(from)+' to '+_rpAsofLbl(to)};
  ct.innerHTML=_rpRender(res,from,to,projName);
}

// Screen cell renderer.
function _rpCell(r,c,sno,days){
  if(c.t==='sno')   return '<td class="rp-sno">'+sno+'</td>';
  if(c.t==='money') return '<td class="num">'+fM(Number(r[c.k]||0))+'</td>';
  if(c.t==='num')   return '<td class="num">'+(r[c.k]!=null&&r[c.k]!==''?Number(r[c.k]).toLocaleString('en-US'):'\u2014')+'</td>';
  if(c.t==='pct')   return '<td class="num">'+(r[c.k]!=null?Number(r[c.k]).toFixed(1)+'%':'\u2014')+'</td>';
  if(c.t==='date')  return '<td>'+(r[c.k]?fD(r[c.k]):'\u2014')+'</td>';
  if(c.t==='lastpay'){
    if(!r[c.k])return '<td style="color:#dc2626;font-weight:600">Never</td>';
    return '<td>'+fD(r[c.k])+' <span style="color:var(--t4)">('+(days!=null?days+'d':'\u2014')+')</span></td>';
  }
  if(c.t==='flag')  return '<td class="flag">'+(r[c.k]?'<span title="Open legal case / escalation">\u2696\uFE0F</span>':'')+'</td>';
  if(c.t==='name')  return '<td class="cname" title="'+esc(r[c.k]!=null?String(r[c.k]):'')+'">'+esc(r[c.k]!=null?String(r[c.k]):'\u2014')+'</td>';
  return '<td title="'+esc(r[c.k]!=null?String(r[c.k]):'')+'">'+esc(r[c.k]!=null?String(r[c.k]):'\u2014')+'</td>';
}

function _rpRender(res,from,to,projName){
  var rows=Array.isArray(res.rows)?res.rows:[];
  var totals=res.totals||{};
  var officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  var periodLbl=_rpAsofLbl(from)+' to '+_rpAsofLbl(to);
  var ncols=RP_COLS.length;

  _rpInjectStyle();
  var g=function(k){return _rpGrand(rows,totals,k);};

  // Centered underlined title + bordered info box (Label : Value pairs)
  var infoRow=function(l,v){return '<div class="rp-info-row"><span class="lbl">'+l+' :</span><span class="val">'+v+'</span></div>';};
  var header='<div class="rp-title">Recovery Position \u2014 Grand Summary</div>'
    +'<div class="rp-infobox">'
      +infoRow('Company',       esc(S?S.coName||'\u2014':'\u2014'))
      +infoRow('Project',       esc(projName||'All Projects'))
      +infoRow('Period',        esc(periodLbl))
      +infoRow('Generated',     esc(_rpAsofLbl(td())))
      +infoRow('Total Clients', String(rows.length))
    +'</div>';

  if(!rows.length)
    return '<div class="rp-report">'+header+_rpEmpty('No active sales for this selection','Try a different project or date range.')+'</div>';

  // Compact summary chips on top (serif, bordered) \u2014 same figures as the bottom box
  var chip=function(l,v){return '<div class="rp-chip"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>';};
  var chips='<div class="rp-chips">'
    +chip('Old Outstanding',fM(g('old_outstanding')))
    +chip('DP Remaining',fM(g('dp_remaining')))
    +chip('Month Due',fM(g('month_installment')))
    +chip('Dead Recovery',fM(g('recd_old')))
    +chip('Current Received',fM(g('recd_current')))
    +chip('Net Position',fM(g('net_outstanding')))
    +chip('Recovery %',(totals.recovery_pct!=null?Number(totals.recovery_pct).toFixed(1):'0.0')+'%')
  +'</div>';

  var head='<thead><tr>'+RP_COLS.map(function(c){
    var cl=(c.t==='money'||c.t==='num'||c.t==='pct')?' class="num"':(c.t==='flag'?' class="flag"':'');
    return '<th'+cl+'>'+c.l+'</th>';}).join('')+'</tr></thead>';

  var sno=0,body='';
  _rpGroups(rows).forEach(function(grp){
    body+='<tr class="rp-sec"><td colspan="'+ncols+'">'+esc(grp.cat)+' \u00B7 '+grp.items.length+' unit'+(grp.items.length!==1?'s':'')+'</td></tr>';
    grp.items.forEach(function(r){
      sno++;
      var days=_rpDaysAgo(r.last_payment_date,to);
      var cls=(days===null||days>90)?' class="rp-late"':'';
      body+='<tr'+cls+'>'+RP_COLS.map(function(c){return _rpCell(r,c,sno,days);}).join('')+'</tr>';
    });
    body+='<tr class="rp-sub">'+RP_COLS.map(function(c,i){
      if(i===0)return '<td colspan="2">'+esc(grp.cat)+' \u2014 Subtotal</td>';
      if(i===1)return '';
      if(c.sub)return '<td class="num">'+fM(grp.items.reduce(function(s,r){return s+Number(r[c.k]||0);},0))+'</td>';
      return '<td></td>';
    }).join('')+'</tr>';
  });
  body+='<tr class="rp-grand">'+RP_COLS.map(function(c,i){
    if(i===0)return '<td colspan="2">GRAND TOTAL \u00B7 '+rows.length+' units</td>';
    if(i===1)return '';
    if(c.sub)return '<td class="num">'+fM(g(c.k))+'</td>';
    return '<td></td>';
  }).join('')+'</tr>';

  var table='<div class="rp-scroll"><table class="rp-tbl">'+_rpColgroup('screen')+head+'<tbody>'+body+'</tbody></table></div>';

  // Officer Recovery Summary \u2014 ruled table
  var offTot={d:0,c:0};
  var offRows=officers.map(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);offTot.d+=d;offTot.c+=c;
    return '<tr><td class="cname">'+esc(o.officer_name||'\u2014')+'</td><td class="num">'+fM(d)+'</td><td class="num">'+fM(c)+'</td><td class="num">'+fM(d+c)+'</td></tr>';}).join('');
  var officerBlock='<div class="rp-blocktitle">Officer Recovery Summary \u2014 '+esc(periodLbl)+'</div>';
  officerBlock+=officers.length
    ? '<table class="rp-off-tbl"><thead><tr><th>Officer</th><th class="num">Dead Recovery</th><th class="num">Current Recovery</th><th class="num">Total</th></tr></thead><tbody>'+offRows
      +'<tr class="rp-sub"><td>TOTAL</td><td class="num">'+fM(offTot.d)+'</td><td class="num">'+fM(offTot.c)+'</td><td class="num">'+fM(offTot.d+offTot.c)+'</td></tr></tbody></table>'
    : '<div style="font-size:12px;padding:6px 0">No officer recovery recorded for this period.</div>';

  // Bottom Summary box (Label : underlined-value rows)
  var sumRow=function(l,v){return '<div class="rp-sum-row"><span class="lbl">'+l+'</span><span class="val">'+v+'</span></div>';};
  var summary='<div class="rp-summary"><h4>Summary</h4>'
    +sumRow('Old Outstanding',fM(g('old_outstanding')))
    +sumRow('DP Remaining',fM(g('dp_remaining')))
    +sumRow('Month Due',fM(g('month_installment')))
    +sumRow('Dead Recovery',fM(g('recd_old')))
    +sumRow('Current Received',fM(g('recd_current')))
    +sumRow('Net Position',fM(g('net_outstanding')))
    +sumRow('Recovery %',(totals.recovery_pct!=null?Number(totals.recovery_pct).toFixed(1):'0.0')+'%')
  +'</div>';

  return '<div class="rp-report">'+header+chips+table+officerBlock+summary+'</div>';
}

// \u2500\u2500 PRINT \u2014 Crystal letterhead, A4 landscape, signature block \u2500\u2500
function _rpPrint(){
  var D=window._rpData; if(!D||!D.res){toast('Run the report first, then print','warn');return;}
  var res=D.res, rows=Array.isArray(res.rows)?res.rows:[], totals=res.totals||{}, officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  var ncols=RP_COLS.length, g=function(k){return _rpGrand(rows,totals,k);};
  var pc=function(r,c,sno,days){
    if(c.t==='sno')   return '<td>'+sno+'</td>';
    if(c.t==='money') return '<td class="num">'+fM(Number(r[c.k]||0))+'</td>';
    if(c.t==='num')   return '<td class="num">'+(r[c.k]!=null&&r[c.k]!==''?Number(r[c.k]).toLocaleString('en-US'):'\u2014')+'</td>';
    if(c.t==='pct')   return '<td class="num">'+(r[c.k]!=null?Number(r[c.k]).toFixed(1)+'%':'\u2014')+'</td>';
    if(c.t==='date')  return '<td>'+(r[c.k]?fD(r[c.k]):'\u2014')+'</td>';
    if(c.t==='lastpay')return '<td>'+(r[c.k]?fD(r[c.k])+' ('+(days!=null?days+'d':'\u2014')+')':'Never')+'</td>';
    if(c.t==='flag')  return '<td style="text-align:center">'+(r[c.k]?'\u2696':'')+'</td>';
    if(c.t==='name')  return '<td class="cname" title="'+esc(r[c.k]!=null?String(r[c.k]):'')+'">'+esc(r[c.k]!=null?String(r[c.k]):'\u2014')+'</td>';
    return '<td>'+esc(r[c.k]!=null?String(r[c.k]):'\u2014')+'</td>';
  };
  var head='<tr>'+RP_COLS.map(function(c){var cl=(c.t==='money'||c.t==='num'||c.t==='pct')?' class="num"':'';return '<th'+cl+'>'+c.l+'</th>';}).join('')+'</tr>';
  var sno=0,bodyRows='';
  _rpGroups(rows).forEach(function(grp){
    bodyRows+='<tr class="rp-sec"><td colspan="'+ncols+'">'+esc(grp.cat)+' \u00B7 '+grp.items.length+' unit'+(grp.items.length!==1?'s':'')+'</td></tr>';
    grp.items.forEach(function(r){sno++;var days=_rpDaysAgo(r.last_payment_date,D.to);var cls=(days===null||days>90)?' class="rp-late"':'';bodyRows+='<tr'+cls+'>'+RP_COLS.map(function(c){return pc(r,c,sno,days);}).join('')+'</tr>';});
    bodyRows+='<tr class="rp-sub">'+RP_COLS.map(function(c,i){if(i===0)return '<td colspan="2">'+esc(grp.cat)+' \u2014 Subtotal</td>';if(i===1)return '';if(c.sub)return '<td class="num">'+fM(grp.items.reduce(function(s,r){return s+Number(r[c.k]||0);},0))+'</td>';return '<td></td>';}).join('')+'</tr>';
  });
  bodyRows+='<tr class="rp-grand">'+RP_COLS.map(function(c,i){if(i===0)return '<td colspan="2">GRAND TOTAL \u00B7 '+rows.length+' units</td>';if(i===1)return '';if(c.sub)return '<td class="num">'+fM(g(c.k))+'</td>';return '<td></td>';}).join('')+'</tr>';

  var offTot={d:0,c:0};
  var offRows=officers.map(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);offTot.d+=d;offTot.c+=c;return '<tr><td class="cname">'+esc(o.officer_name||'\u2014')+'</td><td class="num">'+fM(d)+'</td><td class="num">'+fM(c)+'</td><td class="num">'+fM(d+c)+'</td></tr>';}).join('');

  // Header info box (Label : Value)
  var infoRow=function(l,v){return '<div class="rp-info-row"><span class="lbl">'+l+' :</span> <span class="val">'+v+'</span></div>';};
  var infoBox='<div class="rp-infobox">'
    +infoRow('Company',esc(S?S.coName||'\u2014':'\u2014'))
    +infoRow('Project',esc(D.projName||'All Projects'))
    +infoRow('Period',esc(D.periodLbl||((D.fromLbl||'')+' to '+(D.toLbl||''))))
    +infoRow('Generated',esc(_rpAsofLbl(td())))
    +infoRow('Total Clients',String(rows.length))
  +'</div>';

  // Bottom Summary box (Label : underlined-value)
  var sumRow=function(l,v){return '<div class="rp-sum-row"><span class="lbl">'+l+'</span><span class="val">'+v+'</span></div>';};
  var summaryBox='<div class="rp-summary"><h4>Summary</h4>'
    +sumRow('Old Outstanding',fM(g('old_outstanding')))
    +sumRow('DP Remaining',fM(g('dp_remaining')))
    +sumRow('Month Due',fM(g('month_installment')))
    +sumRow('Dead Recovery',fM(g('recd_old')))
    +sumRow('Current Received',fM(g('recd_current')))
    +sumRow('Net Position',fM(g('net_outstanding')))
    +sumRow('Recovery %',(totals.recovery_pct!=null?Number(totals.recovery_pct).toFixed(1):'0.0')+'%')
  +'</div>';

  // Print CSS \u2014 serif body, fully-ruled cells, double-underlined header, shaded totals
  var extra='body{font-family:"Times New Roman",Georgia,serif;color:#1a1a1a}'
    +'.rp-doc-title{text-align:center;font-weight:700;font-size:14px;text-decoration:underline;margin:4px 0 10px}'
    +'.rp-infobox{border:1px solid #333;border-radius:3px;padding:8px 12px;margin:0 0 10px;display:grid;grid-template-columns:1fr 1fr;gap:2px 24px}'
    +'.rp-info-row{font-size:10px}.rp-info-row .lbl{font-weight:700;display:inline-block;min-width:88px}.rp-info-row .val{font-weight:600}'
    +'.rp-tbl{font-size:9px;border-collapse:collapse;table-layout:fixed;width:100%;font-variant-numeric:tabular-nums;background:#fff}'
    +'.rp-tbl thead{display:table-header-group}'
    +'.rp-tbl th,.rp-tbl td{border:1px solid #333;padding:3px 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
    +'.rp-tbl thead th{background:#fff;color:#1a1a1a;font-size:9px;font-weight:700;text-align:left;border-bottom:2.5px double #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-tbl th.num,.rp-tbl td.num,.r{text-align:right;font-variant-numeric:tabular-nums}'
    +'.rp-tbl td.cname{font-weight:700}'
    +'.rp-sec td{background:#dcdcdc;font-weight:700;text-transform:uppercase;letter-spacing:.4px;white-space:normal;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-sub td{background:#E8E8E8;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-grand td{background:#cfcfcf;font-weight:700;border-top:3px double #333;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-late td{background:#fbeaea;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-off-tbl{border-collapse:collapse;max-width:460px;font-size:9.5px;background:#fff}'
    +'.rp-off-tbl th,.rp-off-tbl td{border:1px solid #333;padding:3px 7px}'
    +'.rp-off-tbl thead th{background:#E8E8E8;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    +'.rp-off-tbl tr.rp-sub td{background:#E8E8E8;font-weight:700}'
    +'.rp-summary{border:1px solid #333;border-radius:5px;padding:8px 12px;max-width:360px;margin-top:12px}'
    +'.rp-summary h4{font-size:11px;font-weight:700;text-decoration:underline;text-align:center;margin:0 0 6px}'
    +'.rp-sum-row{display:flex;justify-content:space-between;gap:14px;padding:2px 0;border-bottom:1px dotted #aaa;font-size:10px}'
    +'.rp-sum-row .lbl{font-weight:700}.rp-sum-row .val{font-weight:700;text-decoration:underline}';

  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recovery Position (Grand Summary)</title><style>'+_pCSS('A4 landscape')+extra+'</style></head><body>'
    +_lh('Recovery Position (Grand Summary)', D.projName||'All Projects')
    +'<div class="body">'
    +'<div class="rp-doc-title">Recovery Position \u2014 Grand Summary</div>'+infoBox
    +'<table class="rp-tbl">'+_rpColgroup('print')+'<thead>'+head+'</thead><tbody>'+(rows.length?bodyRows:'<tr><td colspan="'+ncols+'" style="text-align:center;padding:20px;color:#888">No active sales for this selection</td></tr>')+'</tbody></table>'
    +'<div class="sec-title">Officer Recovery Summary \u2014 '+esc(D.periodLbl||'')+'</div>'
    +'<table class="rp-off-tbl">'+(officers.length?('<thead><tr><th>Officer</th><th class="num">Dead Recovery</th><th class="num">Current Recovery</th><th class="num">Total</th></tr></thead><tbody>'+offRows+'<tr class="rp-sub"><td>TOTAL</td><td class="num">'+fM(offTot.d)+'</td><td class="num">'+fM(offTot.c)+'</td><td class="num">'+fM(offTot.d+offTot.c)+'</td></tr></tbody>'):'<tbody><tr><td style="padding:8px;color:#888">No officer recovery recorded for this period.</td></tr></tbody>')+'</table>'
    +summaryBox
    +_sigBlock()
    +'</div></body></html>';
  _printHTML(html,'Recovery Position (Grand Summary)');
}

// \u2500\u2500 EXCEL \u2014 sections as blocks + subtotals + grand total + officer block, one sheet \u2500\u2500
function _rpExcel(){
  if(typeof XLSX==='undefined'){toast('Excel library not loaded','warn');return;}
  var D=window._rpData; if(!D||!D.res){toast('Run the report first, then export','warn');return;}
  var res=D.res, rows=Array.isArray(res.rows)?res.rows:[], totals=res.totals||{}, officers=Array.isArray(res.officer_summary)?res.officer_summary:[];
  var g=function(k){return _rpGrand(rows,totals,k);};
  var labels=RP_COLS.map(function(c){return c.l;});
  var val=function(r,c,sno){
    if(c.t==='sno')return sno;
    if(c.t==='money'||c.t==='num')return Number(r[c.k]||0);
    if(c.t==='pct')return r[c.k]!=null?Number(r[c.k]):'';
    if(c.t==='date')return r[c.k]?fD(r[c.k]):'';
    if(c.t==='lastpay')return r[c.k]?fD(r[c.k]):'Never';
    if(c.t==='flag')return r[c.k]?'Yes':'';
    return r[c.k]!=null?String(r[c.k]):'';
  };
  var aoa=[];
  aoa.push(['Recovery Position \u2014 Grand Summary']);
  aoa.push(['Company',S?S.coName||'':'','Project',D.projName||'All Projects','Period',D.periodLbl||((D.fromLbl||'')+' to '+(D.toLbl||''))]);
  aoa.push([]);
  aoa.push(labels);
  var sno=0;
  _rpGroups(rows).forEach(function(grp){
    aoa.push([grp.cat+' ('+grp.items.length+')']);
    grp.items.forEach(function(r){sno++;aoa.push(RP_COLS.map(function(c){return val(r,c,sno);}));});
    aoa.push(RP_COLS.map(function(c,i){if(i===0)return grp.cat+' \u2014 Subtotal';if(c.sub)return grp.items.reduce(function(s,r){return s+Number(r[c.k]||0);},0);return '';}));
  });
  aoa.push(RP_COLS.map(function(c,i){if(i===0)return 'GRAND TOTAL';if(c.sub)return g(c.k);return '';}));
  aoa.push([]);aoa.push([]);
  aoa.push(['Officer Recovery Summary \u2014 '+(D.periodLbl||'')]);
  aoa.push(['Officer','Dead Recovery','Current Recovery','Total']);
  var od=0,oc=0;
  officers.forEach(function(o){var d=Number(o.dead_recovery_total||0),c=Number(o.current_recovery_total||0);od+=d;oc+=c;aoa.push([o.officer_name||'\u2014',d,c,d+c]);});
  aoa.push(['TOTAL',od,oc,od+oc]);
  var ws=XLSX.utils.aoa_to_sheet(aoa);
  xlsxWesternNumFmt(ws);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Recovery Position');
  var fname='Nexunova_RecoveryPosition_'+(D.from||td())+'_'+(D.to||td())+'.xlsx';
  XLSX.writeFile(wb,fname);
  if(typeof toast==='function')toast('Exported: '+fname,'ok');
}



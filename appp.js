/***** STATE *****/
const state = {
  authUser: null,
  role: 'lab',            // 'lab' | 'central'
  labId: 'LAB-E203',
  route: '#/dashboard',
  data: {
    itemTypes: [
      { id: 'type-LAP', name: 'Laptop' },
      { id: 'type-OSC', name: 'Oscilloscope' },
      { id: 'type-PSU', name: 'Power Supply' }
    ],
    items: [], loans: [], labRequests: [], shipments: [],  shipmentIssues: [],   // ✅ NEW
    labs: []
  }
};

// Thêm sau khối const state = { ... } hiện có:
state.importBatch = {
  step: 1,           // bước đang ở trong wizard import
  rawLines: [],      // dữ liệu đọc từ Excel, mỗi dòng = 1 asset group
  expandedItems: []  // sau này step 2 sẽ bung từng thiết bị lẻ
};

state.data.activities = state.data.activities || [];
state.data.repairs = state.data.repairs || [];  // 👈 bản mở rộng cho báo hỏng 2 chiều
state.data.shipmentIssues = state.data.shipmentIssues || [];
/***** UI STATE *****/
state.ui = state.ui || { activityFilter: 'all' };

state.ui.labReqDetailsOpen = state.ui.labReqDetailsOpen || {};  // key = requestId, value = true/false

state.ui.centralLabInv = state.ui.centralLabInv || {};   // key = labId, value = group-key
state.ui.labInv_selectedKey = state.ui.labInv_selectedKey || '';   // '' = tất cả thiết bị của lab
state.ui.labInv_filter = state.ui.labInv_filter || '';   // text ô "Tìm thiết bị"
state.ui.labInvPage = state.ui.labInvPage || 1;    // trang tồn kho lab

state.ui.centralStockPage = state.ui.centralStockPage || 1;
state.ui.activityPage = state.ui.activityPage || 1;    // cho Lab
state.ui.centralActivityPage = state.ui.centralActivityPage || 1;    // cho Central

try {
  const cache = JSON.parse(localStorage.getItem('ef_activities') || '[]');
  if (Array.isArray(cache)) state.data.activities = cache;
} catch { }

state.ui.draftReqLines = state.ui.draftReqLines || []; // danh sách các dòng tạm Lab sắp yêu cầu
state.ui.rq_selectedKey = state.ui.rq_selectedKey || ''; // "asset_code:::asset_name" đang chọn trong dropdown

state.ui.pendingSerial = state.ui.pendingSerial || '';
state.ui.centralStockGroup = state.ui.centralStockGroup || null;

state.ui.pendingReturnSerial = state.ui.pendingReturnSerial || '';
state.ui.scanTarget = state.ui.scanTarget || 'auto'; // 'loan' | 'return' | 'auto'
// Nhận shipment bằng QR
state.ui.shipReceiveCurrentId = state.ui.shipReceiveCurrentId || null;
state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};   // {shipmentId: {itemId: 'ok' | 'missing'}}
state.ui.shipReceiveExtras = state.ui.shipReceiveExtras || {};  // {shipmentId: [serial,...]}
state.ui.shipReceiveScanShipment = state.ui.shipReceiveScanShipment || null;       // shipment đang quét QR
state.ui.shipReceiveReopenShipment = state.ui.shipReceiveReopenShipment || null;   // shipment cần mở lại popup sau khi quét




/***** HELPERS *****/


// Gom tồn kho của 1 lab thành nhóm (asset_code + asset_name)
// chỉ lấy những thiết bị đang thuộc lab đó (lab_id === labId)
// và cả mấy cái còn ở lab (available@lab) lẫn đang mượn (on_loan) để bạn nhìn được hết
function labStockGroups(labId) {
  const groups = {};

  for (const it of state.data.items || []) {
    if (!it) continue;
    if (it.lab_id !== labId) continue;           // chỉ lấy đồ của lab này

    // tên/mã giống bên kho trung tâm để sau này sync được
    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || '(chưa đặt tên)';
    const key = code + ':::' + name;

    if (!groups[key]) {
      groups[key] = {
        key,
        asset_code: code,
        asset_name: name,
        total: 0,
        available: 0,
        on_loan: 0
      };
    }

    groups[key].total++;

    if (it.state === 'available@lab') {
      groups[key].available++;
    } else if (it.state === 'on_loan') {
      groups[key].on_loan++;
    }
  }

  return Object.values(groups);
}

// Escape text để tránh lỗi / XSS khi render HTML
function esc(s) {
  return (s || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bỏ dấu + lowercase để search không phân biệt hoa/thường & dấu
function normalizeText(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Phân trang đơn giản
function paginate(list, page, perPage) {
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const cur = Math.min(Math.max(page, 1), totalPages);
  const start = (cur - 1) * perPage;
  return {
    page: cur,
    totalPages,
    totalItems,
    rows: list.slice(start, start + perPage)
  };
}

// ===== Pagination DRY (dùng chung cho mọi trang) =====
function clampNum(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) n = min;
  return Math.min(max, Math.max(min, n));
}

function pageCount(totalItems, perPage) {
  const t = Number(totalItems) || 0;
  const p = Math.max(1, Number(perPage) || 1);
  return Math.max(1, Math.ceil(t / p));
}

// Tăng/giảm trang theo uiKey, tự clamp vào [1..totalPages]
function moveUiPage(uiKey, delta, totalItems, perPage) {
  state.ui = state.ui || {};
  const totalPages = pageCount(totalItems, perPage);
  const cur = Number(state.ui[uiKey] || 1) || 1;
  const next = clampNum(cur + (Number(delta) || 0), 1, totalPages);
  state.ui[uiKey] = next;
  return { page: next, totalPages };
}


// ===== Pagination helpers (dùng chung) =====
const PAGE_SIZE_7 = 7;

function clampPage(page, totalItems, perPage) {
  const totalPages = Math.max(1, Math.ceil((totalItems || 0) / perPage));
  const safe = Math.min(Math.max(parseInt(page || 1, 10) || 1, 1), totalPages);
  return { page: safe, totalPages, totalItems: (totalItems || 0), perPage };
}

// Lấy slice theo pageKey trong state.ui, tự clamp và tự ghi lại state.ui[pageKey]
function pagedList(list, pageKey, perPage = PAGE_SIZE_7) {
  state.ui = state.ui || {};
  const cur = parseInt(state.ui[pageKey] || 1, 10) || 1;
  const pg = paginate(list || [], cur, perPage); // dùng helper sẵn có
  state.ui[pageKey] = pg.page;
  return pg; // {page,totalPages,totalItems,rows}
}

// Đổi trang theo delta, clamp theo totalItems, rồi gọi rerender()
function movePage(pageKey, delta, totalItems, perPage = PAGE_SIZE_7, rerender) {
  state.ui = state.ui || {};
  const cur = parseInt(state.ui[pageKey] || 1, 10) || 1;
  const pg = clampPage(cur + (delta || 0), totalItems || 0, perPage);
  state.ui[pageKey] = pg.page;
  if (typeof rerender === 'function') rerender();
  return pg;
}



// Chọn 'TEXT' | 'URL' | 'JSON'
const QR_MODE = 'URL';

function buildQrPayload(it) {
  if (QR_MODE === 'URL') return `${location.origin}/#/item?id=${it.id}`;
  if (QR_MODE === 'JSON') return JSON.stringify({ id: it.id, serial: it.serial, type: it.type_id });
  // TEXT (mặc định)
  return [
    `ID: ${it.id}`,
    `Serial: ${it.serial}`,
    `Type: ${typeName(it.type_id) || it.type_id}`,
    `State: ${it.state || ''}`
  ].join('\n');
}

async function generateItemQR(it) {
  const payload = buildQrPayload(it);
  try {
    if (window.QRCode?.toDataURL) it.qr_png = await QRCode.toDataURL(payload, { margin: 1, scale: 6 });
    else if (window.QRCode?.toCanvas) {
      const c = document.createElement('canvas');
      await QRCode.toCanvas(c, payload, { margin: 1, scale: 6 });
      it.qr_png = c.toDataURL('image/png');
    } else {
      it.qr_png = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(payload);
    }
  } catch {
    it.qr_png = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(payload);
  }
}

// ===== Helper: build URL to item by serial =====
function buildItemUrlBySerial(serial) {
  const base = (location.origin && location.origin !== 'null')
    ? (location.origin + location.pathname)
    : location.href.split('#')[0];
  return `${base}#/item?serial=${encodeURIComponent(serial)}`;
}
// ===== Helper: build QR text payload (để quét là thấy đầy đủ thông tin) =====
function buildItemQrText(it) {
  const lines = [
    'EquipFlow • Asset Card',
    `Serial: ${it.serial || ''}`,
    it.asset_name ? `Tên TS: ${it.asset_name}` : '',
    it.asset_code || it.assetCode ? `Số hiệu TS: ${it.asset_code || it.assetCode}` : '',
    it.mfg ? `Hãng: ${it.mfg}` : '',
    it.model ? `Model: ${it.model}` : '',
    it.condition ? `Tình trạng: ${it.condition}` : '',
    it.source ? `Nguồn: ${it.source}` : '',
    it.specs ? `Thông số: ${String(it.specs).trim()}` : '',
    it.notes ? `Ghi chú: ${String(it.notes).trim()}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function freezeUi(ms = 6000) {
  if (!state.ui) state.ui = {};
  state.ui.freezeUntil = Date.now() + ms;
}

function isUiFrozen() {
  return !!(state.ui && state.ui.freezeUntil && Date.now() < state.ui.freezeUntil);
}


// [ADD] ===== Activity helpers =====
function fmtTimeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m trước`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h trước`;
  const d = Math.floor(h / 24); return `${d} ngày trước`;
}

const ACT_ICONS = {
  loan: '📦',
  return: '↩️',
  request: '📝',
  shipment_sent: '🚚',
  shipment_received: '✅',
  item_added: '➕',
  item_removed: '🗑️',
  damage_report: '🛠️',          // 👈 thêm
  damage_resolved: '✔️',      // 👈 thêm
  // 👇 thêm
  repair_reported: '🛠️',
  repair_approved: '✅',
  repair_shipment_created: '📦',
  repair_closed: '✔️'
};

// Ghi activity cho Central (ghi chung vào state.data.activities)
async function logCentral(evt) {
  return logActivity({
    scope: 'central',
    ...evt
  });
}

// Ghi 1 bản ghi activity (client-side; có thể sync Firebase sau)
async function logActivity(evt) {
  const rec = {
    id: (typeof genId === 'function') ? genId('ACT') : `ACT-${Date.now()}`,
    lab_id: state.labId,
    by: state.authUser || { email: 'demo@local' },
    ts: Date.now(),
    ...evt
  };
  state.data.activities.unshift(rec);
  state.data.activities = state.data.activities.slice(0, 200);
  // TODO: khi dùng Firebase:
  // await set(ref(db, `activities/${state.labId}/${rec.id}`), rec);
  try { localStorage.setItem('ef_activities', JSON.stringify(state.data.activities)); } catch { }
  refreshDashboardActivityCard();
}


function renderCentralActivity(perPage = 7, typeFilter = 'all') {
  // lấy hết activity của central
  const all = (state.data.activities || [])
    .filter(a => a.scope === 'central' && (typeFilter === 'all' || a.type === typeFilter));

  const page = state.ui.centralActivityPage || 1;
  const start = (page - 1) * perPage;
  const rowsData = all.slice(start, start + perPage);

  const cur = state.ui.centralActivityFilter || 'all';

  // 1) luôn vẽ cụm nút trước
  const filtersHtml = `
    <div class="activity-filters">
      <button class="activity-filter-btn ${cur === 'all' ? 'is-active' : ''}" onclick="setCentralActivityFilter('all')">Tất cả</button>
      <button class="activity-filter-btn ${cur === 'request_approved' ? 'is-active' : ''}" onclick="setCentralActivityFilter('request_approved')">Duyệt YC</button>
      <button class="activity-filter-btn ${cur === 'shipment_created' ? 'is-active' : ''}" onclick="setCentralActivityFilter('shipment_created')">Shipment</button>
      <button class="activity-filter-btn ${cur === 'item_added' ? 'is-active' : ''}" onclick="setCentralActivityFilter('item_added')">Thêm thiết bị</button>
      <button class="activity-filter-btn ${cur === 'item_removed' ? 'is-active' : ''}" onclick="setCentralActivityFilter('item_removed')">Xóa thiết bị</button>
    </div>
  `;

  // 2) nếu không có dòng thì vẫn hiện nút + message
  if (!rowsData.length) {
    return `
      ${filtersHtml}
      <p class="muted">Không có hoạt động loại này.</p>
    `;
  }

  // 3) có dữ liệu thì vẽ bảng như bình thường
  const rows = rowsData.map(a => {
    const icon = ACT_ICONS[a.type] || '•';
    let line = '';
    switch (a.type) {
      case 'request_approved':
        line = `Duyệt yêu cầu <b>${a.meta?.request_id || ''}</b> (${a.meta?.qty_total || 0} món)`;
        break;
      case 'shipment_created':
        line = `Tạo shipment <b>${a.shipment_id}</b> → ${a.to_lab_id || '-'} (${a.meta?.qty || (a.item_ids?.length || 0)} món)`;
        break;
      case 'item_added':
        line = `Thêm thiết bị <b>${a.item_serial || a.item_id}</b> (${a.meta?.asset_name || ''})`;
        break;
      case 'item_removed':
        line = `Xóa thiết bị <b>${a.item_serial || a.item_id}</b>`;
        break;
      case 'damage_report':
        line = `Báo hỏng <b>${a.item_serial || a.item_id}</b> (${a.meta?.reason || 'không rõ'})`;
        break;
      case 'damage_resolved':
        line = `Central đã xử lý báo hỏng cho <b>${a.item_serial || a.item_id}</b>`;
        break;

      default:
        line = a.type;
    }
    return `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(255,255,255,.06)">
        <div style="width:28px;text-align:center">${icon}</div>
        <div style="flex:1">
          <div>${line}</div>
          <div class="muted-2" style="font-size:12px">${fmtTimeAgo(a.ts)} • ${a.by?.email || 'system'}</div>
        </div>
      </div>
    `;
  }).join('');

  const totalPages = Math.max(1, Math.ceil(all.length / perPage));

  return `
    ${filtersHtml}
    ${rows}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span class="muted-2" style="font-size:12px">Trang ${page} / ${totalPages}</span>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="changeCentralActivityPage(-1)" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="changeCentralActivityPage(1)" ${page >= totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  `;
}


function changeCentralActivityPage(delta) {
  const all = (state.data.activities || []).filter(a =>
    (a.scope === 'central') &&
    (state.ui.centralActivityFilter === 'all' || a.type === state.ui.centralActivityFilter)
  );

  moveUiPage('centralActivityPage', delta, all.length, 7);
  requestActivityCardRefresh();
}


// ===== Shipments Receive: pagination =====
state.ui.shipReceivePage = state.ui.shipReceivePage || 1;

function changeShipReceivePage(delta) {
  const inboundAll = (state.data.shipments || []).filter(s => s.to_lab_id === state.labId);
  moveUiPage('shipReceivePage', delta, inboundAll.length, 7);
  renderPage();
}



state.ui.centralActivityFilter = state.ui.centralActivityFilter || 'all';
function setCentralActivityFilter(t) {
  state.ui.centralActivityFilter = t;
  state.ui.centralActivityPage = 1;    // reset
  requestActivityCardRefresh();
}










function changeCentralStockPage(delta) {
  const groupsCount = Object.keys(
    (state.data.items || []).reduce((acc, it) => {
      if (!it) return acc;
      const code = it.asset_code || it.assetCode || '(không mã)';
      const name = it.asset_name || it.name || it.model || '(không tên)';
      acc[code + '||' + name] = true;
      return acc;
    }, {})
  ).length;

  moveUiPage('centralStockPage', delta, groupsCount, 10);
  renderPage();
}



function setCentralStockGroup(key) {
  // nếu truyền vào là dạng đã encode thì giải ra
  if (key && key.includes('%')) {
    try { key = decodeURIComponent(key); } catch (e) { }
  }

  state.ui.centralStockGroup = key;
  state.ui.centralStockPage = 1;
  renderPage();
}

function clearCentralStockGroup() {
  state.ui.centralStockGroup = null;
  // để nguyên trang hiện tại cũng được, khỏi reset
  renderPage();
}

// ==== Lab Requests: pagination (lịch sử yêu cầu) ====
state.ui = state.ui || {};
state.ui.labReqHistoryPage = state.ui.labReqHistoryPage || 1;

function changeLabReqHistoryPage(delta) {
  const all = (state.data.labRequests || [])
    .filter(r => r.lab_id === state.labId)
    .sort((a, b) => toTS(b.created_at) - toTS(a.created_at));

  movePage('labReqHistoryPage', delta, all.length, 7, renderPage);
}
window.changeLabReqHistoryPage = changeLabReqHistoryPage;

// ===== Lab Repairs: pagination (phiếu báo hỏng của Lab) =====
state.ui = state.ui || {};
state.ui.labRepairsPage = state.ui.labRepairsPage || 1;

function changeLabRepairsPage(delta) {
  const all = (state.data.repairs || [])
    .filter(r => r.lab_id === state.labId)
    .sort((a, b) => (b.created_at_ts || 0) - (a.created_at_ts || 0));

  movePage('labRepairsPage', delta, all.length, 7, renderPage);
}
window.changeLabRepairsPage = changeLabRepairsPage;




// Hàm dùng chung: đọc state.ui.labInv_filter + state.ui.labInv_selectedKey
// rồi cập nhật lại bảng tồn kho lab + dòng info.
function applyLabInvFilter() {
  const labId = state.labId;
  if (!labId) return;

  const groups = labStockGroups(labId);
  const labItems = (state.data.items || []).filter(it => it && it.lab_id === labId);

  // helper: bỏ dấu + lower-case
  const normalize = (s) =>
    (s || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const rawSearch = (state.ui.labInv_filter || '').trim();
  const searchNorm = normalize(rawSearch);
  const tokens = searchNorm.split(/\s+/).filter(Boolean);

  let curGroup = null;
  if (state.ui.labInv_selectedKey) {
    curGroup = groups.find(g => g.key === state.ui.labInv_selectedKey) || null;
  }

  let itemsToShow = labItems;

  // lọc theo nhóm (nếu đang chọn 1 nhóm cụ thể)
  if (curGroup) {
    itemsToShow = itemsToShow.filter(it => {
      const code = it.asset_code || it.assetCode || '(không mã)';
      const name = it.asset_name || it.name || '(chưa đặt tên)';
      return (code === curGroup.asset_code && name === curGroup.asset_name);
    });
  }

  // lọc theo nhiều từ khoá
  if (tokens.length) {
    itemsToShow = itemsToShow.filter(it => {
      const serial = normalize(it.serial);
      const name = normalize(it.asset_name || it.name);
      const code = normalize(it.asset_code || it.assetCode);
      const typeId = normalize(it.type_id);

      const haystack = [serial, name, code, typeId].join(' ');
      return tokens.every(t => haystack.includes(t));
    });
  }

  // build rows
  const rows = itemsToShow.map(it => {
    let st;
    if (it.state === 'available@lab') {
      st = `<span class="pill ok">available@lab</span>`;
    } else if (it.state === 'on_loan') {
      st = `<span class="pill warn">đang mượn</span>`;
    } else if (it.state === 'broken') {
      st = `<span class="pill bad">hỏng</span>`;
    } else if (it.state === 'repair' || it.state === 'at_central_repair') {
      st = `<span class="pill warn">đang sửa</span>`;
    } else {
      st = `<span class="pill">${it.state || '-'}</span>`;
    }

    const typeName =
      (state.data.itemTypes || []).find(t => t.id === it.type_id)?.name ||
      it.type_id || '';

    return `
      <tr>
        <td>${it.serial || '-'}</td>
        <td>${it.asset_name || it.name || ''}</td>
        <td>${typeName}</td>
        <td>${st}</td>
        <td class="toolbar">
          <button class="btn" onclick="viewCentralItem('${it.id}')">Xem</button>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="5" class="muted-2">(Không có thiết bị phù hợp)</td>
    </tr>
  `;

  // tính lại summary cho info line
  const totalAll = labItems.length;
  const availAll = labItems.filter(it => it.state === 'available@lab').length;
  const onLoanAll = labItems.filter(it => it.state === 'on_loan').length;

  let infoHtml;
  if (curGroup) {
    infoHtml = `
      Nhóm: <b>${curGroup.asset_name}</b> (Mã <b>${curGroup.asset_code}</b>) ·
      Tổng: <b>${curGroup.total}</b> ·
      Thiết bị có sẵn: <b>${curGroup.available}</b> ·
      Đang mượn: <b>${curGroup.on_loan}</b>
    `;
  } else {
    infoHtml = `
      (Tất cả thiết bị của Lab) ·
      Tổng: <b>${totalAll}</b> ·
      Thiết bị có sẵn: <b>${availAll}</b> ·
      Đang mượn: <b>${onLoanAll}</b>
    `;
  }

  // cập nhật DOM
  const tbody = document.getElementById('labInvTableBody');
  if (tbody) tbody.innerHTML = rows;

  const infoEl = document.getElementById('labInvInfoLine');
  if (infoEl) infoEl.innerHTML = infoHtml;
}

// Khi gõ tìm kiếm:
// - lưu text
// - reset nhóm về TẤT CẢ
// - set dropdown về "(Tất cả thiết bị của Lab)"
// - áp dụng filter
// Gõ trong ô "Tìm thiết bị"
// Gõ trong ô "Tìm thiết bị"
// Gõ trong ô "Tìm thiết bị"
// Gõ trong ô "Tìm thiết bị"
function setLabInvFilter(val) {
  // Lưu text để nếu đổi route rồi quay lại vẫn nhớ
  state.ui.labInv_filter = val || '';

  // KHÔNG đổi labInv_selectedKey, KHÔNG đụng dropdown
  // => vẫn giữ group đang chọn (Máy điện tâm đồ, Tivi, ...)

  // Lọc trực tiếp trên các dòng đang hiển thị
  const tbody = document.getElementById('labInvTableBody');
  if (!tbody) return;

  // Chuẩn hoá text: bỏ dấu + lowercase
  const normalize = (s) =>
    (s || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const raw = (state.ui.labInv_filter || '').trim();
  const tokens = normalize(raw).split(/\s+/).filter(Boolean);

  Array.from(tbody.querySelectorAll('tr')).forEach(row => {
    const textRow = normalize(row.textContent || '');
    const ok = !tokens.length || tokens.every(t => textRow.includes(t));
    row.style.display = ok ? '' : 'none';
  });

  // Không renderPage(), không focus lại input => gõ mượt, không double ký tự
}
window.setLabInvFilter = setLabInvFilter;


// Khi chọn trong dropdown:
// - set nhóm
// - xoá text tìm kiếm
// - clear ô input
// - áp dụng filter


// Chọn trong dropdown "Chọn thiết bị"
function setLabInvGroup(rawKey) {
  const key = rawKey ? rawKey.replace(/\\'/g, "'") : '';
  state.ui.labInv_selectedKey = key;
  // chọn nhóm -> clear text tìm kiếm
  state.ui.labInv_filter = '';
  state.ui.labInvPage = 1;
  renderPage();
}
window.setLabInvGroup = setLabInvGroup;

// Bấm ← Trước / Sau →
function changeLabInvPage(delta) {
  const cur = state.ui.labInvPage || 1;
  state.ui.labInvPage = cur + delta;
  renderPage();
}
window.changeLabInvPage = changeLabInvPage;


// ==== Lab Requests: toggle xem/ẩn chi tiết từng yêu cầu ====
function toggleLabRequestDetails(reqId) {
  state.ui = state.ui || {};
  state.ui.labReqDetailsOpen = state.ui.labReqDetailsOpen || {};

  const cur = !!state.ui.labReqDetailsOpen[reqId];
  state.ui.labReqDetailsOpen[reqId] = !cur;

  // render lại trang hiện tại, giữ theo state
  renderPage();
}
window.toggleLabRequestDetails = toggleLabRequestDetails;




function setCentralLabInvGroup(labId, rawKey) {
  const key = rawKey.replace(/\\'/g, "'");
  state.ui.centralLabInv = state.ui.centralLabInv || {};
  state.ui.centralLabInv[labId] = key;
  renderPage();
}
window.setCentralLabInvGroup = setCentralLabInvGroup;





function renderRecentActivity(perPage = 7, typeFilter = 'all') {
  // lọc hoạt động của đúng lab
  const all = (state.data.activities || [])
    .filter(a => a.lab_id === state.labId && (typeFilter === 'all' || a.type === typeFilter));

  const page = state.ui.activityPage || 1;
  const start = (page - 1) * perPage;
  const rowsData = all.slice(start, start + perPage);

  if (!rowsData.length) {
    return `<p class="muted">Chưa có hoạt động nào. Hãy thử mượn/trả hoặc nhận shipment.</p>`;
  }

  const rows = rowsData.map(a => {
    const icon = ACT_ICONS[a.type] || '•';
    let line = '';
    switch (a.type) {
      case 'loan': line = `Mượn <b>${a.item_serial || a.item_id}</b> (${a.item_id})`; break;
      case 'return': line = `Trả <b>${a.item_serial || a.item_id}</b> (${a.item_id})`; break;
      case 'request': line = `Gửi yêu cầu (${a.meta?.qty_total || 1} món)`; break;
      case 'shipment_received': line = `Nhận shipment <b>${a.shipment_id}</b> (${a.meta?.qty || (a.item_ids?.length || 0)} món)`; break;
      case 'damage_report':
        line = `Báo hỏng <b>${a.item_serial || a.item_id}</b> (${a.meta?.reason || 'không rõ'})`;
        break;
      case 'damage_resolved':
        line = `Central đã xử lý báo hỏng cho <b>${a.item_serial || a.item_id}</b>`;
        break;
      case 'repair_reported':
        line = `Báo sửa <b>${a.item_serial || a.item_id}</b>`;
        break;
      case 'repair_closed':
        line = `Central đã đóng phiếu sửa <b>${a.item_serial || a.item_id}</b>`;
        break;


      default: line = a.type;
    }
    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px dashed rgba(255,255,255,.06)">
        <div style="width:28px;text-align:center">${icon}</div>
        <div style="flex:1">
          <div>${line}</div>
          <div class="muted-2" style="font-size:12px">${fmtTimeAgo(a.ts)} • ${a.by?.email || 'system'}</div>
        </div>
        ${a.item_id ? `<button class="btn" onclick="viewCentralItem && viewCentralItem('${a.item_id}')">Xem</button>` : ''}
      </div>`;
  }).join('');

  const totalPages = Math.max(1, Math.ceil(all.length / perPage));
  const cur = state.ui.activityFilter || 'all';

  return `
    <div class="activity-filters">
      <button class="activity-filter-btn ${cur === 'all' ? 'is-active' : ''}" onclick="setActivityFilter('all')">Tất cả</button>
      <button class="activity-filter-btn ${cur === 'loan' ? 'is-active' : ''}" onclick="setActivityFilter('loan')">Mượn</button>
      <button class="activity-filter-btn ${cur === 'return' ? 'is-active' : ''}" onclick="setActivityFilter('return')">Trả</button>
      <button class="activity-filter-btn ${cur === 'request' ? 'is-active' : ''}" onclick="setActivityFilter('request')">Yêu cầu</button>
      <button class="activity-filter-btn ${cur === 'shipment_received' ? 'is-active' : ''}" onclick="setActivityFilter('shipment_received')">Nhận hàng</button>
    </div>
    ${rows}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span class="muted-2" style="font-size:12px">Trang ${page} / ${totalPages}</span>
      <div style="display:flex;gap:6px">
        <button class="btn" onclick="changeActivityPage(-1)" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="changeActivityPage(1)" ${page >= totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  `;
}

function changeActivityPage(delta) {
  const all = (state.data.activities || []).filter(a =>
    a.lab_id === state.labId &&
    (state.ui.activityFilter === 'all' || a.type === state.ui.activityFilter)
  );

  moveUiPage('activityPage', delta, all.length, 7);
  requestActivityCardRefresh();
}



function setActivityFilter(t) {
  state.ui.activityFilter = t;
  state.ui.activityPage = 1;      // reset về trang 1 khi đổi filter
  requestActivityCardRefresh();
}

// ===== End Activity helpers =====

const $ = s => document.querySelector(s);

function toast(m) {
  const t = $('#toast');
  t.textContent = m;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ===== APP CONFIRM MODAL (thay cho window.confirm) =====
function ensureAppConfirmDom() {
  if (document.getElementById('appConfirmModal')) return;

  const wrap = document.createElement('div');
  wrap.id = 'appConfirmModal';
  wrap.className = 'hidden';
  wrap.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:grid',
    'place-items:center',
    'background:rgba(0,0,0,.6)',
    'z-index:9999'
  ].join(';');

  wrap.innerHTML = `
    <div style="background:#0f1726;border:1px solid rgba(255,255,255,.08);border-radius:16px;
                max-width:520px;width:92%;padding:18px 18px 16px;position:relative;
                box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <button data-act="close"
        style="position:absolute;top:10px;right:10px;background:transparent;border:0;
               font-size:18px;color:#fff;cursor:pointer" aria-label="Đóng">✕</button>

      <div style="font-size:16px;font-weight:800;color:#fff;margin-bottom:8px" data-role="title">Xác nhận</div>
      <div style="color:rgba(255,255,255,.85);line-height:1.45;margin-bottom:14px" data-role="msg"></div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" data-act="cancel">Huỷ</button>
        <button class="btn primary" data-act="ok">OK</button>
      </div>
    </div>
  `;

  // click ngoài hộp -> cancel
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) wrap.__resolve?.(false);
  });

  document.body.appendChild(wrap);
}

function appConfirm(message, opts = {}) {
  ensureAppConfirmDom();
  const wrap = document.getElementById('appConfirmModal');

  const titleEl = wrap.querySelector('[data-role="title"]');
  const msgEl = wrap.querySelector('[data-role="msg"]');
  const okBtn = wrap.querySelector('[data-act="ok"]');
  const cancelBtn = wrap.querySelector('[data-act="cancel"]');
  const closeBtn = wrap.querySelector('[data-act="close"]');

  titleEl.textContent = opts.title || 'Xác nhận';
  msgEl.textContent = message || '';
  okBtn.textContent = opts.okText || 'OK';
  cancelBtn.textContent = opts.cancelText || 'Huỷ';

  wrap.classList.remove('hidden');

  return new Promise((resolve) => {
    wrap.__resolve = (val) => {
      wrap.classList.add('hidden');
      wrap.__resolve = null;
      resolve(!!val);
    };

    okBtn.onclick = () => wrap.__resolve(true);
    cancelBtn.onclick = () => wrap.__resolve(false);
    closeBtn.onclick = () => wrap.__resolve(false);

    // ESC để hủy
    const onKey = (ev) => {
      if (ev.key === 'Escape') wrap.__resolve(false);
    };
    document.addEventListener('keydown', onKey, { once: true });
  });
}

// nếu muốn dùng chỗ khác
window.appConfirm = appConfirm;


// hiển thị (giữ phong cách bạn đang dùng)
function nowText() {
  return new Date().toLocaleString('vi-VN', { hour12: false });
}

// giữ tương thích: nơi nào đang gọi now() để HIỂN THỊ thì vẫn ok
function now() {
  return nowText();
}

// format datetime an toàn (hỗ trợ cả number / ISO / "dd/mm/yyyy, HH:MM:SS")
function fmtDT(v) {
  const d = parseDateLoose(v);
  return d ? d.toLocaleString('vi-VN', { hour12: false }) : (v ? String(v) : '');
}

// convert sang timestamp để sort (tránh NaN khi created_at là string)
function toTS(v) {
  const d = parseDateLoose(v);
  return d ? d.getTime() : 0;
}

setInterval(() => $('#clock') && ($('#clock').textContent = now()), 1000);


/***** FIREBASE (RTDB) *****/
const { db, ref, set, get } = window._firebase;
const LS_SESSION = 'ef_session';

const DB_USERS = "users";
const DB_ITEMS = "items";
const DB_LOANS = "loans";
const DB_REQUESTS = "requests";
const DB_SHIPMENTS = "shipments";
const DB_LABS = "labs";
const DB_SHIPMENT_ISSUES = "shipmentIssues"; // ✅ phiếu báo sai khác (Lab -> Kho trung tâm)

// thêm 2 dòng này
const DB_DAMAGE_REPORTS = "damageReports";   // node cũ (nếu còn dùng)
const DB_REPAIRS = "repairs";         // node mới cho luồng sửa chữa


/***** CRYPTO + USER HELPERS *****/
async function sha256(text) { const enc = new TextEncoder().encode(text); const buf = await crypto.subtle.digest('SHA-256', enc); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function saveUserToDB(user) { await set(ref(db, `${DB_USERS}/${user.id}`), user); }
async function getAllUsers() { const snap = await get(ref(db, DB_USERS)); return snap.exists() ? Object.values(snap.val()) : []; }
async function getUserByEmail(email) { const users = await getAllUsers(); return users.find(u => u.email === email); }

function setSession(u) { state.authUser = u; localStorage.setItem(LS_SESSION, JSON.stringify({ email: u.email })); }
async function sessionUser() { const s = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); if (!s) return null; return await getUserByEmail(s.email); }
function clearSession() { localStorage.removeItem(LS_SESSION); state.authUser = null; }

function showAuth() { $('#auth').classList.remove('hidden'); $('#appRoot').classList.add('hidden'); }
function showApp() { $('#auth').classList.add('hidden'); $('#appRoot').classList.remove('hidden'); }

/***** DATA HELPERS (Firebase) *****/
async function saveData(path, id, obj) { await set(ref(db, `${path}/${id}`), obj); }
async function deleteData(path, id) { await set(ref(db, `${path}/${id}`), null); }

async function getAll(path) { const snap = await get(ref(db, path)); return snap.exists() ? snap.val() : {}; }
async function backfillShipmentIssueIdsOnce() {
  try {
    const map = await getAll(DB_SHIPMENT_ISSUES);
    const entries = Object.entries(map || {});
    let touched = 0;

    for (const [id, obj] of entries) {
      if (!obj || typeof obj !== 'object') continue;
      if (obj.id !== id) {
        obj.id = id;
        obj.issue_id = obj.issue_id || id;
        await saveData(DB_SHIPMENT_ISSUES, id, obj);
        touched++;
      }
    }

    if (touched) console.log(`[ShipmentIssues] backfill id: updated ${touched} issue(s)`);
  } catch (e) {
    console.warn('[ShipmentIssues] backfill error', e);
  }
}


function genIssueId() {
  // ví dụ: ISS-K9Q2-ML4N2P
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  const t = Date.now().toString(36).toUpperCase();
  return `ISS-${r}-${t}`;
}

function getLabNameById(labId) {
  const lab = (state.data.labs || []).find(x => x.id === labId);
  return lab ? (lab.name || lab.lab_name || labId) : labId;
}

function summarizeItemsByIds(itemIds) {
  const out = [];
  for (const id of (itemIds || [])) {
    const it = (state.data.items || []).find(x => x.id === id);
    if (!it) { out.push(`- ${id}`); continue; }
    const serial = it.serial || it.asset_code || "(no-serial)";
    const name = it.asset_name || it.name || "(no-name)";
    out.push(`- ${serial} • ${name}`);
  }
  return out.join("\n");
}

async function createShipmentIssueAndLink(shipment, missingItemIds, extraSerials) {
  // tránh tạo trùng
  shipment.receive_meta = shipment.receive_meta || {};
  if (shipment.receive_meta.issue_id) return shipment.receive_meta.issue_id;

  const issueId = genIssueId();
  const labName = getLabNameById(shipment.to_lab_id || state.labId);

  const missingText = (missingItemIds && missingItemIds.length)
    ? summarizeItemsByIds(missingItemIds)
    : "(không)";
  const extraText = (extraSerials && extraSerials.length)
    ? extraSerials.map(s => `- ${s}`).join("\n")
    : "(không)";

  const issueObj = {
    // ✅ QUAN TRỌNG: lưu id vào object để Central dùng Object.values vẫn có id
    id: issueId,
    issue_id: issueId, // (optional) để tương thích nếu nơi khác đang dùng issue_id

    shipment_id: shipment.id,
    lab_id: shipment.to_lab_id || state.labId,
    lab_name: labName,

    status: "Chưa xử lý ", 
    created_at: Date.now(),
    created_by: (state.authUser && state.authUser.email) ? state.authUser.email : "unknown",

    // nội dung sai khác
    missing_item_ids: missingItemIds || [],
    extra_serials: extraSerials || [],

    // message gửi kho trung tâm
    title: `Sai khác khi nhận shipment ${shipment.id}`,
    message:
      `Lab ${labName} báo sai khác khi nhận shipment ${shipment.id}.\n\n` +
      `THIẾU (cần kho gửi lại đúng thiết bị):\n${missingText}\n\n` +
      `THỪA / NGOÀI SHIPMENT (đề nghị kho kiểm tra đối soát):\n${extraText}\n\n` +
      `Yêu cầu: Kho trung tâm gửi lại đúng thiết bị còn thiếu theo danh sách.`
  };

  await saveData(DB_SHIPMENT_ISSUES, issueId, issueObj);

  // link ngược về shipment để UI hiển thị "Đã báo sai khác"
  shipment.receive_meta.issue_id = issueId;
  shipment.receive_meta.issue_status = "open";
  shipment.receive_meta.issue_created_at = issueObj.created_at;

  return issueId;
}



/***** AUTH FORMS *****/
/***** AUTH FORMS *****/
function bindAuth() {
  const tLogin = $('#tabLogin');
  const fLogin = $('#loginForm');

  // Nếu HTML còn sót tab/form đăng ký thì ẩn luôn (an toàn)
  const tReg = $('#tabRegister');
  const fReg = $('#registerForm');
  if (tReg) tReg.style.display = 'none';
  if (fReg) fReg.style.display = 'none';

  if (tLogin) {
    tLogin.onclick = () => {
      tLogin.classList.add('active');
      if (tReg) tReg.classList.remove('active');
      if (fLogin) fLogin.classList.add('visible');
      if (fReg) fReg.classList.remove('visible');
    };
  }

  fLogin.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const pass = $('#loginPass').value;

    const u = await getUserByEmail(email);
    if (!u) { toast('Email không tồn tại'); return; }
    if (await sha256(pass) !== u.pass) { toast('Mật khẩu sai'); return; }

    setSession(u);
    afterLogin(u);
  });
}



/***** NAV + ROUTER *****/
const NAVS = {
  lab: [
    { href: '#/dashboard', icon: '📊', label: 'TỔNG QUAN' },
    { href: '#/lab-inventory', icon: '📦', label: 'TỒN KHO LAB' },
    { href: '#/lab-handover', icon: '🧾', label: 'GIAO PHÁT(MƯỢN)' },
    { href: '#/lab-returns', icon: '↩️', label: 'THU HỒI (TRẢ)' },
    { href: '#/lab-requests', icon: '📨', label: 'YÊU CẦU NHẬN HÀNG' },
    { href: '#/shipments-receive', icon: '📥', label: 'NHẬN HÀNG' },
    { href: '#/lab-repairs', icon: '🛠️', label: 'BÁO HỎNG' }        // 👈 thêm

  ],
  central: [
    { href: '#/dashboard', icon: '📊', label: 'TỔNG QUAN' },
    { href: '#/labs', icon: '🏫', label: 'PHÒNG LAB' },
    { href: '#/central-stock', icon: '🏢', label: 'KHO TRUNG TÂM' },
    { href: '#/central-requests', icon: '📝', label: 'DUYỆT YÊU CẦU' },
    { href: '#/central-shipments', icon: '🚚', label: 'TẠO/ QUẢN LÝ SHIPMENT' },
    { href: '#/central-shipment-issues', icon: '⚠️', label: 'SAI KHÁC SHIPMENT' },
    { href: '#/central-repairs', icon: '🛠️', label: 'BÁO HỎNG' },      
    { href: '#/central-users', icon: '👤', label: 'QUẢN LÝ USER' }
  ]
};

// ===== NAV BADGES (Thông báo menu) =====
const NAV_SEEN_KEY = 'ef_nav_seen_v1';

function __loadNavSeen() {
  try { return JSON.parse(localStorage.getItem(NAV_SEEN_KEY) || '{}') || {}; }
  catch { return {}; }
}
function __saveNavSeen(obj) {
  try { localStorage.setItem(NAV_SEEN_KEY, JSON.stringify(obj || {})); } catch {}
}
function markNavSeen(href) {
  if (!href) return;
  const seen = __loadNavSeen();
  seen[href] = Date.now();
  __saveNavSeen(seen);
}
function __fmtBadge(n) {
  if (!n || n <= 0) return '';
  return (n > 99) ? '99+' : String(n);
}
function __ts(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof toTS === 'function') return toTS(v);
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
function __reqLastTs(r) {
  return Math.max(__ts(r.created_at), __ts(r.approved_at), __ts(r.fulfilled_at));
}
function __shipLastTs(s) {
  const draft = (s && s.receive_meta) ? s.receive_meta.draft_updated_at : 0;
  return Math.max(__ts(s.created_at), __ts(s.sent_at), __ts(s.received_at), __ts(draft));
}
function __repairLastTs(r) {
  const his = Array.isArray(r.history) ? r.history : [];
  const lastHis = his.reduce((m, h) => Math.max(m, __ts(h.ts)), 0);
  return Math.max(__ts(r.reported_at), __ts(r.created_at_ts), __ts(r.created_at), __ts(r.updated_at), lastHis);
}

/**
 * Tính badge theo từng menu item (href).
 * - Lab: hiển thị "thay đổi mới" kể từ lần cuối bấm vào trang đó
 * - Central: hiển thị "việc cần xử lý" (pending/open)
 */
function computeNavBadges(role) {
  const seen = __loadNavSeen();
  const badges = {};

  if (role === 'lab') {
    // Yêu cầu nhận hàng: đếm request có thay đổi mới
    const hrefReq = '#/lab-requests';
    const lastReq = seen[hrefReq] || 0;
    const reqs = (state.data.labRequests || []).filter(r => r.lab_id === state.labId);
    badges[hrefReq] = reqs.filter(r => __reqLastTs(r) > lastReq).length;

    // Nhận shipment: ưu tiên hiển thị số shipment CHƯA NHẬN (actionable)
    const hrefShip = '#/shipments-receive';
    const inbound = (state.data.shipments || []).filter(s =>
      s && s.to_lab_id === state.labId && !s.received_at
    );
    badges[hrefShip] = inbound.length;

    // Báo hỏng: đếm phiếu sửa có thay đổi mới
    const hrefRep = '#/lab-repairs';
    const lastRep = seen[hrefRep] || 0;
    const reps = (state.data.repairs || []).filter(r => r.lab_id === state.labId);
    badges[hrefRep] = reps.filter(r => __repairLastTs(r) > lastRep).length;

  } else if (role === 'central') {
    // Duyệt yêu cầu: Chưa xử lý
    badges['#/central-requests'] = (state.data.labRequests || []).filter(r => (r.status || '') === 'Chưa xủ lý').length;

    // Sai khác shipment: issue open
    badges['#/central-shipment-issues'] = (state.data.shipmentIssues || []).filter(i => (i.status || 'open') === 'open').length;

    // Báo hỏng: repair pending
    badges['#/central-repairs'] = (state.data.repairs || []).filter(r => (r.status || 'Đang chờ') === 'Đang chờ').length;

    // Quản lý shipment: shipment gửi về CENTRAL mà chưa received (cần nhận)
    badges['#/central-shipments'] = (state.data.shipments || []).filter(s =>
      s && s.to_lab_id === 'CENTRAL' && s.status !== 'received'
    ).length;
  }

  // dọn số 0
  Object.keys(badges).forEach(k => { if (!badges[k]) delete badges[k]; });
  return badges;
}

function baseRoute(r) {
  return (r || '').split('?')[0];
}

function navParent(route) {
  const r = baseRoute(route);

  // các trang con của CENTRAL
  if (r === '#/lab-view') return '#/labs';
  if (r === '#/central-import' || r === '#/central-add') return '#/central-stock';

  // trang xem chi tiết item -> bôi đậm theo vai trò hiện tại
  if (r === '#/item') {
    return (state.role === 'central') ? '#/central-stock' : '#/lab-inventory';
  }

  // trang scan của lab -> coi như đi mượn
  if (r === '#/scan') return '#/lab-handover';
  
  
  // trang scan cho Nhận shipment -> vẫn highlight menu Nhận shipment
  if (r === '#/ship-scan') return '#/shipments-receive';
  return r; // mặc định: tự nó
}
const LAB_ROUTES = [
  '#/lab-inventory', '#/lab-handover', '#/lab-returns',
  '#/lab-requests', '#/shipments-receive', '#/lab-repairs'   // 👈 thêm
];

const CENTRAL_ROUTES = [
  '#/labs', '#/lab-view', '#/central-stock', '#/central-requests',
  '#/central-shipments', '#/central-import',
  '#/central-repairs',    // 👈 thêm
  '#/reports',             // 👈 thêm
  '#/central-shipment-issues',
  '#/central-users' // 👈 thêm dòng này

];


function canAccess(routeRaw) {
  const route = baseRoute(routeRaw);

  if (route && route.startsWith('#/item')) return true;
  if (route === '#/dashboard') return true;
  if (LAB_ROUTES.includes(route)) return state.role === 'lab';
  if (CENTRAL_ROUTES.includes(route)) return state.role === 'central';
  return true;
}
function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  nav.innerHTML = '';

  const cur = navParent(state.route);
  const role = state.role;

  const badges = computeNavBadges(role);

  for (const item of NAVS[role]) {
    const el = document.createElement('div');
    el.className = 'nav-item';
    el.dataset.href = item.href;

    const count = badges[item.href] || 0;
    const badgeText = __fmtBadge(count);

    el.innerHTML = `
      <div class="nav-left">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </div>
      ${badgeText ? `<span class="nav-badge">${badgeText}</span>` : ``}
    `;

    if (navParent(item.href) === cur) el.classList.add('active');
    el.onclick = () => navigate(item.href);
    nav.appendChild(el);
  }
}




function __handleItemDeepLink() {
  const q = location.hash.split('?')[1];
  if (!q) return;
  const params = new URLSearchParams(q);
  const id = params.get('id') || params.get('item');   // ⬅️ thêm get('id')
  if (!id) return;
  const item = state.data.items.find(it => it.id === id);
  if (item) viewCentralItem(item.id);
}
// ==== Debounced refresh cho thẻ "Hoạt động gần đây" ====
let __actRefreshTimer = null;
function requestActivityCardRefresh() {
  if (state.route !== '#/dashboard') return; // chỉ refresh khi đang ở dashboard
  if (__actRefreshTimer) clearTimeout(__actRefreshTimer);
  __actRefreshTimer = setTimeout(() => {
    __actRefreshTimer = null;
    refreshDashboardActivityCard();
  }, 80); // 80–120ms là đẹp
}


function refreshDashboardActivityCard() {
  if (state.route !== '#/dashboard') return;
  const el = document.getElementById('recentActivityCard');
  if (!el) return;

  const PER_PAGE = 7; // 👈 muốn 7 mục mỗi trang

  const body = (state.role === 'lab')
    ? renderRecentActivity(PER_PAGE, state.ui.activityFilter)
    : renderCentralActivity(PER_PAGE, state.ui.centralActivityFilter);

  el.innerHTML = `
    <h1>Hoạt động gần đây</h1>
    ${body}
  `;
}


let _navInternal = false;
let _dataSyncTimer = null;   // timer sync dữ liệu định kỳ


function navigate(route) {
  if (!canAccess(route)) { toast('Bạn không có quyền truy cập trang này'); return; }
  const from = state.route;

  // rời trang quét QR thì phải tắt camera
  if (from === '#/scan' || from === '#/ship-scan') {
    try { stopScan(); } catch { }
  }

  _navInternal = true;                 // ✅ báo hiệu "đang navigate nội bộ"
  state.route = route;
  location.hash = route;               // sẽ kích hoạt hashchange
}


window.addEventListener('hashchange', () => {
  const wasInternal = _navInternal;
  state.route = location.hash || '#/dashboard';

  if (!canAccess(state.route)) {
    navigate('#/dashboard');
    return;
  }
  markNavSeen(navParent(state.route));   // ✅ vào trang là coi như đã xem
  renderNav();
  renderPage();
  __handleItemDeepLink();



  if (wasInternal) _navInternal = false;
});



$('#roleSelect')?.addEventListener('change', (e) => {
  const fixed = state.authUser?.defaultRole || 'lab';
  e.target.value = fixed;
  state.role = fixed;
  toast('Vai trò cố định theo tài khoản.');
  renderNav(); renderPage();
});

/***** DATA + INVENTORY HELPERS *****/

// ==== INDEXES & CACHE ====
state.index = {
  itemsById: new Map(),
  itemsBySerial: new Map(),
  repairsById: new Map(),
  shipmentsById: new Map()
};
state.cache = {
  centralGroups: null,        // mảng groups đã memo
  labGroups: new Map(),       // nếu cần nhóm theo lab sau này
  version: 0
};

function rebuildIndexes() {
  const idx = state.index;
  idx.itemsById.clear();
  idx.itemsBySerial.clear();
  idx.repairsById.clear();
  idx.shipmentsById.clear();

  for (const it of (state.data.items || [])) {
    if (!it) continue;
    idx.itemsById.set(it.id, it);
    if (it.serial) idx.itemsBySerial.set(it.serial, it);
  }
  for (const r of (state.data.repairs || [])) {
    if (!r) continue;

    // Chuẩn hoá field ảnh: luôn ưu tiên img_url,
    // nếu chưa có thì map từ image_url hoặc images[0] (legacy)
    if (!r.img_url && r.image_url) {
      r.img_url = r.image_url;
    } else if (!r.img_url && Array.isArray(r.images) && r.images[0]) {
      r.img_url = r.images[0];
    }

    idx.repairsById.set(r.id, r);
  }
  for (const s of (state.data.shipments || [])) {
    if (!s) continue;
    idx.shipmentsById.set(s.id, s);
  }
}

function bumpDataVersion() {
  state.cache.version++;
  state.cache.centralGroups = null;   // invalidate group memo
  state.cache.labGroups.clear();      // nếu có dùng
  rebuildIndexes();
}

// tiện wrappers
const getItemById = (id) => state.index.itemsById.get(id);
const getShipmentById = (id) => state.index.shipmentsById.get(id);
const getRepairById = (id) => state.index.repairsById.get(id);

function typeName(id) { return state.data.itemTypes.find(t => t.id === id)?.name || id; }
function centralAvailableByType(t) { return state.data.items.filter(x => x.type_id === t && x.state === 'available@central').length; }








// Gom kho trung tâm thành các nhóm tài sản giống trang "Kho trung tâm"
// Mỗi nhóm = (asset_code + asset_name)
// Trả về mảng [{asset_code, asset_name, available, in_transit}, ...]
function centralStockGroups() {
  const groups = {};

  for (const it of state.data.items || []) {
    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || it.model || '(không tên)';
    const key = code + '::' + name;

    if (!groups[key]) {
      groups[key] = {
        asset_code: code,
        asset_name: name,
        available: 0,
        in_transit: 0
      };
    }

    if (it.state === 'available@central') groups[key].available++;
    if (it.state === 'in_transit') groups[key].in_transit++;
  }

  return Object.values(groups);
}
// Đếm số lượng còn available@central cho 1 nhóm (asset_code + asset_name)
function centralAvailableByGroup(asset_code, asset_name) {
  let count = 0;
  for (const it of state.data.items || []) {
    if (it.state !== 'available@central') continue;

    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || it.model || '(không tên)';

    if (code === asset_code && name === asset_name) {
      count++;
    }
  }
  return count;
}

// Chọn ra N thiết bị từ 1 nhóm (asset_code + asset_name),
// chuyển trạng thái chúng sang 'in_transit' để đưa vào shipment
function pickFromCentralGroup(asset_code, asset_name, qty, to_lab_id) {
  const picked = [];
  for (const it of state.data.items || []) {
    if (picked.length >= qty) break;
    if (it.state !== 'available@central') continue;

    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || it.model || '(không tên)';

    if (code === asset_code && name === asset_name) {
      it.state = 'in_transit';
      if (to_lab_id) it.lab_id = to_lab_id;  // 👈 gán lab đích
      picked.push(it);
    }

  }
  return picked;
}


// Chọn danh sách nhóm để hiển thị trong dropdown:
// - Nếu có ít nhất 1 nhóm còn hàng (available > 0) -> chỉ show các nhóm còn hàng
// - Nếu tất cả đều 0 -> vẫn show hết để dropdown không rỗng
// Chỉ trả về những nhóm còn hàng trong kho central
function getRequestableGroups() {
  const allGroups = centralStockGroups() || [];

  // chỉ lấy nhóm có available > 0
  return allGroups.filter(g => (g.available || 0) > 0);
}


// Tạo HTML <option> cho dropdown "Loại" (thực chất là "Tài sản cần xin")
// Chuẩn hoá text để search: lower-case + bỏ dấu tiếng Việt
function normalizeRqText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // bỏ dấu
}

// Tạo HTML <option> cho dropdown "Loại" (tài sản cần xin)
function buildRequestItemOptions() {
  const allGroups = getRequestableGroups() || [];

  // Lấy từ khoá trong ô "Nhập để tìm..."
  const rawTerm = (state.ui.rq_searchTerm || '').trim();
  let groups = allGroups;

  if (rawTerm) {
    const term = normalizeRqText(rawTerm);
    groups = allGroups.filter(g => {
      const text = normalizeRqText(
        (g.asset_code || '') + ' ' + (g.asset_name || '')
      );
      return text.includes(term);
    });
  }

  // Không còn nhóm nào sau khi filter
  if (!groups.length) {
    state.ui.rq_selectedKey = '';
    return `<option disabled>(Không tìm thấy thiết bị phù hợp)</option>`;
  }

  // Đảm bảo rq_selectedKey luôn nằm trong list mới
  if (!state.ui.rq_selectedKey) {
    state.ui.rq_selectedKey = groups[0].asset_code + ':::' + groups[0].asset_name;
  } else {
    const exists = groups.some(
      g => (g.asset_code + ':::' + g.asset_name) === state.ui.rq_selectedKey
    );
    if (!exists) {
      state.ui.rq_selectedKey = groups[0].asset_code + ':::' + groups[0].asset_name;
    }
  }

  return groups.map(g => {
    const key = g.asset_code + ':::' + g.asset_name;
    const safeVal = key.replace(/'/g, "\\'");
    const sel = (key === state.ui.rq_selectedKey) ? 'selected' : '';
    return `
      <option value='${safeVal}' ${sel}>
        ${g.asset_code} - ${g.asset_name}
      </option>`;
  }).join('');
}



function onRqSearchInput(val) {
  // Lưu lại từ khoá search
  state.ui.rq_searchTerm = val || '';

  // Chỉ cập nhật lại <select>, không render lại cả trang
  const sel = document.getElementById('rq_type');
  if (!sel) return;

  sel.innerHTML = buildRequestItemOptions();

  // Sau khi đổi list option thì cập nhật lại giới hạn số lượng + hint "Tối đa X"
  if (typeof updateRqQtyLimit === 'function') {
    updateRqQtyLimit();
  }
}



// Helper: từ rq_selectedKey tách ra code + name
function parseSelectedKey(rawKey) {
  if (!rawKey) return { code: '', name: '' };

  // khôi phục dấu ' đã escape ở trên (nếu có)
  const key = rawKey.replace(/\\'/g, "'");

  const parts = key.split(':::');
  return {
    code: parts[0] || '',
    name: parts.slice(1).join(':::') || ''  // phòng trường hợp tên cũng chứa ::: (hiếm)
  };
}


// Lấy object group hiện tại (asset_code + asset_name) để biết available bao nhiêu
function getSelectedGroup(key) {
  const { code, name } = parseSelectedKey(key || '');
  const groups = centralStockGroups();
  for (const g of groups) {
    if (g.asset_code === code && g.asset_name === name) {
      return g;
    }
  }
  return null;
}

// Khi người dùng đổi dropdown
function onReqTypeChange() {
  const sel = $('#rq_type');
  if (!sel) return;
  state.ui.rq_selectedKey = sel.value;
  // Đổi loại → cập nhật lại giới hạn số lượng & hint Tối đa X
  updateRqQtyLimit();
}

function onRqQtyInput(v) {
  if (!state.ui) state.ui = {};
  // giữ đúng cái user đang nhập
  state.ui.rq_qty = v;
}
window.onRqQtyInput = onRqQtyInput;


function updateRqQtyLimit() {
  const sel = $('#rq_type');
  const qtyInput = $('#rq_qty');
  const hintEl = $('#rq_hint');
  if (!sel || !qtyInput || !hintEl) return;

  // key đang chọn
  let key = sel.value || state.ui.rq_selectedKey || '';
  if (!key) {
    hintEl.textContent = 'Tối đa 0';
    qtyInput.value = 1;
    state.ui.rq_qty = '1';
    return;
  }
  state.ui.rq_selectedKey = key;

  // tách mã + tên
  const { code, name } = parseSelectedKey(key);

  // nhóm thực tế trong kho trung tâm
  const grp = centralStockGroups().find(g => g.asset_code === code && g.asset_name === name);
  const maxAvail = grp ? grp.available : 0;

  // đã yêu cầu bao nhiêu món này trong draft rồi?
  const draftLine = (state.ui.draftReqLines || []).find(l => l.asset_code === code && l.asset_name === name);
  const already = draftLine ? (draftLine.qty_requested || 0) : 0;

  // còn lại bao nhiêu để xin thêm
  const remaining = Math.max(0, maxAvail - already);

  // set max và hint
  qtyInput.setAttribute('max', String(remaining || 0));

  // chỉnh lại value cho hợp lý
  let curVal = parseInt(qtyInput.value || '1', 10);
  if (remaining === 0) {
    curVal = 0;           // hết hàng → để 0
  } else {
    if (curVal < 1) curVal = 1;
    if (curVal > remaining) curVal = remaining;
  }
  qtyInput.value = curVal;
  state.ui.rq_qty = String(curVal);


  hintEl.textContent = `Tối đa ${remaining}`;
}







function addDraftLine() {
  const sel = $('#rq_type');
  const qtyInput = $('#rq_qty');
  if (!sel || !qtyInput) { toast('Thiếu input'); return; }

  const key = sel.value || state.ui.rq_selectedKey || '';
  const { code, name } = parseSelectedKey(key);
  if (!code || !name) { toast('Không lấy được mã / tên tài sản'); return; }

  let qty = parseInt(qtyInput.value || '0', 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    toast('Số lượng phải lớn hơn 0');
    return;
  }

  // Tính tồn kho & số lượng đã xin trước đó cho nhóm này
  const grp = centralStockGroups().find(g =>
    g.asset_code === code && g.asset_name === name
  );
  const maxAvail = grp ? grp.available : 0;

  state.ui.draftReqLines = state.ui.draftReqLines || [];
  const existed = state.ui.draftReqLines.find(l => l.asset_code === code && l.asset_name === name);
  const already = existed ? (existed.qty_requested || 0) : 0;
  const remaining = Math.max(0, maxAvail - already);

  if (remaining <= 0) {
    toast('Kho trung tâm không còn hàng để xin thêm cho nhóm này.');
    return;
  }

  if (qty > remaining) {
    qty = remaining;
  }

  if (existed) {
    existed.qty_requested = (existed.qty_requested || 0) + qty;
  } else {
    state.ui.draftReqLines.push({
      asset_code: code,
      asset_name: name,
      qty_requested: qty
    });
  }

  // reset số lượng về 1 cho lần thêm tiếp
  qtyInput.value = '1';

  // render lại UI + cập nhật max/hint
  renderPage();
  updateRqQtyLimit();
}





// Xoá một dòng draft theo index
function removeDraftLine(idx) {
  state.ui.draftReqLines.splice(idx, 1);
  renderPage();
}

// Xoá sạch draft
function clearDraftLines() {
  state.ui.draftReqLines = [];
  renderPage();
}

// Gửi toàn bộ draftReqLines lên DB thành 1 request nhiều dòng
async function submitDraftRequest() {
  if (!state.ui.draftReqLines.length) {
    toast('Danh sách trống');
    return;
  }

  const reqId = 'REQ-' + Math.random().toString(36).slice(2, 6).toUpperCase();

  const req = {
    id: reqId,
    lab_id: state.labId,
    status: 'Đang chờ',
    lines: state.ui.draftReqLines.map(l => ({
      asset_code: l.asset_code,
      asset_name: l.asset_name,
      qty_requested: l.qty_requested
    })),
    created_at: now(),
    approved_at: ''
  };

  // Lưu local
  state.data.labRequests.push(req);

  // Lưu DB (giống cách bạn save request cũ)
  await saveData(DB_REQUESTS, reqId, req);

  // Ghi activity để dashboard / lịch sử xem được
  await logActivity({
    type: 'request',
    meta: {
      request_id: req.id,
      lines: state.ui.draftReqLines.map(l => ({
        asset_code: l.asset_code,
        asset_name: l.asset_name,
        qty_requested: l.qty_requested,
        item_ids: (l.item_ids || []).slice()
      })),
      qty_total: req.lines.reduce((sum, l) => sum + (l.qty_requested || 0), 0)
    }
  });

    // clear draft + show newest on top
  state.ui.draftReqLines = [];
  state.ui.labReqHistoryPage = 1; // luôn về trang 1 để thấy yêu cầu mới
  toast('Đã gửi yêu cầu');

  // Nếu đang ở đúng trang lab-requests thì tự render lại (vì hash không đổi => không có hashchange)
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch {}
  if (baseRoute(state.route) === '#/lab-requests') {
    renderPage();
  } else {
    navigate('#/lab-requests');
  }

}

function pickFromCentral(t, qty) {
  const picked = []; for (const it of state.data.items) {
    if (picked.length >= qty) break;
    if (it.type_id === t && it.state === 'available@central') { it.state = 'in_transit'; picked.push(it); }
  }
  return picked;
}




// Chuẩn hoá items của shipment (array/object -> array)
// Chuẩn hoá danh sách item trong shipment (hỗ trợ cả định dạng cũ và mới)
function itemsOf(s) {
  if (!s) return [];

  // ✅ format mới: chỉ lưu danh sách ID
  if (Array.isArray(s.item_ids)) {
    return s.item_ids;
  }

  // ✅ format cũ: mảng các object item đầy đủ
  if (Array.isArray(s.items)) {
    return s.items;
  }

  // ✅ format cũ hơn nữa: object { itemId: {id, serial,...}, ... }
  if (s.items && typeof s.items === 'object') {
    return Object.values(s.items);
  }

  return [];
}

function countItems(s) {
  return itemsOf(s).length;
}

// Trả về danh sách item chi tiết (id, serial, name) của 1 shipment
function shipmentItemsDetailed(s) {
  const raw = itemsOf(s);
  const all = state.data.items || [];
  if (!Array.isArray(raw)) return [];

  return raw.map((x, idx) => {
    let it = null;

    if (typeof x === 'string') {
      it = all.find(i => i.id === x) || { id: x };
    } else if (x && typeof x === 'object') {
      it = x;
    }

    if (!it) return null;

    const name = it.asset_name || it.item_name || it.name || '';
    const serial = it.serial || '';
    const id = it.id || it.item_id || serial || (`row-${idx}`);

    return { id, name, serial };
  }).filter(Boolean);
}



// Sinh ID/serial khi thêm item central
const SERIAL_BASE = { 'type-LAP': 1000, 'type-OSC': 2000, 'type-PSU': 3000 };
const SERIAL_PREFIX = { 'type-LAP': 'LAP-', 'type-OSC': 'OSC-', 'type-PSU': 'PSU-' };
function nextCentralId(typeId) {
  const short = (typeId || '').replace('type-', ''); const re = new RegExp(`^C-${short}-([0-9]+)$`);
  const nums = state.data.items.map(i => i.id.match(re)?.[1]).map(n => parseInt(n, 10)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1; return `C-${short}-${next}`;
}
function nextSerial(typeId) {
  const prefix = SERIAL_PREFIX[typeId] || (typeId.replace('type-', '') + '-');
  const base = SERIAL_BASE[typeId] ?? 1;
  const nums = state.data.items.filter(i => i.type_id === typeId && i.serial?.startsWith(prefix))
    .map(i => parseInt(i.serial.slice(prefix.length), 10)).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : base) + 1; return `${prefix}${next}`;
}
// Đếm số thiết bị hiện đang available@lab trong 1 phòng lab cụ thể
function labAvailableById(labId) {
  return state.data.items.filter(i =>
    i.state === 'available@lab' &&
    i.lab_id === labId
  ).length;
}

// Tạo danh sách phòng Lab mặc định trong DB nếu chưa có
async function seedLabsIfEmpty() {
  const current = await getAll(DB_LABS);
  // nếu DB_LABS đã có rồi thì thôi khỏi seed
  if (current && Object.keys(current).length) return;

  const defaults = [
    { id: 'LAB-E201', name: 'Phòng Lab E201' },
    { id: 'LAB-E202', name: 'Phòng Lab E202' },
    { id: 'LAB-E203', name: 'Phòng Lab E203' }
  ];

  for (const L of defaults) {
    await saveData(DB_LABS, L.id, L);
  }
}


// ==== AUTO SYNC DATA GIỮA CÁC CLIENT (POLLING) ====
async function reloadCoreData() {
  if (!state.authUser) return;
  
  // ✅ FIX: đang import thì không được reload, tránh đè state.data.items làm trùng ID/ghi đè
  if (state.ui && state.ui._centralImportBusy) return;

  try {
    const [
      items, loans, reqs, ships, labs, damages, repairs,
      shipIssues
    ] = await Promise.all([
      getAll(DB_ITEMS),
      getAll(DB_LOANS),
      getAll(DB_REQUESTS),
      getAll(DB_SHIPMENTS),
      getAll(DB_LABS),
      getAll(DB_DAMAGE_REPORTS),
      getAll(DB_REPAIRS),
      getAll(DB_SHIPMENT_ISSUES) // ✅ thêm
    ]);

    state.data.items = Object.values(items || {});
    state.data.loans = Object.values(loans || {});
    state.data.labRequests = Object.values(reqs || {}).map(r =>
      (r.shipment_id && r.status !== 'Hoàn tất')
        ? ({ ...r, status: 'Hoàn tất' })
        : r
    );
    state.data.shipments = Object.values(ships || {}).map(s => ({ ...s, items: itemsOf(s) }));
    state.data.labs = Object.values(labs || {});
    state.data.damageReports = Object.values(damages || {});
    state.data.repairs = Object.values(repairs || {});

    // ✅ QUAN TRỌNG: giữ lại key id kể cả issue cũ thiếu field id
    state.data.shipmentIssues = Object.entries(shipIssues || {}).map(([id, obj]) => ({
      id,
      ...(obj || {})
    }));

    bumpDataVersion();

    const base = baseRoute(state.route);

    
    // Nếu đang thao tác ở trang Báo hỏng (lab-repairs) thì KHÔNG render lại (tránh reset select/textarea/file)
    if (base === '#/lab-repairs') {
      const active = document.activeElement;
      if (state.ui && state.ui.rp_editing) return;
      if (active && (active.id === 'rp_item' || active.id === 'rp_desc' || active.id === 'rp_img_file')) return;
    }
      const realtimePages = [
      '#/dashboard',
      '#/lab-requests',
      '#/shipments-receive',
      '#/lab-repairs',
      '#/central-requests',
      '#/central-shipments',
      '#/central-repairs',

      // ✅ nếu bạn có trang issue central thì thêm route của bạn vào đây
      '#/central-shipment-issues',
      '#/shipment-issues'
    ];

    if (realtimePages.includes(base)) {
  renderNav();

  // ✅ tránh nhấp nháy: không renderPage() lại cho central-shipments
  if (base === '#/central-shipments') {
      renderCentralShipmentsGroups();
      return;
    }

    // ✅ tránh nhấp nháy: trang sai khác shipment chỉ cập nhật list, không dựng lại page
    if (base === '#/central-shipment-issues') {
      const active = document.activeElement;
      if (active && active.id === 'issueSearch') return; // đang gõ thì khỏi update
      renderCentralShipmentIssuesList();
      return;
    }
    // ✅ đang thao tác UI thì không render lại (tránh dropdown bị đóng sau 4s)
    if (isUiFrozen()) return;

    // ✅ nếu đang ở trang tạo yêu cầu nhận hàng và đang focus input/select thì cũng không render
    if (base === '#/lab-requests') {
      const a = document.activeElement;
      if (a && (a.id === 'rq_search' || a.id === 'rq_group' || a.id === 'rq_qty')) return;
    }

    renderPage();
  }

  } catch (e) {
    console.warn('reloadCoreData failed', e);
  }
}


function startDataSync() {
  if (_dataSyncTimer) clearInterval(_dataSyncTimer);
  // chạy 1 lần ngay lập tức
  reloadCoreData();
  // sau đó 4s chạy lại 1 lần
  _dataSyncTimer = setInterval(reloadCoreData, 4000);
}

function stopDataSync() {
  if (_dataSyncTimer) {
    clearInterval(_dataSyncTimer);
    _dataSyncTimer = null;
  }
}

// ===== Wake-up reload (tab background bị throttle, nên quay lại tab phải reload ngay) =====
let _wakeReloadHooked = false;
let _lastWakeReloadAt = 0;

function hookWakeReload() {
  if (_wakeReloadHooked) return;
  _wakeReloadHooked = true;

  const wakeReload = () => {
    const now = Date.now();
    if (now - _lastWakeReloadAt < 800) return; // debounce
    _lastWakeReloadAt = now;
    reloadCoreData(); // không await để khỏi block UI
  };

  window.addEventListener('focus', wakeReload);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wakeReload();
  });
}



// Tải thư viện decode QR (jsQR) khi cần
async function loadJs(url) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
async function ensureJsQR() {
  if (window.jsQR) return;
  await loadJs('https://unpkg.com/jsqr@1.4.0/dist/jsQR.js');
}

let _qrStream = null, _raf = 0, _lastQrData = '', _lastQrTime = 0;

async function startScan() {
  try {
    await ensureJsQR();
    const video = document.getElementById('qrVideo');
    const out = document.getElementById('qrOut');
    _qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    video.srcObject = _qrStream; await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let lastData = '';

    const tick = () => {
      if (!_qrStream) return;
      if (video.videoWidth && video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR && jsQR(img.data, canvas.width, canvas.height);

        if (code && code.data && code.data !== lastData) {
          lastData = code.data.trim();
          const target = state.ui.scanTarget || 'auto';

          if (target === 'shipment') {
            const isMatch = handleShipmentQr(lastData);
            out.textContent = 'Kết quả: ' + (isMatch ? 'Khớp' : 'Không khớp') + '\n' + 'Đã quét: ' + lastData;
            // KHÔNG stopScan → cho phép quét liên tục
          } else {
            handleQrPayload(lastData);
            stopScan();
            return;
          }
        }
      }
      _raf = requestAnimationFrame(tick);
    };
    _raf = requestAnimationFrame(tick);
  } catch (e) {
    console.error('scan error', e);
    toast('Không mở được camera. Thử Chrome hoặc kiểm tra quyền.');
  }
}

function handleShipmentQr(text) {
  const serial = extractSerialFromText(text);
  state.ui.shipScanLast = serial;

  const shId = state.ui.shipReceiveScanShipment;
  if (!shId) { toast('Không xác định được shipment đang quét'); return false; }

  // lưu lịch sử đã quét (để đối soát)
  state.ui.shipReceiveScannedSerials = state.ui.shipReceiveScannedSerials || {};
  const scanned = state.ui.shipReceiveScannedSerials[shId] || (state.ui.shipReceiveScannedSerials[shId] = []);
  if (serial && !scanned.includes(serial)) scanned.push(serial);

  const s = (state.data.shipments || []).find(x => x.id === shId);
  if (!s) { toast('Không tìm thấy shipment'); return false; }

  const ids = Array.isArray(s.item_ids) ? s.item_ids : (s.items || []).map(x => x.id);
  const matched = (state.data.items || []).find(it => ids.includes(it.id) && (it.serial || '').trim() === serial.trim());

  const isMatch = !!matched;
  state.ui.shipScanLastMatch = isMatch;

  if (matched) {
    markShipmentItem(shId, matched.id, 'ok');
    toast(`✓ ${serial} (${matched.asset_name || matched.name})`);
  } else {
    markShipmentExtra(shId, serial);
    toast(`✗ ${serial} • Ngoài shipment`);
  }
  return isMatch;
}




function extractSerialFromText(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    if (j.serial) return j.serial;
    if (j.id) {
      const it = (state.data.items || []).find(i => i.id === j.id);
      return it?.serial || '';
    }
  } catch { }
  const s = String(text || '').trim();
  const m = s.match(/Serial\s*:\s*([A-Za-z0-9\-]+)/i);
  if (m) return m[1];
  return s;
}






function stopScan() {
  if (_raf) cancelAnimationFrame(_raf), _raf = 0;
  if (_qrStream) { _qrStream.getTracks().forEach(t => t.stop()); _qrStream = null; }
}

function handleQrPayload(text) {
  const fillAndGo = (serial) => {
    if (!serial) { toast('Không tìm được serial từ QR'); return; }
    const s = String(serial).trim();

    // ưu tiên target do người dùng chọn trước khi vào scan
    const target = state.ui.scanTarget || 'auto';
        if (target === 'repair_pick') {
      const it = (state.data.items || []).find(x =>
        x && String(x.serial || '').trim() === s && x.lab_id === state.labId
      );

      if (!it) { toast('QR này không thuộc thiết bị của Lab'); return; }

      const selEl = document.getElementById('rp_item');
      if (selEl) selEl.value = it.id;

      closeScanModal();

      const descEl = document.getElementById('rp_desc');
      if (descEl) descEl.focus();
      return;
    }
        if (target === 'shipment') {
      const shId = state.ui.shipReceiveScanShipment;
      if (!shId) {
        toast && toast('Không xác định được shipment cần nhận.');
      } else {
        markShipmentScan(shId, s);
      }
      return;
    }

    if (target === 'return') {
      state.ui.pendingReturnSerial = s;
      navigate('#/lab-returns');
    } else if (target === 'loan') {
      state.ui.pendingSerial = s;
      navigate('#/lab-handover');
    } else {
      // auto: nếu đang ở returns thì trả, ngược lại mượn
      if (state.route === '#/lab-returns') {
        state.ui.pendingReturnSerial = s;
        navigate('#/lab-returns');
      } else {
        state.ui.pendingSerial = s;
        navigate('#/lab-handover');
      }
    }
  };

  // URL: http(s)://.../#/item?id=...
  if (/^https?:\/\//i.test(text || '')) {
    try {
      const u = new URL(text);
      let id = null;
      const m = (u.hash || '').match(/#\/item\?id=([^&]+)/);
      if (m) id = decodeURIComponent(m[1]);
      if (!id) id = u.searchParams.get('id');
      if (id) {
        const it = state.data.items.find(i => i.id === id);
        if (it?.serial) { fillAndGo(it.serial); return; }
        navigate(`#/item?id=${id}`); return;
      }
    } catch { }
  }

  // JSON: {"id":"...","serial":"..."}
  try {
    const j = JSON.parse(text);
    if (j.serial) { fillAndGo(j.serial); return; }
    if (j.id) {
      const it = state.data.items.find(i => i.id === j.id);
      if (it?.serial) { fillAndGo(it.serial); return; }
      navigate(`#/item?id=${j.id}`); return;
    }
  } catch { }

  // TEXT nhiều dòng: “Serial: …”
  const s = String(text || '');
  const mSerial = s.match(/Serial\s*:\s*([A-Za-z0-9\-]+)/i);
  if (mSerial) { fillAndGo(mSerial[1]); return; }

  const mId = s.match(/ID\s*:\s*([A-Za-z0-9\-]+)/i);
  if (mId) {
    const it = state.data.items.find(i => i.id === mId[1]);
    if (it?.serial) { fillAndGo(it.serial); return; }
  }

  // cuối cùng coi như 1 token là serial
  if (!/\n/.test(s) && /\w/.test(s)) { fillAndGo(s.trim()); return; }

  toast('QR không hợp lệ hoặc không nhận dạng được.');
}

function goScan(target = 'auto') {
  state.ui.scanTarget = target;        // nhớ mục tiêu: loan/return/auto
  navigate('#/scan');
}

/***** URL QUERY HELPERS *****/
function getQuery() { try { return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || '')); } catch (e) { return {}; } }

/***** PAGES *****/
const PAGES = {
  '#/dashboard': () => {
    const centralStock = state.data.items.filter(i => i.state === 'available@central').length;
    const labStockMine = state.data.items.filter(i => i.state === 'available@lab' && i.lab_id === state.labId).length;
    const labsStockAll = state.data.items.filter(i => i.state === 'available@lab').length;
    const loansOpen = state.data.loans.filter(l => !l.returned_at).length;
    const quick = state.role === 'lab'
      ? `<button class="btn" onclick="navigate('#/lab-handover')">➕ Tạo loan</button>
         <button class="btn" onclick="navigate('#/lab-requests')">📝 Yêu cầu hàng</button>`
      : `<button class="btn" onclick="navigate('#/central-requests')">✅ Duyệt yêu cầu</button>
         <button class="btn" onclick="navigate('#/central-shipments')">🚚 Quản lý shipment</button>`;
    const secondCard = (state.role === 'lab')
      ? `<div class="card sm-4"><div class="kpi"><div class="num">${labStockMine}</div><div><div class="tag">Lab ${state.labId}</div><div class="muted-2">Thiết bị có sẵn</div></div></div></div>`
      : `<div class="card sm-4" style="cursor:pointer" onclick="navigate('#/labs')">
          <div class="kpi"><div class="num">${labsStockAll}</div>
          <div><div class="tag">Phòng Lab</div><div class="muted-2">Thiết bị có sẵn</div></div>
          </div>
          </div>`;
    return `
    <div class="cards">
          <div class="card sm-4" style="cursor:pointer" onclick="navigate('#/central-stock')">
      <div class="kpi">
        <div class="num">${centralStock}</div>
        <div>
          <div class="tag">Kho trung tâm</div>
          <div class="muted-2">Thiết bị có sẵn</div>
        </div>
      </div>
    </div>

      ${secondCard}
       <div class="card sm-4"><div class="kpi"><div class="num">${loansOpen}</div><div><div class="tag">Thiết bị </div><div class="muted-2"> đang mượn</div></div></div></div>
      <div class="card sm-8" id="recentActivityCard">
        <h1>Hoạt động gần đây</h1>
        ${state.role === 'lab'
        ? renderRecentActivity(7, state.ui.activityFilter)
        : renderCentralActivity(7, state.ui.centralActivityFilter)
      }
      </div>
      <div class="card sm-4"><h2>Nhanh</h2><div class="toolbar">${quick}</div></div>
    </div>`;
  },

  '#/lab-inventory': () => {
    const labId = state.labId;
    const groups = labStockGroups(labId);

    // tất cả item thuộc lab
    const labItems = (state.data.items || []).filter(it => it && it.lab_id === labId);

    // nếu key đang chọn không còn trong groups -> reset về "tất cả"
    if (state.ui.labInv_selectedKey && !groups.find(g => g.key === state.ui.labInv_selectedKey)) {
      state.ui.labInv_selectedKey = '';
    }

    const searchText = state.ui.labInv_filter || '';

    const selectedGroup = state.ui.labInv_selectedKey
      ? groups.find(g => g.key === state.ui.labInv_selectedKey)
      : null;

    // ===== HEADER: tiêu đề + ô search + dropdown =====
    const optionsHtml = groups.map(g => {
      const sel = (selectedGroup && g.key === selectedGroup.key) ? 'selected' : '';
      const safeVal = g.key.replace(/'/g, "\\'");
      return `<option value='${safeVal}' ${sel}>${esc(g.asset_code)} – ${esc(g.asset_name)}</option>`;
    }).join('');

    const headerHtml = `
      <div style="display:flex;flex-direction:column;gap:8px">
        <h1 style="margin:0">Tồn kho Lab ${labId}</h1>
        <div class="grid cols-2" style="gap:12px;max-width:900px">
          <div>
            <label class="muted-2">Tìm thiết bị</label>
            <input
              id="labInvSearch"
              placeholder="Gõ để lọc..."
              value="${state.ui.labInv_filter || ''}"
              oninput="setLabInvFilter(this.value)"
            />

          </div>
          <div>
            <label class="muted-2">Chọn thiết bị</label>
            ${groups.length
        ? `<select
                     id="labInvSelect"
                     onchange="setLabInvGroup(this.value)"
                     style="width:100%;max-width:100%;background:#0c121d">
                     <option value="" ${selectedGroup ? '' : 'selected'}>(Tất cả thiết bị của Lab)</option>
                     ${optionsHtml}
                   </select>`
        : `<span class="muted-2">(Chưa có thiết bị)</span>`
      }
          </div>
        </div>
      </div>
    `;

    // ===== LỌC THEO NHÓM =====
    let filtered = labItems;
    if (selectedGroup) {
      filtered = filtered.filter(it => {
        const code = it.asset_code || it.assetCode || '(không mã)';
        const name = it.asset_name || it.name || '(chưa đặt tên)';
        return (code === selectedGroup.asset_code && name === selectedGroup.asset_name);
      });
    }

    // ===== LỌC THEO TỪ KHOÁ (nhiều chữ, không dấu) =====
    const tokens = normalizeText(searchText).split(/\s+/).filter(Boolean);
    if (tokens.length) {
      filtered = filtered.filter(it => {
        const serial = it.serial;
        const name = it.asset_name || it.name;
        const code = it.asset_code || it.assetCode;
        const typeNm = typeName(it.type_id);
        const haystack = normalizeText([serial, name, code, typeNm].join(' '));
        return tokens.every(t => haystack.includes(t));
      });
    }

    // ===== PHÂN TRANG 7 MỤC / TRANG =====
    const pageSize = 7;
    const pageInfo = paginate(filtered, state.ui.labInvPage || 1, pageSize);
    state.ui.labInvPage = pageInfo.page;

    const rowsHtml = pageInfo.rows.map(it => {
      const st = itemStatePill(it.state);
      const typeNm = typeName(it.type_id);

      return `
        <tr>
          <td>${esc(it.serial || '-')}</td>
          <td>${esc(it.asset_name || it.name || '')}</td>
          <td>${esc(typeNm)}</td>
          <td>${st}</td>
          <td class="toolbar">
            <button class="btn" onclick="viewCentralItem('${it.id}')">Xem</button>
          </td>
        </tr>
      `;
    }).join('') || `
      <tr>
        <td colspan="5" class="muted-2">(Không có thiết bị phù hợp)</td>
      </tr>
    `;

    // ===== DÒNG TỔNG QUAN =====
    const totalAll = labItems.length;
    const availAll = labItems.filter(it => it.state === 'available@lab').length;
    const onLoanAll = labItems.filter(it => it.state === 'on_loan').length;

    let infoLine;
    if (selectedGroup) {
      infoLine = `
        <div class="muted-2" style="margin-top:6px">
          Nhóm: <b>${esc(selectedGroup.asset_name)}</b> (Mã <b>${esc(selectedGroup.asset_code)}</b>) ·
          Tổng: <b>${selectedGroup.total}</b> ·
          Thiết bị có sẵn: <b>${selectedGroup.available}</b> ·
          Đang mượn: <b>${selectedGroup.on_loan}</b>
        </div>
      `;
    } else {
      infoLine = `
        <div class="muted-2" style="margin-top:6px">
          (Tất cả thiết bị của Lab) ·
          Tổng: <b>${totalAll}</b> ·
          Thiết bị có sẵn: <b>${availAll}</b> ·
          Đang mượn: <b>${onLoanAll}</b>
        </div>
      `;
    }

    // ===== PHÂN TRANG FOOTER =====
    const pagingHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="muted-2" style="font-size:12px">
          Trang ${pageInfo.page} / ${pageInfo.totalPages} — Tổng ${pageInfo.totalItems}
        </span>
        <div class="toolbar">
          <button class="btn" onclick="changeLabInvPage(-1)" ${pageInfo.page <= 1 ? 'disabled' : ''}>← Trước</button>
          <button class="btn" onclick="changeLabInvPage(1)" ${pageInfo.page >= pageInfo.totalPages ? 'disabled' : ''}>Sau →</button>
        </div>
      </div>
    `;

    return `
      <div class="card">
        ${headerHtml}
        ${infoLine}
        <table style="margin-top:12px">
          <thead>
            <tr>
              <th style="width:140px">Serial</th>
              <th>Tên thiết bị</th>
              <th style="width:140px">Loại</th>
              <th style="width:160px">Trạng thái</th>
              <th style="width:110px"></th>
            </tr>
          </thead>
          <tbody id="labInvTableBody">
            ${rowsHtml}
          </tbody>
        </table>
        ${pagingHtml}
      </div>
    `;
  },





  '#/lab-handover': () => `
  <div class="cards">
    <div class="card sm-6">
      <h1>Giao phát (mượn)</h1>

      <div class="grid cols-2">
        <div>
          <label>MSSV</label>
          <input id="hv_mssv" placeholder="VD: 20123456" />
        </div>

        <div>
          <label>QR thiết bị (serial)</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input
              id="hv_serial"
              placeholder="VD: LAP-1001"
              style="flex:1"
            />
            <button
              class="btn"
              onclick="goScan('loan')"
              style="padding:4px 10px;font-size:12px;white-space:nowrap;min-width:auto"
            >
              📷 Quét QR
            </button>
          </div>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:10px">
        <div>
          <label>Hạn trả (ngày)</label>
          <input id="hv_days" type="number" min="1" max="30" value="7" />
        </div>
        <div>
          <label>Ghi chú</label>
          <input id="hv_note" placeholder="(tuỳ chọn)" />
        </div>
      </div>

      <div class="toolbar" style="margin-top:12px">
        <button class="btn primary" onclick="createLoan()">Xác nhận</button>
      </div>

    </div>

    <div class="card sm-6">
      <h2>Loans đang mở</h2>
      <div id="loansOpen"></div>
    </div>
  </div>
`,


  '#/lab-returns': () => `
    <div class="cards">
      <div class="card sm-6">
        <h1>Thu hồi (trả)</h1>

        <div>
          <label>QR thiết bị (serial)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input
              id="rt_serial"
              placeholder="VD: LAP-1001"
              style="flex:1"
            />
            <button
              class="btn"
              style="flex:0 0 auto;padding:0 12px;white-space:nowrap"
              onclick="goScan('return')"
            >
              📷 Quét QR
            </button>
          </div>
        </div>

        <div class="toolbar" style="margin-top:12px;justify-content:flex-start">
          <button class="btn primary" onclick="showReturnConfirm()">Xác nhận</button>
        </div>

        <!-- nơi vẽ bảng xác nhận sau khi bấm Xác nhận trả -->
        <div id="returnConfirmBox" style="margin-top:12px"></div>
      </div>

      <div class="card sm-6">
      <h2>Lịch sử gần đây</h2>
      <div id="loansHistory"></div>
      <!-- chi tiết loan khi bấm nút Xem -->
      <div id="loanHistoryDetail" style="margin-top:12px"></div>
      </div>
    </div>
  `,


  
  '#/lab-requests': () => {
    // Dropdown các tài sản từ kho trung tâm
    const optionsHtml = buildRequestItemOptions();

  // Tính max hiển thị ban đầu (Tối đa X) = available - đã draft
  let previewMax = 0;
  const selKey = (state.ui && state.ui.rq_selectedKey) ? state.ui.rq_selectedKey : '';
  if (selKey) {
    const { code, name } = parseSelectedKey(selKey);
    const grp = getSelectedGroup(selKey);
    const maxAvail = grp ? (grp.available || 0) : 0;

    const draftLine = (state.ui.draftReqLines || []).find(l =>
      l.asset_code === code && l.asset_name === name
    );
    const already = draftLine ? (draftLine.qty_requested || 0) : 0;

    previewMax = Math.max(0, maxAvail - already);
  }


    // Bảng nháp các dòng Lab sắp yêu cầu
    const draftRows = (state.ui.draftReqLines || []).map((l, idx) => `
    <tr>
      <td>${l.asset_code} - ${l.asset_name}</td>
      <td>${l.qty_requested || 0}</td>
      <td style="text-align:right">
        <button class="btn danger" onclick="removeDraftLine(${idx})">X</button>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="3" class="muted-2">(Chưa có dòng nào)</td>
    </tr>
  `;


            // Lịch sử yêu cầu đã gửi của Lab này (mới nhất lên trên + phân trang)
    const reqAll = (state.data.labRequests || [])
      .filter(r => r.lab_id === state.labId)
      .sort((a, b) => toTS(b.created_at) - toTS(a.created_at));

    const perPageReq = 7;
    const totalReqPages = Math.max(1, Math.ceil(reqAll.length / perPageReq));

    let reqPage = state.ui.labReqHistoryPage || 1;
    if (reqPage < 1) reqPage = 1;
    if (reqPage > totalReqPages) reqPage = totalReqPages;
    state.ui.labReqHistoryPage = reqPage;

    const reqSlice = reqAll.slice((reqPage - 1) * perPageReq, reqPage * perPageReq);

    const reqRows = (reqSlice || [])
      .map(r => {
        const isOpen =
          !!(state.ui.labReqDetailsOpen && state.ui.labReqDetailsOpen[r.id]);
        const detailsClass = isOpen ? '' : 'hidden';

        const detailRows = (r.lines || []).map(l => `
          <tr>
            <td>${l.asset_code || ''}</td>
            <td>${l.asset_name || ''}</td>
            <td style="text-align:right;">${l.qty_requested || 0}</td>
          </tr>
        `).join('') || `
          <tr>
            <td colspan="3" class="muted-2">(Không có dòng nào)</td>
          </tr>
        `;

        const stText = r.status || 'Đang chờ';
const pillCls =
  (stText === 'Hoàn tất') ? 'ok'
  : (stText === 'Đang chờ') ? 'bad'
  : 'warn';

return `
<tr>
  <td>${r.id}</td>
  <td><span class="pill ${pillCls}">${stText}</span></td>
  <td>
    <button class="btn" onclick="toggleLabRequestDetails('${r.id}')">
      ${isOpen ? 'Ẩn' : 'Xem'}
    </button>
  </td>
  <td>${r.created_at || '-'}</td>
  <td>${r.approved_at || '-'}</td>
</tr>
<tr id="labReqDetails-${r.id}" class="${detailsClass}">
  <td colspan="5">
    <div style="margin-top:8px;">
      <table style="width:100%;font-size:13px;">
                <thead>
                  <tr>
                    <th style="text-align:left;">Mã thiết bị</th>
                    <th style="text-align:left;">Tên thiết bị</th>
                    <th style="text-align:right;">Số lượng yêu cầu</th>
                  </tr>
                </thead>
                <tbody>
                  ${detailRows}
                </tbody>
              </table>
            </div>
          </td>
        </tr>`;
      }).join('') || `
      <tr>
        <td colspan="5" class="muted-2">(Chưa có yêu cầu)</td>
      </tr>
    `;

    const reqPager = (reqAll.length <= perPageReq) ? '' : `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:10px">
        <div class="muted-2" style="font-size:12px">
          Trang ${reqPage} / ${totalReqPages} • Tổng ${reqAll.length}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="changeLabReqHistoryPage(-1)" ${reqPage <= 1 ? 'disabled' : ''}>← Trước</button>
          <button class="btn" onclick="changeLabReqHistoryPage(1)" ${reqPage >= totalReqPages ? 'disabled' : ''}>Sau →</button>
        </div>
      </div>
    `;




    // Trả HTML cho trang
    return `
    <div class="cards">
            <!-- Cột trái: tạo yêu cầu -->
      <div class="card sm-6">
        <h1>Tạo yêu cầu nhận hàng</h1>

        <label>Nhóm thiết bị trong kho trung tâm</label>
        <input
          id="rq_search"
          placeholder="Nhập để tìm..."
          value="${state.ui.rq_searchTerm || ''}"
          oninput="onRqSearchInput(this.value)"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />


        <div style="margin-top:8px">
          <select
            id="rq_type"
            onchange="onReqTypeChange()"
            style="width:100%;max-width:100%;"
          >
            ${optionsHtml}
          </select>
        </div>


        <div style="margin-top:16px">
  <!-- Hàng chính: Số lượng + nút Thêm -->
  <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap">
    <div>
      <label for="rq_qty">
        Số lượng
        <span
          id="rq_hint"
          class="muted-2"
          style="margin-left:8px;font-weight:400;"
        >
          (Tối đa ${previewMax || 0})
        </span>
      </label>
      <input
        id="rq_qty"
        type="number"
        min="1"
        value="${state.ui.rq_qty ?? 1}"
        oninput="onRqQtyInput(this.value)"
        style="max-width:140px;width:100%;"
      />
    </div>

    <div>
       <button class="btn" onclick="addDraftLine()">Thêm</button>
    </div>
  </div>

  <!-- Dòng chú thích nhỏ bên dưới -->
  <div class="muted-2" style="margin-top:4px;max-width:500px">
    * Danh sách trên chỉ hiển thị các nhóm hiện còn trạng thái <code>available@central</code>.
  </div>
</div>

        <h2 style="margin-top:16px">Danh sách sẽ yêu cầu</h2>

        <table>
          <thead>
            <tr>
              <th>Loại</th>
              <th style="width:120px">Số lượng</th>
              <th style="width:1%"></th>
            </tr>
          </thead>
          <tbody>
            ${draftRows}
          </tbody>
        </table>

        <div class="toolbar" style="margin-top:12px; gap:8px; display:flex">
          <button class="btn primary" onclick="submitDraftRequest()">Gửi yêu cầu</button>
          <button class="btn" onclick="clearDraftLines()">Xoá hết</button>
        </div>
      </div>

      <!-- Cột phải: lịch sử -->
      <div class="card sm-6">
        <h2>Yêu cầu của Lab ${state.labId}</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Trạng thái</th>
              <th>Chi tiết</th>
              <th>Thời gian yêu cầu</th>
              <th>Thời gian duyệt</th>
            </tr>
          </thead>
          <tbody>
            ${reqRows}
          </tbody>
        </table>
        ${reqPager}
      </div>
    </div>
  `;
},





'#/shipments-receive': () => {
  // dùng fmtDT/toTS nếu bạn đã thêm; nếu chưa có thì fallback
  const fmt = (typeof fmtDT === 'function')
    ? fmtDT
    : (t => t ? new Date(t).toLocaleString('vi-VN', { hour12: false }) : '');

  // chỉ shipment gửi VỀ lab hiện tại + sort mới nhất lên trên
  const inboundAll = (state.data.shipments || [])
    .filter(s => s.to_lab_id === state.labId)
    .sort((a, b) => {
      const ta = (typeof toTS === 'function') ? toTS(a.created_at) : (new Date(a.created_at || 0).getTime() || 0);
      const tb = (typeof toTS === 'function') ? toTS(b.created_at) : (new Date(b.created_at || 0).getTime() || 0);
      return tb - ta;
    });

  // pagination
  const perPage = 7;
  const totalPages = Math.max(1, Math.ceil(inboundAll.length / perPage));

  let page = state.ui.shipReceivePage || 1;
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  state.ui.shipReceivePage = page;

  const start = (page - 1) * perPage;
  const inbound = inboundAll.slice(start, start + perPage);

  const rows = inbound.map(s => {
    const items = shipmentItemsDetailed(s);
    const names = items.map(i => i.name || i.serial || i.id);
    const nameShort = names.length
      ? (names.slice(0, 2).join(', ') + (names.length > 2 ? ', …' : ''))
      : '(Không có thiết bị)';
    const qty = items.length || s.qty || 0;

    // Trạng thái nhận (riêng với lab)
    const meta = s.receive_meta || {};
    let recvStatus = '';
    if (meta.missing_item_ids && meta.missing_item_ids.length) {
      recvStatus = 'Đã báo sai khác';
    } else if (s.received_at) {
      recvStatus = 'Đã nhận';
    } else {
      recvStatus = 'Chưa xử lý';
    }
    const pillCls =
  (recvStatus === 'Đã nhận') ? 'ok'
  : (recvStatus === 'Đã báo sai khác') ? 'warn'
  : 'bad'; // Chưa xử lý


      let typeLabel = 'Cấp từ kho trung tâm';

    // nếu có chuyển từ lab khác sang lab hiện tại (Lab → Lab)
    if (s.from_lab_id && s.from_lab_id !== 'CENTRAL') {
      typeLabel = `Chuyển từ ${s.from_lab_id}`;
    }
    

    return `
      <tr>
        <td>${s.id}</td>
        <td>
          <div><b>${nameShort}</b></div>
          <div class="muted-2" style="font-size:12px">${typeLabel}</div>
        </td>
        <td>${qty} ${qty === 1 ? 'item' : 'items'}</td>
        <td>${fmt(s.created_at)}</td>
        <td><span class="pill ${pillCls}">${recvStatus}</span></td>

        
        <td>
          <button
            class="btn"
            type="button"
            onclick="event.preventDefault(); event.stopPropagation(); openShipmentReceivePopup('${s.id}'); return false;">
            Xem
          </button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="6" class="muted-2">(Không có shipment)</td></tr>`;

  return `
    <div class="card">
      <h1>Nhận Shipment</h1>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Thiết bị / Loại</th>
            <th>Số lượng</th>
            <th>Tạo lúc</th>
            <th>Trạng thái</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span class="muted-2" style="font-size:12px">
          Trang ${page} / ${totalPages} — Tổng ${inboundAll.length}
        </span>
        <div style="display:flex;gap:6px">
          <button class="btn" type="button" onclick="changeShipReceivePage(-1)" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
          <button class="btn" type="button" onclick="changeShipReceivePage(1)" ${page >= totalPages ? 'disabled' : ''}>Sau →</button>
        </div>
      </div>
    </div>
  `;
},


'#/lab-repairs': () => {
  // list thiết bị thuộc lab hiện tại
  const mine = (state.data.items || []).filter(it =>
    it.lab_id === state.labId &&
    (it.state === 'available@lab' || it.state === 'on_loan' || it.state === 'broken')
  );

  const options = mine.map(it => `
    <option value="${it.id}">
      ${it.serial || it.id} – ${it.asset_code || ''} ${it.asset_name || it.name || ''}
    </option>
  `).join('') || `<option value="">(Lab chưa có thiết bị)</option>`;

  // list phiếu hỏng của lab này (sort mới nhất lên trước)
  const repairsAll = (state.data.repairs || [])
    .filter(r => r.lab_id === state.labId)
    .sort((a, b) => (b.created_at_ts || 0) - (a.created_at_ts || 0));

  // pagination 7 dòng / trang
  const pg = pagedList(repairsAll, 'labRepairsPage', 7);
  const list = pg.rows || [];

  const rows = list.map(r => {
    const pillCls =
      (r.status === 'returned_after_repair' || r.status === 'approved_on_site' || r.status === 'Hoàn tất') ? 'ok'
        : (r.status === 'Yêu cầu gửi về kho' || r.status === 'in_transit_to_central') ? 'warn'
          : 'bad';

    let action = `<span class="muted-2">-</span>`;

    if (r.status === 'Yêu cầu gửi về kho') {
      action = `
        <button class="btn primary" style="padding:6px 10px;font-size:12px"
          onclick="labSendRepairToCentral('${r.id}')">
          Gửi về Central
        </button>
      `;
    } else if (r.status === 'approved_on_site') {
      action = `
        <button class="btn ok" style="padding:6px 10px;font-size:12px"
          onclick="labMarkRepairDone('${r.id}')">
          Done
        </button>
      `;
    }
      const stRaw  = (r.status || 'Đang chờ');
      const stText = (stRaw === 'completed') ? 'Hoàn tất' : stRaw;

    return `
      <tr>
        <td>${r.id}</td>
        <td>${r.serial || r.item_id}</td>
        <td>${r.description || ''}</td>
        <td>
          <span class="pill ${pillCls}">
            ${stText}
          </span>
        </td>
        <td style="text-align:right">${action}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="5" class="muted-2">(Chưa có báo hỏng)</td></tr>`;

  const pagerHtml = (pg.totalItems > 0) ? `
    <div class="muted-2" style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>Trang ${pg.page} / ${pg.totalPages} • Tổng ${pg.totalItems}</div>
      <div style="display:flex;gap:10px">
        <button class="btn" onclick="changeLabRepairsPage(-1)" ${pg.page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="changeLabRepairsPage(1)" ${pg.page >= pg.totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="cards">
      <div class="card sm-4">
        <h1>Báo hỏng thiết bị</h1>
        <label>Thiết bị</label>
        <div class="toolbar" style="gap:8px;align-items:center">
          <select id="rp_item" style="flex:1;min-width:0">${options}</select>
          <button class="btn" type="button"
            onclick="openRepairPickScan()"
            style="padding:6px 10px;font-size:12px">
            Quét QR
          </button>
        </div>

        <label>Mô tả lỗi</label>
        <textarea id="rp_desc" placeholder="VD: không lên nguồn, vỏ nứt, hiển thị sai..."></textarea>

        <button class="btn primary" style="margin-top:12px" onclick="submitRepairFromLab()">Gửi báo hỏng</button>
      </div>

      <div class="card sm-8">
        <h1>Phiếu báo hỏng của Lab</h1>
        <table>
          <thead><tr><th>ID</th><th>Thiết bị</th><th>Mô tả</th><th>Trạng thái</th><th style="text-align:right">Hành động</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${pagerHtml}
      </div>
    </div>
  `;
},







'#/central-add': () => {
    if (state.role !== 'central') {
      return `
      <div class="card">
        <h1>Thêm thiết bị</h1>
        <p class="muted">Chỉ Central Admin có quyền.</p>
      </div>`;
    }

    return `
    <div class="cards">
      <!-- CỘT TRÁI: FORM NHẬP -->
      <div class="card sm-6">
        <h1>Thêm tài sản vào kho trung tâm</h1>

        <!-- PHẦN 1: Định danh thiết bị -->
        <div style="margin-top:16px">
          <div class="muted-2" style="font-size:12px;font-weight:600;margin-bottom:6px">
            Định danh
          </div>

          <div class="grid cols-1" style="gap:12px">
            <div>
              <label>Serial / Mã duy nhất (để trống sẽ tự sinh)</label>
              <input id="addd_serial" placeholder="VD: EQ-1001" />
            </div>
          </div>
        </div>

        <!-- PHẦN 2: Thông tin ghi sổ -->
        <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:16px;margin-top:16px">
          <div class="muted-2" style="font-size:12px;font-weight:600;margin-bottom:6px">
            Thông tin ghi sổ
          </div>

          <div class="grid cols-2" style="gap:12px">
            <div>
              <label>Số hiệu tài sản</label>
              <input id="addd_assetcode" placeholder="VD: 10401" />
            </div>

            <div>
              <label>Năm sử dụng</label>
              <input id="addd_year" placeholder="2019" />
            </div>
          </div>

          <div class="grid cols-2" style="gap:12px">
           <div>
            <label>Tên tài sản</label>
            <input id="addd_name" placeholder="Máy tính bộ LCD 22&quot; Asus" />
          </div>
          <div>
            <label>Số lượng (tạo bao nhiêu chiếc giống nhau)</label>
            <input id="addd_qty" type="number" min="1" value="1" />
          </div>
          </div>
        </div>

        <!-- PHẦN 3: Thông tin kỹ thuật -->
        <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:16px;margin-top:16px">
          <div class="muted-2" style="font-size:12px;font-weight:600;margin-bottom:6px">
            Thông tin kỹ thuật
          </div>

          <div class="grid cols-2" style="gap:12px">
            <div>
              <label>Hãng sản xuất</label>
              <input id="addd_mfg" placeholder="Dell / Tektronix / Canon..." />
            </div>

            <div>
              <label>Model</label>
              <input id="addd_model" placeholder="Latitude 5520 / TBS1102B..." />
            </div>
          </div>

          <div class="grid cols-2" style="gap:12px; margin-top:12px">
            <div>
              <label>Tình trạng / % hao mòn</label>
              <input id="addd_condition" placeholder="Mới / hao mòn 10%" />
            </div>

            <div>
              <label>Nguồn</label>
              <input id="addd_source" placeholder="DA / Đề án / Viện trợ..." />
            </div>
          </div>

          <div style="margin-top:12px">
            <label>Thông số</label>
            <textarea id="addd_specs" placeholder="Core i7, DDR4 8GB, HDD 1TB, Việt Nam..."></textarea>
          </div>

          <div style="margin-top:12px">
            <label>Ghi chú</label>
            <input id="addd_notes" placeholder="Giao cho bộ môn A..." />
          </div>
        </div>

        <div class="toolbar" style="margin-top:16px">
          <button class="btn primary" onclick="addCentralItemDetailed()">
            Thêm & tạo QR
          </button>
        </div>
      </div>

      <!-- CỘT PHẢI: QR preview -->
      <div class="card sm-6">
        <h2>QR xem nhanh (sinh sau khi thêm)</h2>
        <div id="qrPreviewAdd"
             style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap"></div>
      </div>
    </div>`;
  },



  '#/item': () => {
    const q = getQuery();
    const id = q.id || null, serial = q.serial || null;
    let it = null;
    if (id) it = state.data.items.find(x => x.id === id);
    if (!it && serial) it = state.data.items.find(x => x.serial === serial);
    if (!it) return `<div class="card"><h1>Thiết bị</h1><p class="muted">Không tìm thấy thiết bị.</p></div>`;
    const meta = `
      <table>
        <tr><th style="width:180px">Serial</th><td>${it.serial || ''}</td></tr>
        <tr><th>Loại</th><td>${typeName(it.type_id)}</td></tr>
        <tr><th>Tên/Mô tả</th><td>${it.name || ''}</td></tr>
        <tr><th>Hãng</th><td>${it.mfg || ''}</td></tr>
        <tr><th>Model</th><td>${it.model || ''}</td></tr>
        <tr><th>Tình trạng</th><td>${it.condition || ''}</td></tr>
        <tr><th>Thông số</th><td>${(it.specs || '').replaceAll('\\n', '<br/>')}</td></tr>
        <tr><th>Ngày mua</th><td>${it.purchase_date || ''}</td></tr>
        <tr><th>Hết BH</th><td>${it.warranty_end || ''}</td></tr>
        <tr><th>Ghi chú</th><td>${it.notes || ''}</td></tr>
        <tr><th>Trạng thái kho</th><td>${it.state || ''}${it.lab_id ? (' • Lab: ' + it.lab_id) : ''}</td></tr>
      </table>`;
    const qr = it.qr_png ? `<img src="${it.qr_png}" alt="QR" style="width:180px;height:180px;border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px;background:#0c121d"/>` : '<span class="muted-2">(Chưa có QR)</span>';
    return `<div class="cards">
      <div class="card sm-8">
        <h1>Thông tin thiết bị</h1>
        ${meta}
      </div>
      <div class="card sm-4">
        <h2>Mã QR</h2>
        ${qr}
        <p class="muted">Quét mã để mở trang này trên điện thoại.</p>
      </div>
    </div>`;
  },

'#/central-stock': () => {
  if (state.role !== 'central') {
    return `<div class="card"><h1>Kho trung tâm</h1><p class="muted">Chỉ Central xem được.</p></div>`;
  }

  // ===== 1) Gom nhóm + sort + paging =====
  const groupsArr = centralStockGroups();
  groupsArr.sort((a, b) => {
    const ac = String(a.asset_code || '').localeCompare(String(b.asset_code || ''), 'vi');
    if (ac !== 0) return ac;
    return String(a.asset_name || '').localeCompare(String(b.asset_name || ''), 'vi');
  });

  const PER_PAGE = 10;
  const curPage = Math.max(1, parseInt(state.ui.centralStockPage || '1', 10) || 1);
  const totalPages = Math.max(1, Math.ceil(groupsArr.length / PER_PAGE));
  const safeCurPage = Math.min(curPage, totalPages);
  state.ui.centralStockPage = safeCurPage;

  const start = (safeCurPage - 1) * PER_PAGE;
  const pageGroups = groupsArr.slice(start, start + PER_PAGE);

  // ===== 2) Render rows (click => mở modal) =====
  const sumRows = pageGroups.map(g => {
    const key = (g.asset_code || '(không mã)') + '::' + (g.asset_name || '(không tên)');
    const safeKey = encodeURIComponent(key);

    return `
      <tr class="row-click" onclick="openCentralStockGroupModal('${safeKey}')">
        <td>${g.asset_code}</td>
        <td>${g.asset_name}</td>
        <td>${g.available}</td>
        <td>${g.in_transit}</td>
      </tr>
    `;
  }).join('') || `
    <tr><td colspan="4" class="muted-2">(Chưa có dữ liệu)</td></tr>
  `;

  return `
    <div class="cards">
      <div class="card sm-12">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <h1>Kho trung tâm </h1>

          <div class="toolbar">
            <button class="btn primary" onclick="navigate('#/central-add')">+ Thêm</button>
            <button class="btn primary" onclick="navigate('#/central-import')">📥 Import</button>
            <button class="btn primary" onclick="exportInventoryReport()">📦 Xuất tồn kho</button>
            <button class="btn primary" onclick="openPrintQrModal()">🖨️ In QR</button>          
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Số hiệu tài sản</th>
              <th>Tên tài sản</th>
              <th>Thiết bị có sẵn</th>
              <th>Thiết bị đang giao</th>
            </tr>
          </thead>
          <tbody>
            ${sumRows}
          </tbody>
        </table>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <span class="muted-2" style="font-size:12px">
            Trang ${safeCurPage} / ${totalPages} • Tổng ${groupsArr.length} nhóm
          </span>
          <div style="display:flex;gap:6px">
            <button class="btn" onclick="changeCentralStockPage(-1)" ${safeCurPage <= 1 ? 'disabled' : ''}>← Trước</button>
            <button class="btn" onclick="changeCentralStockPage(1)" ${safeCurPage >= totalPages ? 'disabled' : ''}>Sau →</button>
          </div>
        </div>
      </div>
    </div>
  `;
},


'#/central-requests': () => {
    if (state.role !== 'central') {
      return `<div class="card"><h1>Duyệt yêu cầu</h1><p class="muted">Chỉ Central xem được.</p></div>`;
    }

    // Chỉ show yêu cầu chưa có shipment
    const showStatuses = new Set(['Đang chờ', 'Đã duyệt']);
    const pending = state.data.labRequests
      .filter(r => showStatuses.has((r.status ?? 'Đang chờ')) && !r.shipment_id);

    const rows = pending.map(r => {
      // mỗi dòng yêu cầu trong request
      const linesHtml = (r.lines || []).map((l, lineIdx) => {
        const avail = centralAvailableByGroup(l.asset_code, l.asset_name);
        const disabled = (r.status === 'Đã duyệt') ? 'disabled' : '';

        return (Array.isArray(l.item_ids) && l.item_ids.length)
          ? `
          <div class="grid cols-2" style="align-items:start">
            <div>
              <label>${l.asset_code || '(không mã)'} - ${l.asset_name || '(không tên)'} – yêu cầu</label>
              <div>${l.item_ids.map(id => `<span class="pill">${serialOf(id)}</span>`).join(' ')}</div>
              <div class="muted-2" style="margin-top:6px">Tổng: ${l.item_ids.length}</div>
            </div>
            <div style="display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">
              <span class="pill">Central available: ${centralAvailableByGroup(l.asset_code, l.asset_name)}</span>
            </div>
          </div>
          `
          : `
          <div class="grid cols-3" style="align-items:end">
            <div>
              <label>${l.asset_code || '(không mã)'} - ${l.asset_name || '(không tên)'} – yêu cầu</label>
              <input type="number" value="${l.qty_requested || 0}" disabled/>
            </div>
            <div>
              <label>Approve (tối đa ${avail})</label>
              <input
                data-req="${r.id}" data-line="${lineIdx}"
                class="appr-input" type="number" min="0" max="${avail}"
                value="${Math.min(l.qty_requested || 0, avail)}"
                ${disabled}
              />
            </div>
            <div style="display:flex;align-items:flex-end;gap:8px">
              <span class="pill">Central available: ${avail}</span>
            </div>
          </div>
          `;

      }).join('');

      const approveBtn = (r.status === 'Đã duyệt')
        ? ''
        : `<button class="btn primary" onclick="approveRequest('${r.id}')">Duyệt</button>`;

      return `
      <div class="card">
        <h2>
          Yêu cầu #${r.id} • ${r.lab_id}
          • <span class="pill warn">${r.status || 'Đang chờ'}</span>
        </h2>

        <div class="muted-2" style="font-size:12px; margin-bottom:10px">
          Gửi lúc: ${r.created_at || '-'}
          ${r.approved_at ? `• Duyệt lúc: ${r.approved_at}` : ''}
        </div>

        ${linesHtml}

        <div class="toolbar" style="margin-top:12px">
          ${approveBtn}
          <button class="btn" onclick="createShipmentFromRequest('${r.id}')">Tạo shipment</button>
        </div>
      </div>
    `;
    }).join('') || `
    <div class="card">
      <h1>Duyệt yêu cầu</h1>
      <p class="muted">Không có yêu cầu cần duyệt.</p>
    </div>
  `;

    return rows;
  },



  '#/central-shipments': () => `
  <div class="card">
    <h1>Shipments</h1>
    <p class="muted">Nhấn vào từng nhóm để thu gọn / mở ra danh sách.</p>
    <div id="shipGroups"></div>
  </div>
`,


};
function renderCentralShipmentsGroups() {
  // render dựa trên state.data.shipments (đã được reloadCoreData load)
  const all = (state.data.shipments || []).slice();

  // sort mới nhất lên trên cho dễ nhìn (tuỳ bạn)
  all.sort((a, b) => {
    const ta = (typeof toTS === 'function') ? toTS(a.created_at) : (new Date(a.created_at || 0).getTime() || 0);
    const tb = (typeof toTS === 'function') ? toTS(b.created_at) : (new Date(b.created_at || 0).getTime() || 0);
    return tb - ta;
  });

  const groups = { c2l: [], l2c: [], repair: [] };
  for (const s of all) {
    if (s && typeof s === 'object') {
      if (s.to_lab_id === 'CENTRAL') groups.l2c.push(s);
      else groups.c2l.push(s);
      if (s.repair_id || s.from_repair_id) groups.repair.push(s);
    }
  }

  const host = document.getElementById('shipGroups');
  if (!host) return;

    const html =
    makeGroup('Central → Lab', 'dot-green', groups.c2l) +
    makeGroup('Lab → Central', 'dot-blue', groups.l2c) +
    makeGroup('Shipment liên quan sửa chữa', 'dot-orange', groups.repair);

  // ✅ chống nhấp nháy: chỉ update DOM khi HTML thay đổi
  if (host._lastHtml !== html) {
    host.innerHTML = html;
    host._lastHtml = html;
  }

}

// ==== UI styles cho trang Shipments (chèn 1 lần) ====


function closeShipmentPopup() {
  const modal = document.getElementById('shipmentModal');
  if (modal) modal.classList.add('hidden');
  document.removeEventListener('keydown', __shipmentEsc);
  document.body.style.overflow = '';
}

function __shipmentEsc(e) {
  if (e.key === 'Escape') closeShipmentPopup();
}

// ===== Persist draft kết quả kiểm tra nhận shipment (để F5 vẫn còn) =====
function ensureReceiveDraftFromShipment(shId, s) {
  state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
  state.ui.shipReceiveExtras = state.ui.shipReceiveExtras || {};
  state.ui.shipReceiveMarksLoaded = state.ui.shipReceiveMarksLoaded || {};
  state.ui.shipReceiveExtrasLoaded = state.ui.shipReceiveExtrasLoaded || {};

    if (!state.ui.shipReceiveMarksLoaded[shId]) {
    let checks = (s && s.receive_meta && s.receive_meta.checks) ? s.receive_meta.checks : null;

    // Vá dữ liệu cũ: shipment đã received nhưng trước đây code xoá receive_meta
    // -> suy ra checks: missing theo missing_item_ids, còn lại ok
    if (!checks && s && s.received_at) {
      const itemIds = (s.item_ids && s.item_ids.length)
        ? s.item_ids
        : (s.items || []).map(x => x.id).filter(Boolean);

      const missing = (s.receive_meta && Array.isArray(s.receive_meta.missing_item_ids))
        ? s.receive_meta.missing_item_ids
        : [];

      checks = {};
      for (const id of itemIds) {
        checks[id] = missing.includes(id) ? 'missing' : 'ok';
      }
    }

    state.ui.shipReceiveMarks[shId] = checks ? { ...checks } : (state.ui.shipReceiveMarks[shId] || {});
    state.ui.shipReceiveMarksLoaded[shId] = true;
  }


  if (!state.ui.shipReceiveExtrasLoaded[shId]) {
    const extras = (s && s.receive_meta && Array.isArray(s.receive_meta.extra_serials)) ? s.receive_meta.extra_serials : null;
    state.ui.shipReceiveExtras[shId] = extras ? extras.slice() : (state.ui.shipReceiveExtras[shId] || []);
    state.ui.shipReceiveExtrasLoaded[shId] = true;
  }
}

function scheduleSaveReceiveDraft(shId) {
  // debounce để khỏi ghi DB quá nhiều
  state.ui._recvDraftTimers = state.ui._recvDraftTimers || {};
  if (state.ui._recvDraftTimers[shId]) clearTimeout(state.ui._recvDraftTimers[shId]);

  state.ui._recvDraftTimers[shId] = setTimeout(async () => {
    try {
      const s =
        (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId)) ||
        (state.data.shipments || []).find(x => x.id === shId);
      if (!s) return;

      const marks = (state.ui.shipReceiveMarks && state.ui.shipReceiveMarks[shId]) ? state.ui.shipReceiveMarks[shId] : {};
      const extras = (state.ui.shipReceiveExtras && state.ui.shipReceiveExtras[shId]) ? state.ui.shipReceiveExtras[shId] : [];

      s.receive_meta = s.receive_meta || {};
      s.receive_meta.checks = { ...marks };              // itemId -> 'ok' | 'missing'
      s.receive_meta.extra_serials = extras.slice();     // serial ngoài shipment
      s.receive_meta.draft_updated_at = Date.now();

      await saveData(DB_SHIPMENTS, s.id, s);
    } catch (e) {
      console.warn('scheduleSaveReceiveDraft fail', shId, e);
    }
  }, 500);
}


function openShipmentReceivePopup(shId) {
  // styles modal riêng cho Nhận shipment + Quét QR
  ensureShipReceiveModalStyles();

  const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
    || (state.data.shipments || []).find(x => x.id === shId);
  if (!s) { toast && toast('Không tìm thấy shipment'); return; }
  ensureReceiveDraftFromShipment(shId, s);
    const locked = !!s.received_at; // đã nhận => khóa dấu ✓/✗
  state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
  const marks = state.ui.shipReceiveMarks[shId] || (state.ui.shipReceiveMarks[shId] = {});

  let modal = document.getElementById('shipmentModal');
  // để openShipmentScan có thể tìm/ẩn đúng popup shipment
  if (modal) modal.setAttribute('data-role', 'shipReceiveModal');

  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shipmentModal';
    modal.className = 'modal hidden';
    modal.setAttribute('data-role', 'shipReceiveModal');
    modal.innerHTML = `
      <div class="modal-body">
        <div class="modal-header">
          <h2 id="shipmentModalTitle"></h2>
          <button class="btn" onclick="closeShipmentPopup()">Đóng</button>
        </div>
        <div id="shipmentModalContent"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeShipmentPopup();
    });
  }

  const items = shipmentItemsDetailed(s);
  const okCount = items.filter(it => marks[it.id] === 'ok').length;
  const missCount = items.filter(it => marks[it.id] === 'missing').length;

  const rows = items.map((it, idx) => {
    const mark = marks[it.id];
    const st = mark === 'ok'
      ? `<span class="pill ok">Đúng</span>`
      : mark === 'missing'
        ? `<span class="pill bad">Thiếu</span>`
        : `<span class="pill">Chưa kiểm tra</span>`;

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${it.serial || '-'}</td>
        <td>${it.name || '-'}</td>
        <td>${st}</td>
        <td>
          <button class="btn"
            ${locked ? 'disabled style="opacity:.5;pointer-events:none;"' : ''}
            onclick="markShipmentItem('${s.id}','${it.id}','ok')">✓</button>

          <button class="btn"
            ${locked ? 'disabled style="opacity:.5;pointer-events:none;"' : ''}
            onclick="markShipmentItem('${s.id}','${it.id}','missing')">✗</button>

        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="5" class="muted-2">(Không có thiết bị trong shipment)</td></tr>`;

  const titleEl = document.getElementById('shipmentModalTitle');
  const contentEl = document.getElementById('shipmentModalContent');

  if (titleEl) titleEl.textContent = `Shipment ${s.id}`;
  if (contentEl) {
    const typeLabel = s.from_lab_id
    ? 'Trả về kho trung tâm'
    : 'Cấp từ kho trung tâm';



    contentEl.innerHTML = `
      <p class="muted-2">Loại: ${typeLabel} • Trạng thái vận chuyển: ${shipStatusText(s.status)}</p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Serial</th><th>Thiết bị</th><th>Trạng thái</th><th>Đánh dấu</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="muted-2" style="margin-top:8px">
        Đã ✓: ${okCount}/${items.length} • X: ${missCount}
      </div>
      <div class="toolbar" style="margin-top:12px;justify-content:space-between">
        <div>
          <button class="btn" onclick="openShipmentScan('${s.id}', this)">📷 Quét QR</button>
        </div>
        <div>
          <button id="btnReceiveShipment_${s.id}"
            class="btn primary"
            ${ (s.received_at || (state.ui.shipReceiveSubmitting && state.ui.shipReceiveSubmitting[s.id])) ? 'disabled' : '' }
            style="${ (s.received_at || (state.ui.shipReceiveSubmitting && state.ui.shipReceiveSubmitting[s.id])) ? 'opacity:.5;pointer-events:none;' : '' }"
            onclick="confirmReceiveShipment('${s.id}')">
            ${s.received_at ? 'Đã nhận' : 'Nhận hàng'}
          </button>
        </div>
      </div>
    `;
  }

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', __shipmentEsc);
}


function markShipmentItem(shId, itemId, mark) {
  const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))|| (state.data.shipments || []).find(x => x.id === shId);
  if (s && s.received_at) { toast && toast('Shipment đã nhận, không thể đổi kết quả.'); return; }
  state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
  const marks = state.ui.shipReceiveMarks[shId] || (state.ui.shipReceiveMarks[shId] = {});
  marks[itemId] = mark;

  // ✅ lưu draft xuống DB (để reload không mất)
  scheduleSaveReceiveDraft(shId);

  const curBase = baseRoute(state.route);
  if (curBase === '#/ship-scan') {
    // nếu bạn đang ẩn qrOut thì không cần updateShipScanInfo cũng được
    try { updateShipScanInfo(shId); } catch {}
    return;
  }

  openShipmentReceivePopup(shId);
}


// Lưu serial "ngoài shipment" khi đang quét
function markShipmentExtra(shId, serial) {
  const s = String(serial || '').trim();
  if (!s) return;

  state.ui.shipReceiveExtras = state.ui.shipReceiveExtras || {};
  const arr = state.ui.shipReceiveExtras[shId] || (state.ui.shipReceiveExtras[shId] = []);
  if (!arr.includes(s)) arr.push(s);

  // ✅ lưu draft xuống DB
  scheduleSaveReceiveDraft(shId);

  const curBase = baseRoute(state.route);
  if (curBase === '#/ship-scan') {
    try { updateShipScanInfo(shId); } catch {}
  }
}


// Cập nhật thông tin hiển thị ở trang #/ship-scan
function updateShipScanInfo(shId) {
  try {
    const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
      || (state.data.shipments || []).find(x => x.id === shId);

    const items = s ? shipmentItemsDetailed(s) : [];
    const total = items.length;

    const marks = (state.ui.shipReceiveMarks && state.ui.shipReceiveMarks[shId]) ? state.ui.shipReceiveMarks[shId] : {};
    const ok = items.filter(it => marks[it.id] === 'ok').length;
    const miss = items.filter(it => marks[it.id] === 'missing').length;

    const extras = (state.ui.shipReceiveExtras && state.ui.shipReceiveExtras[shId]) ? state.ui.shipReceiveExtras[shId] : [];
    const last = state.ui.shipScanLast || '';

    const out = document.getElementById('qrOut');
    if (out) {
      out.textContent =
        (last ? (`Đã quét: ${last}\n`) : '') +
        `✓ ${ok}/${total} • X: ${miss} • Ngoài shipment: ${extras.length}`;
    }
  } catch (e) {
    console.warn('updateShipScanInfo error', e);
  }
}

 // ===== Popup quét QR cho Shipment (dạng modal nhỏ) =====
function ensureShipScanModal() {
  ensureRepairModalStyles(); // tái dùng style .modal / .modal-body

  let modal = document.getElementById('shipScanModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'shipScanModal';
  modal.className = 'modal hidden';
  modal.setAttribute('data-role', 'shipScanModal');
  modal.innerHTML = `
    <div class="modal-body" style="max-width:980px">
      <div class="modal-header">
        <h2 id="shipScanTitle">Quét QR</h2>
        <button class="btn" type="button" onclick="closeScanModal()">Đóng</button>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:320px;max-width:520px">
          <video id="qrVideo" playsinline style="width:100%;border-radius:12px;background:#000"></video>
          <div class="muted-2" style="margin-top:6px">Đang tìm QR... (giữ thẳng mã / tiến gần hơn / tăng sáng)</div>
        </div>

        <div style="flex:1;min-width:260px">
          <div id="shipScanHint" class="muted-2" style="margin-bottom:10px"></div>
          <div id="qrStatus" class="muted-2" style="margin-bottom:10px">Chưa bắt đầu.</div>

          <div class="toolbar" style="gap:10px;flex-wrap:wrap">
            <button class="btn primary" type="button" onclick="startScan()">Bắt đầu</button>
            <button id="shipScanBackBtn" class="btn" type="button" onclick="closeScanModal()">Dừng / Đóng</button>
          </div>

          <pre id="qrOut" class="muted-2" style="margin-top:12px;white-space:pre-wrap"></pre>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeScanModal();
  });

  return modal;
}
function closeScanModal() {
  const target = state.ui.scanTarget || 'auto';

  // shipment giữ nguyên luồng cũ (re-open popup shipment)
  if (target === 'shipment') {
    closeShipmentScan();
    return;
  }

  // các mode khác (vd: repair_pick) => chỉ đóng modal
  try { stopScan(); } catch {}
  try { hideShipScanModal(); } catch {}
  state.ui.scanTarget = 'auto';
  document.body.style.overflow = '';
}

function openRepairPickScan() {
  state.ui.scanTarget = 'repair_pick';

  const modal = ensureShipScanModal();

  const title = document.getElementById('shipScanTitle');
  if (title) title.textContent = 'Quét QR để chọn thiết bị';

  const hint = document.getElementById('shipScanHint');
  if (hint) hint.textContent = 'Đưa QR của thiết bị vào khung hình. Quét xong sẽ tự chọn thiết bị ở form Báo hỏng.';

  const backBtn = document.getElementById('shipScanBackBtn');
  if (backBtn) backBtn.textContent = 'Dừng / Đóng';

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const out = document.getElementById('qrOut');
  if (out) out.textContent = '';

  const st = document.getElementById('qrStatus');
  if (st) st.textContent = 'Đang khởi động camera...';

  setTimeout(() => { try { startScan(); } catch (e) { console.error(e); } }, 0);
}

function openShipScanModal(shId) {
  state.ui.shipReceiveScanShipment = shId;
  state.ui.shipReceiveReopenShipment = shId;
  state.ui.scanTarget = 'shipment';

  closeShipmentPopup();

  const modal = ensureShipScanModal();

  const title = document.getElementById('shipScanTitle');
  if (title) title.textContent = 'Quét QR thiết bị';

  const hint = document.getElementById('shipScanHint');
  if (hint) hint.textContent = 'Đưa QR vào khung hình. Khi nhận dạng được, hệ thống sẽ tự đối chiếu với shipment.';

  const backBtn = document.getElementById('shipScanBackBtn');
  if (backBtn) backBtn.textContent = 'Dừng / Về shipment';

  modal.classList.remove('hidden');

  const out = document.getElementById('qrOut');
  if (out) out.textContent = '';

  const st = document.getElementById('qrStatus');
  if (st) st.textContent = 'Đang khởi động camera...';

  setTimeout(() => { try { startScan(); } catch(e){ console.error(e); } }, 0);
  try { updateShipScanInfo(shId); } catch {}
}


function hideShipScanModal() {
  const modal = document.getElementById('shipScanModal');
  if (modal) modal.classList.add('hidden');
}

function switchScanCamera() {
  state.ui.qrFacing = (state.ui.qrFacing === 'user') ? 'environment' : 'user';
  stopScan();
  startScan();
}

// Mở màn hình quét QR cho 1 shipment
function openShipmentScan(shId, btnEl) {
  openShipScanModal(shId);
}


function shipmentScanDone() {
  stopScan();

  const shId = state.ui.shipReceiveScanShipment || state.ui.shipReceiveReopenShipment;

  // ✅ Chốt kết quả: item nào chưa quét/ chưa đánh dấu thì tự động đánh X (missing)
  if (shId) {
    state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
    const marks = state.ui.shipReceiveMarks[shId] || (state.ui.shipReceiveMarks[shId] = {});

    const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
      || (state.data.shipments || []).find(x => x.id === shId);

    if (s) {
      const items = shipmentItemsDetailed(s);
      items.forEach(it => {
        if (marks[it.id] !== 'ok' && marks[it.id] !== 'missing') {
          marks[it.id] = 'missing';
        }
      });
    }
  }

  state.ui.scanTarget = 'auto';
  state.ui.shipReceiveScanShipment = null;
  state.ui.shipReceiveReopenShipment = null;
  state.ui.shipScanLast = '';

  if (shId) state.ui.shipReceiveReturnTo = shId;
  navigate('#/shipments-receive');
}



function closeShipmentScan() {
  stopScan();

  const shId = state.ui.shipReceiveScanShipment || state.ui.shipReceiveReopenShipment;

  if (shId) {
    state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
    const marks = state.ui.shipReceiveMarks[shId] || (state.ui.shipReceiveMarks[shId] = {});

    const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
      || (state.data.shipments || []).find(x => x.id === shId);

    if (s) {
      const items = shipmentItemsDetailed(s);
      items.forEach(it => {
        if (marks[it.id] !== 'ok' && marks[it.id] !== 'missing') {
          marks[it.id] = 'missing';
        }
      });
    }
  }

  hideShipScanModal();

  state.ui.scanTarget = 'auto';
  state.ui.shipReceiveScanShipment = null;

  if (shId) {
    state.ui.shipReceiveReturnTo = shId;
    setTimeout(() => openShipmentReceivePopup(shId), 0);
  }
}



// Được gọi sau khi scan QR xong (từ handleQrPayload)
function markShipmentScan(shId, serial) {
  const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
    || (state.data.shipments || []).find(x => x.id === shId);
  if (!s) { toast && toast('Không tìm thấy shipment'); return; }

  const items = shipmentItemsDetailed(s);
  const found = items.find(it =>
    (it.serial && String(it.serial).trim() === serial) || it.id === serial
  );

  if (!found) {
    toast && toast('Thiết bị không nằm trong shipment này.');
  } else {
    state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
    const marks = state.ui.shipReceiveMarks[shId] || (state.ui.shipReceiveMarks[shId] = {});
    marks[found.id] = 'ok';
    toast && toast(`Đã đánh dấu nhận: ${found.serial || found.name || found.id}`);
  }

  // quay về trang Nhận shipment và tự mở lại popup
  state.ui.shipReceiveReturnTo = shId;
  state.ui.scanTarget = 'auto';
  state.ui.shipReceiveScanShipment = null;
  navigate('#/shipments-receive');
}


// ==== render 1 nhóm + bảng ====
// ==== render 1 nhóm + bảng (có phân trang 7 shipment / trang) ====
// ==== render 1 nhóm + bảng (có lưu trạng thái mở/đóng + phân trang 7 dòng) ====
function makeGroup(title, dotClass, arr) {
  ensureShipmentsStyles();
  state.ui = state.ui || {};

  const id = 'grp_' + title.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const count = (arr || []).length;

  // ====== Lưu trạng thái mở/đóng để refresh không bị bật lại ======
  state.ui.shipGroupOpen = state.ui.shipGroupOpen || {};
  if (typeof state.ui.shipGroupOpen[id] !== 'boolean') {
    state.ui.shipGroupOpen[id] = (title === 'Central → Lab'); // default mở nhóm này
  }
  const isOpen = !!state.ui.shipGroupOpen[id];

  // ====== Phân trang 7 shipment / trang ======
  const perPage = 7;
  const totalPages = Math.max(1, Math.ceil(count / perPage));

  state.ui.shipGroupPage = state.ui.shipGroupPage || {};
  let page = state.ui.shipGroupPage[id] || 1;
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  state.ui.shipGroupPage[id] = page;

  const start = (page - 1) * perPage;
  const pageList = (arr || []).slice(start, start + perPage);

  const pagerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:12px">
      <div class="muted-2">Trang ${page} / ${totalPages} • Tổng ${count}</div>
      <div style="display:flex;gap:8px">
        <button class="btn"
          ${page <= 1 ? 'disabled' : ''}
          onclick="changeShipGroupPage('${id}', -1); event.stopPropagation();">← Trước</button>
        <button class="btn"
          ${page >= totalPages ? 'disabled' : ''}
          onclick="changeShipGroupPage('${id}', 1); event.stopPropagation();">Sau →</button>
      </div>
    </div>
  `;

  return `
  <div class="ship-group">
    <div class="ship-head" onclick="toggleShipmentGroup('${id}')">
      <h3><span class="${dotClass}"></span>${title}</h3>
      <div class="ship-count">${count} shipment</div>
    </div>

    <div id="body-${id}" class="ship-body" style="display:${isOpen ? '' : 'none'}">
      <table class="ship">
        <thead>
          <tr>
            <th>ID</th><th>Lab</th>
            <th>Trạng thái</th><th>Chiều</th><th>Tạo lúc</th><th>Nhận lúc</th>
            <th style="width:110px">Chi tiết</th>
          </tr>
        </thead>

        <tbody>${renderShipmentRows(pageList)}</tbody>
      </table>
      ${pagerHtml}
    </div>
  </div>`;
}


function changeShipmentGroupPage(groupId, delta) {
  state.ui.shipGroupPage = state.ui.shipGroupPage || {};
  const cur = state.ui.shipGroupPage[groupId] || 1;
  state.ui.shipGroupPage[groupId] = cur + (delta || 0);
  rerenderShipmentGroup(groupId);
}

function rerenderShipmentGroup(groupId) {
  const list = (state.ui.shipGroupData && state.ui.shipGroupData[groupId]) || [];
  const PER_PAGE = 7;

  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  let page = state.ui.shipGroupPage?.[groupId] || 1;
  page = Math.min(totalPages, Math.max(1, page));
  state.ui.shipGroupPage[groupId] = page;

  const start = (page - 1) * PER_PAGE;
  const pageList = list.slice(start, start + PER_PAGE);

  const tbody = document.getElementById(`tbody-${groupId}`);
  if (tbody) tbody.innerHTML = renderShipmentRows(pageList);

  const info = document.getElementById(`shipPageInfo-${groupId}`);
  if (info) info.textContent = `Trang ${page} / ${totalPages} • Tổng ${list.length}`;

  const btnPrev = document.getElementById(`btnPrev-${groupId}`);
  const btnNext = document.getElementById(`btnNext-${groupId}`);
  if (btnPrev) btnPrev.disabled = (page <= 1);
  if (btnNext) btnNext.disabled = (page >= totalPages);
}

// ==== render các dòng của 1 nhóm ====
// ==== render các dòng của 1 nhóm ====
function renderShipmentRows(list) {
  const byId = (state.index && state.index.itemsById)
    ? state.index.itemsById
    : new Map((state.data.items || []).map(x => [x.id, x]));

  const fmt = fmtDT;

  const getIds = (s) => {
    if (!s) return [];

    // Format mới: item_ids: [id1,id2,...]
    if (Array.isArray(s.item_ids)) return s.item_ids.filter(Boolean);

    // Format: items: [id1,id2,...] hoặc items: [{id,...}, ...]
    if (Array.isArray(s.items)) {
      if (!s.items.length) return [];
      if (typeof s.items[0] === 'string') return s.items.filter(Boolean);
      return s.items.map(x => (x && (x.id || x))).filter(Boolean);
    }

    // Format: items là object {id:true} hoặc {id:{...}}
    if (s.items && typeof s.items === 'object') {
      const keys = Object.keys(s.items || {});
      const vals = Object.values(s.items || {});
      if (vals.length && (typeof vals[0] === 'boolean' || vals[0] === 1 || vals[0] === 0 || vals[0] == null)) {
        return keys.filter(Boolean);
      }
      return vals.map(v => v && v.id).filter(Boolean);
    }

    // fallback nếu có receive_meta
    if (s.receive_meta && Array.isArray(s.receive_meta.received_item_ids)) {
      return s.receive_meta.received_item_ids.filter(Boolean);
    }

    return [];
  };

  state.ui = state.ui || {};
  state.ui.shipDetailOpen = state.ui.shipDetailOpen || {};

  const getItemObj = (idOrObj) => {
    if (!idOrObj) return null;
    if (typeof idOrObj === 'string') return byId.get(idOrObj) || { id: idOrObj };
    const id = idOrObj.id || idOrObj;
    return byId.get(id) || idOrObj || { id };
  };

  const renderDetailTable = (s) => {
    // ưu tiên item_ids -> map ra item object từ state
    let raw = [];
    if (Array.isArray(s.item_ids)) raw = s.item_ids;
    else if (Array.isArray(s.items)) raw = s.items;
    else if (s.items && typeof s.items === 'object') raw = Object.values(s.items);
    else raw = [];

    const items = raw.map(getItemObj).filter(Boolean);

    if (!items.length) {
      return `<div class="muted-2">(Không có thiết bị trong shipment)</div>`;
    }

    const rows = items.map(it => {
      const assetCode = it.asset_code || it.type_id || '';
      const serial = it.serial || '';
      const name = it.asset_name || it.name || '';
      return `<tr>
        <td>${escapeHtml(assetCode)}</td>
        <td>${escapeHtml(serial)}</td>
        <td>${escapeHtml(name)}</td>
        <td style="text-align:right">1</td>
      </tr>`;
    }).join('');

    return `
      <table class="ship" style="margin-top:8px">
        <thead>
          <tr>
            <th>Mã thiết bị</th>
            <th>Serial</th>
            <th>Tên thiết bị</th>
            <th style="text-align:right">Số lượng</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  };

  return (list || []).map(s => {
    const direction = s.to_lab_id === 'CENTRAL' ? 'Lab → Central' : 'Central → Lab';
    const lab = s.to_lab_id === 'CENTRAL'
      ? (s.from_lab_id || s.lab_id || '')
      : (s.to_lab_id || '');

    const isOpen = !!state.ui.shipDetailOpen[s.id];
    const btnText = isOpen ? 'Ẩn' : 'Xem';

    const mainRow = `<tr data-id="${s.id}">
      <td>${s.id}</td>
      <td>${lab}</td>
      <td>${shipStatusText(s.status)}</td>
      <td>${direction}</td>
      <td>${fmt(s.created_at)}</td>
      <td>${fmt(s.received_at)}</td>
      <td>
        <button class="btn" onclick="event.stopPropagation(); toggleShipmentDetail('${s.id}')">${btnText}</button>
      </td>
    </tr>`;

    const detailRow = isOpen
      ? `<tr class="ship-detail">
          <td colspan="7" style="padding:10px 12px">
            ${renderDetailTable(s)}
          </td>
        </tr>`
      : '';

    return mainRow + detailRow;
  }).join('') || `<tr><td colspan="7" class="muted-2">(Không có shipment)</td></tr>`;
}

// Toggle mở/đóng chi tiết shipment (trang Central → Quản lý shipment)
function toggleShipmentDetail(shId) {
  state.ui = state.ui || {};
  state.ui.shipDetailOpen = state.ui.shipDetailOpen || {};
  state.ui.shipDetailOpen[shId] = !state.ui.shipDetailOpen[shId];

  // rerender lại đúng trang để thấy/ẩn chi tiết ngay
  if (baseRoute(state.route) === '#/central-shipments') {
    renderCentralShipmentsGroups();
  } else {
    renderPage();
  }
}
window.toggleShipmentDetail = toggleShipmentDetail;


// ==== UI styles cho trang Shipments (chèn 1 lần) ====
function ensureShipReceiveModalStyles() {
  if (document.getElementById('shipReceiveModalStyles')) return;

  const css = `
  /* ===== Modal: Nhận shipment ===== */
  #shipmentModal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000}
  #shipmentModal.hidden{display:none}
  #shipmentModal .modal-body{background:#0f1622;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);width:min(980px,95vw);padding:18px 22px;max-height:85vh;overflow:auto}
  #shipmentModal .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}

  /* ===== Modal: Quét QR cho shipment ===== */
  #shipScanModal{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:10001}
  #shipScanModal.hidden{display:none}
  #shipScanModal .modal-body{background:#0f1622;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);width:min(1100px,95vw);padding:18px 22px;max-height:90vh;overflow:auto}
  #shipScanModal .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  #shipScanModal video{background:#000;border-radius:12px;width:100%;max-height:60vh;object-fit:cover}
  `;

  const style = document.createElement('style');
  style.id = 'shipReceiveModalStyles';
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureShipmentsStyles() {
  if (document.getElementById('shipments-style')) return;

  const css = `
  .ship-group{border:1px solid rgba(255,255,255,.06);border-radius:14px;margin:10px 0;overflow:hidden;background:var(--panel-2);}
  .ship-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer}
  .ship-head h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}
  .ship-count{opacity:.7}
  .dot-green,.dot-blue,.dot-orange{width:10px;height:10px;border-radius:50%;display:inline-block}
  .dot-green{background:#22c55e}
  .dot-blue{background:#60a5fa}
  .dot-orange{background:#f59e0b}

  table.ship{width:100%}
  table.ship th,table.ship td{white-space:nowrap}

  .ship-pager{
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 12px;border-top:1px solid rgba(255,255,255,.06);
    gap:10px
  }
  .ship-pager-actions{display:flex;gap:8px}
  .ship-pager .btn[disabled]{opacity:.45;cursor:not-allowed}
  `;

  const st = document.createElement('style');
  st.id = 'shipments-style';
  st.textContent = css;
  document.head.appendChild(st);
}




PAGES['#/scan'] = () => `
  <div class="card">
    <h1>Quét QR</h1>
    <video id="qrVideo" playsinline style="width:100%;max-width:480px;border-radius:12px"></video>
    <div class="toolbar" style="margin-top:10px">
      <button class="btn primary" onclick="startScan()">Bắt đầu</button>
      <button class="btn" onclick="stopScan()">Dừng</button>
      <button class="btn" onclick="navigate('#/lab-handover')">← Về mượn</button>
    </div>
    <pre id="qrOut" class="muted-2" style="margin-top:8px"></pre>
  </div>
`;

PAGES['#/ship-scan'] = () => `
  <div class="card">
    <h1>Quét QR thiết bị</h1>
    <video id="qrVideo" playsinline style="width:100%;max-width:480px;border-radius:12px;background:#000"></video>
    <div class="toolbar" style="margin-top:10px">
      <button class="btn primary" onclick="startScan()">Bắt đầu</button>
      <button class="btn" onclick="shipmentScanDone()">Dừng / Về shipment</button>
    </div>
    <pre id="qrOut" class="muted-2" style="margin-top:8px"></pre>
  </div>
`;

// ===== CENTRAL: Shipment Issues (Thiếu/Thừa khi nhận hàng) =====
PAGES['#/central-shipment-issues'] = () => `
  <div class="card">
    <h1>⚠️ Sai khác khi nhận shipment</h1>
    <div class="toolbar" style="margin-top:10px">
      <input id="issueSearch" placeholder="Tìm theo shipment / lab / issue id…" oninput="setIssueSearch(this.value)" />
      <button class="btn" onclick="refreshCentralShipmentIssues()">🔄 Tải lại</button>
    </div>

    <div style="margin-top:12px" id="shipIssueList"></div>
  </div>
`;

state.ui.issueSearch = state.ui.issueSearch || '';
state.ui.shipIssuePage = state.ui.shipIssuePage || 1;
state.ui.shipIssueTotalPages = state.ui.shipIssueTotalPages || 1;
state.ui.shipIssueTotalItems = state.ui.shipIssueTotalItems || 0;

function changeCentralShipmentIssuesPage(delta) {
  const cur = Number(state.ui.shipIssuePage || 1) || 1;
  const total = Number(state.ui.shipIssueTotalPages || 1) || 1;

  let next = cur + (Number(delta) || 0);
  if (next < 1) next = 1;
  if (next > total) next = total;

  state.ui.shipIssuePage = next;
  renderCentralShipmentIssuesList();
}
window.changeCentralShipmentIssuesPage = changeCentralShipmentIssuesPage;


function setIssueSearch(v) {
  state.ui.issueSearch = v || '';
  state.ui.shipIssuePage = 1; // ✅ search mới => về trang 1
  renderCentralShipmentIssuesList();
}

async function refreshCentralShipmentIssues() {
  try {
    const issues = await getAll(DB_SHIPMENT_ISSUES);
    state.data.shipmentIssues = Object.values(issues || {});
    renderCentralShipmentIssuesList();
  } catch (e) {
    console.warn('refreshCentralShipmentIssues failed', e);
    toast('Không tải được shipmentIssues');
  }
}
function itemStatePill(state) {
  const s = String(state || '').trim();

  if (s === 'available@lab') return `<span class="pill ok">Có sẵn</span>`;
  if (s === 'available@central') return `<span class="pill ok">Ở kho trung tâm</span>`;
  if (s === 'in_transit') return `<span class="pill warn">Đang giao</span>`;
  if (s === 'on_loan') return `<span class="pill warn">Đang mượn</span>`;
  if (s === 'broken') return `<span class="pill bad">Hỏng</span>`;
  if (s === 'repair' || s === 'at_central_repair') return `<span class="pill warn">Đang sửa</span>`;

  return `<span class="pill">${esc(state || '-')}</span>`;
}

function fmtTS(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('vi-VN'); } catch { return String(ts); }
}

function renderCentralShipmentIssuesList() {
  const host = document.getElementById('shipIssueList');
  if (!host) return;

  const q = normalizeText(state.ui.issueSearch || '');
  const labsById = new Map((state.data.labs || []).map(l => [l.id, l]));

  let list = (state.data.shipmentIssues || []).slice();
  list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  if (q) {
    list = list.filter(x => {
      const labName = labsById.get(x.lab_id || '')?.name || '';
      return normalizeText(x.id || '').includes(q)
        || normalizeText(x.shipment_id || '').includes(q)
        || normalizeText(x.lab_id || '').includes(q)
        || normalizeText(labName).includes(q)
        || normalizeText(x.status || '').includes(q);
    });
  }

  // ✅ phân trang 7 dòng / trang
  const PER_PAGE = 7;
  const pg = paginate(list, Number(state.ui.shipIssuePage || 1) || 1, PER_PAGE);
  state.ui.shipIssuePage = pg.page;
  state.ui.shipIssueTotalPages = pg.totalPages;
  state.ui.shipIssueTotalItems = pg.totalItems;

  const rows = pg.rows.map(x => {
    const miss = (x.missing_item_ids || []).length;
    const extra = (x.extra_serials || []).length;
    const labName = labsById.get(x.lab_id || '')?.name || x.lab_id || '';
    const pillCls = (x.status === 'Đã xử lý') ? 'ok' : (x.status === 'Đang xử lý') ? 'warn' : 'bad';
    return `
      <tr>
        <td>${esc(x.id || '')}</td>
        <td>${esc(x.shipment_id || '')}</td>
        <td>${esc(labName)}</td>
        <td><span class="pill ${pillCls}">${esc(x.status || 'open')}</span></td>
        <td>${miss}</td>
        <td>${extra}</td>
        <td>${fmtTS(x.created_at)}</td>
        <td>
          <button class="btn" onclick="openShipmentIssuePopup('${esc(x.id || '')}')">Xem</button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="8" class="muted-2">(Chưa có báo sai khác)</td></tr>`;

  const pager = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:12px">
      <div class="muted-2">Trang ${pg.page} / ${pg.totalPages} • Tổng ${pg.totalItems}</div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="changeCentralShipmentIssuesPage(-1)" ${pg.page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="changeCentralShipmentIssuesPage(1)" ${pg.page >= pg.totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  `;

  const html = `
    <table>
      <thead>
        <tr>
          <th>Issue</th>
          <th>Shipment</th>
          <th>Lab</th>
          <th>Trạng thái</th>
          <th>Thiếu</th>
          <th>Thừa</th>
          <th>Tạo lúc</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${pager}
  `;

  // ✅ tránh “nhấp nháy” do set innerHTML liên tục nếu nội dung không đổi
  if (host._lastHtml === html) return;
  host._lastHtml = html;
  host.innerHTML = html;
}


function initCentralShipmentIssuesPage() {
  refreshCentralShipmentIssues();
}

// ===== Modal =====
function closeShipmentIssuePopup() {
  const m = document.getElementById('shipIssueModal');
  if (m) m.remove();
}

function openShipmentIssuePopup(issueId) {
  const issue = (state.data.shipmentIssues || []).find(x => x.id === issueId);
  if (!issue) return toast('Không tìm thấy issue');

  const ship = (state.data.shipments || []).find(s => s.id === issue.shipment_id);
  const lab = (state.data.labs || []).find(l => l.id === issue.lab_id);

  const missing = (issue.missing_item_ids || []).map(id => {
    const it = (state.data.items || []).find(x => x.id === id);
    const name = it?.asset_name || it?.name || it?.serial || id;
    const st = it?.state || '';
    return `<li><b>${esc(name)}</b> <span class="muted-2">(${esc(id)} • ${esc(st)})</span></li>`;
  }).join('') || `<li class="muted-2">(Không có)</li>`;

  const extras = (issue.extra_serials || []).map(sr => {
    const it = (state.data.items || []).find(x => x.serial === sr);
    return `<li><b>${esc(sr)}</b> ${it ? `<span class="muted-2">(ID: ${esc(it.id)} • ${esc(it.state || '')})</span>` : `<span class="muted-2">(không có trong DB items)</span>`}</li>`;
  }).join('') || `<li class="muted-2">(Không có)</li>`;

  const html = `
  <div id="shipIssueModal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:9999">
    <div class="card" style="width:min(900px,92vw);max-height:88vh;overflow:auto">
      <div class="toolbar" style="justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0">Issue: ${esc(issue.id)}</h2>
          <div class="muted-2" style="margin-top:4px">
            Shipment: <b>${esc(issue.shipment_id || '')}</b> • Lab: <b>${esc(lab?.name || issue.lab_id || '')}</b> • Trạng thái: <b>${esc(issue.status || 'open')}</b>
          </div>
        </div>
        <button class="btn" onclick="closeShipmentIssuePopup()">✖</button>
      </div>

      <div style="margin-top:10px" class="muted-2">
        ${esc(issue.message || '')}
      </div>

      <div class="cards" style="margin-top:12px">
        <div class="card sm-6">
          <h2>Thiếu (${(issue.missing_item_ids || []).length})</h2>
          <ul style="margin:8px 0 0 18px">${missing}</ul>
          <div class="muted-2" style="margin-top:10px">
            Gợi ý: các item thiếu nên đang ở <b>available@central</b> (để tránh “lẫn” intransit).
          </div>
        </div>

        <div class="card sm-6">
          <h2>Thừa (${(issue.extra_serials || []).length})</h2>
          <ul style="margin:8px 0 0 18px">${extras}</ul>
        </div>
      </div>
      <div class="toolbar" style="margin-top:14px;justify-content:flex-end;align-items:center;gap:10px">
        <!-- vùng text báo trạng thái tạo shipment bù -->
        <span id="reshipMsg_${issue.id}" class="muted-2" style="margin-right:auto"></span>

        ${
          issue.reshipment_id
            ? `<span class="pill ok">🚚 Đã tạo: <b>${esc(issue.reshipment_id)}</b></span>`
            : `<button id="btnReship_${issue.id}" class="btn primary"
                onclick="createReshipmentFromIssue('${esc(issue.id)}')">🚚 Tạo shipment bù (thiếu)</button>`
        }

        <button class="btn" onclick="resolveShipmentIssue('${esc(issue.id)}')">✅ Đánh dấu đã xử lý</button>
      </div>

    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}


async function resolveShipmentIssue(issueId) {
  const issue = (state.data.shipmentIssues || []).find(x => x.id === issueId);
  if (!issue) return;

  issue.status = 'Đã xử lý';
  issue.resolved_at = Date.now();
  issue.updated_at = Date.now();
  await saveData(DB_SHIPMENT_ISSUES, issueId, issue);

  // optional: cập nhật shipment.receive_meta.issue_status
  const ship = (state.data.shipments || []).find(s => s.id === issue.shipment_id);
  if (ship) {
    ship.receive_meta = ship.receive_meta || {};
    ship.receive_meta.issue_status = 'Đã xử lý';
    ship.receive_meta.issue_resolved_at = now();
    await saveData(DB_SHIPMENTS, ship.id, ship);
  }

  closeShipmentIssuePopup();
  refreshCentralShipmentIssues();
  toast('Đã đánh dấu đã xử lý');
}

function isDeliveredToLab(it, toLab) {
  if (!it) return false;
  if ((it.lab_id || '') !== toLab) return false;
  const st = String(it.state || '').toLowerCase();
  return st.includes('available@lab') || st === 'available@lab' || st === 'available' || st.includes('borrow') || st.includes('loan');
}

function isInTransitToLab(it, toLab) {
  if (!it) return false;
  if ((it.lab_id || '') !== toLab) return false;
  const st = String(it.state || '').toLowerCase();
  return st === 'in_transit' || st === 'intransit' || st.includes('in_transit') || st.includes('intransit') || st.includes('đang giao');
}

async function createReshipmentFromIssue(issueId) {
  const issue = (state.data.shipmentIssues || []).find(x => x.id === issueId);
  if (!issue) return toast('Không tìm thấy issue');

  // ✅ 1) CHẶN TẠO TRÙNG: nếu issue đã có reshipment_id thì không tạo nữa
  if (issue.reshipment_id) {
    toast(`Issue này đã có shipment bù: ${issue.reshipment_id}`);
    return;
  }

  const missingIds = (issue.missing_item_ids || []).filter(Boolean);
  if (!missingIds.length) {
    toast('Issue này không có danh sách thiếu');
    return;
  }
  // UI: ẩn nút ngay khi bấm để tránh bấm lặp + show trạng thái
  const btn = document.getElementById(`btnReship_${issueId}`);
  const msgEl = document.getElementById(`reshipMsg_${issueId}`);
  const restoreBtn = () => { if (btn) btn.style.display = ''; };

  if (btn) btn.style.display = 'none';
  if (msgEl) msgEl.textContent = '⏳ Đang tạo shipment bù...';


  const toLab = issue.lab_id;
  const itemsMap = new Map((state.data.items || []).map(it => [it.id, it]));

  const sendIds = [];
  const skippedDelivered = [];
  const skippedTransit = [];
  const skippedNotFound = [];

  // ✅ 2) LỌC ITEM: cái nào đã ở Lab rồi / đang intransit rồi thì KHÔNG đưa vào shipment bù
  for (const id of missingIds) {
    const it = itemsMap.get(id);
    if (!it) { skippedNotFound.push(id); continue; }
    if (isDeliveredToLab(it, toLab)) { skippedDelivered.push(id); continue; }
    if (isInTransitToLab(it, toLab)) { skippedTransit.push(id); continue; }
    sendIds.push(id);
  }

  if (!sendIds.length) {
    // trả UI về như cũ vì thực tế không tạo shipment
    restoreBtn();
    if (msgEl) msgEl.textContent = '';

    let msg = 'Không tạo shipment bù vì các thiết bị thiếu đã ở Lab hoặc đang trên đường.\n';
    if (skippedDelivered.length) msg += `- Đã ở Lab: ${skippedDelivered.join(', ')}\n`;
    if (skippedTransit.length) msg += `- Đang intransit: ${skippedTransit.join(', ')}\n`;
    if (skippedNotFound.length) msg += `- Không tìm thấy item: ${skippedNotFound.join(', ')}\n`;
    console.warn(msg);
    toast('Không còn thiết bị nào cần gửi bù (đã ở Lab / đang intransit)');
    return;
  }


  // ✅ 3) TẠO shipment bù (1 lần) + gắn dấu để truy vết
  const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const newShipId = `SHP-${Date.now()}-${rnd}`;

  const shipment = {
    id: newShipId,
    from_lab_id: 'CENTRAL',
    to_lab_id: toLab,
    item_ids: sendIds,
    status: 'sent',
    created_at: now(),
    sent_at: now(),

    // 🔥 quan trọng: đánh dấu shipment này là shipment bù của issue nào
    kind: 'reshipment',
    reship_of_issue: issueId,
    reship_of_shipment: issue.shipment_id || '',
    note: `Reship from issue ${issueId}`
  };

  // ✅ 4) CHỈ set intransit cho đúng những item thật sự cần gửi bù
  for (const id of sendIds) {
    const it = itemsMap.get(id);
    if (!it) continue;

    // Nếu ai đó update đồng thời, kiểm tra lại
    if (isDeliveredToLab(it, toLab) || isInTransitToLab(it, toLab)) continue;

    it.state = 'in_transit';
    it.lab_id = toLab;
    await saveData(DB_ITEMS, it.id, it);
  }

  await saveData(DB_SHIPMENTS, shipment.id, shipment);

  // ✅ 5) GHI reshipment_id vào issue để bấm lần sau không tạo trùng
  issue.status = 'Đang xử lý';
  issue.reshipment_id = shipment.id;
  issue.updated_at = Date.now();
  await saveData(DB_SHIPMENT_ISSUES, issueId, issue);

  // refresh local view
  await refreshCentralShipmentIssues();
  toast(`Đã tạo shipment bù: ${shipment.id}`);
}

function initLabRepairsPage() {
  if (!state.ui) state.ui = {};
  const sel = document.getElementById('rp_item');
  const desc = document.getElementById('rp_desc');
  const file = document.getElementById('rp_img_file');
  const name = document.getElementById('rp_img_name');

  if (sel && state.ui.rp_item) { try { sel.value = state.ui.rp_item; } catch (e) {} }
  if (desc && typeof state.ui.rp_desc === 'string') desc.value = state.ui.rp_desc;
  if (name) name.textContent = state.ui.rp_img_name || 'Chưa chọn tệp';

  const setEditing = (v) => { state.ui.rp_editing = !!v; };

  if (sel) {
    sel.addEventListener('change', () => { state.ui.rp_item = sel.value; });
    sel.addEventListener('focus', () => setEditing(true));
    sel.addEventListener('blur',  () => setEditing(false));
  }
  if (desc) {
    desc.addEventListener('input', () => { state.ui.rp_desc = desc.value; });
    desc.addEventListener('focus', () => setEditing(true));
    desc.addEventListener('blur',  () => setEditing(false));
  }
  if (file) {
    file.addEventListener('click', () => setEditing(true));
    file.addEventListener('change', () => {
      const f = file.files && file.files[0] ? file.files[0] : null;
      state.ui.rp_img_file = f;
      state.ui.rp_img_name = f ? f.name : '';
      if (name) name.textContent = state.ui.rp_img_name || 'Chưa chọn tệp';
      setEditing(false);
    });
    file.addEventListener('blur', () => setEditing(false));
  }
}




function renderPage() {
  const page = $('#page');
  const curBase = baseRoute(state.route);

  state.ui = state.ui || {};

  // render HTML cho trang hiện tại
  page.innerHTML = (PAGES[curBase] || PAGES['#/dashboard'])();

  if (curBase === '#/lab-handover') {
    if (state.ui.pendingSerial) {
      const el = document.getElementById('hv_serial');
      if (el) el.value = state.ui.pendingSerial;
      state.ui.pendingSerial = '';
    }
    renderLoansOpen();

  } else if (curBase === '#/lab-returns') {
    if (state.ui.pendingReturnSerial) {
      const el = document.getElementById('rt_serial');
      if (el) el.value = state.ui.pendingReturnSerial;
      state.ui.pendingReturnSerial = '';
    }
    renderLoansHistory();

  } else if (curBase === '#/shipments-receive') {
    const reopen = state.ui.shipReceiveReopenShipment;
    if (reopen) {
      state.ui.shipReceiveReopenShipment = null;
      setTimeout(() => openShipmentReceivePopup(reopen), 500);
    }

    if (state.ui.shipReceiveReturnTo) {
      const shId = state.ui.shipReceiveReturnTo;
      state.ui.shipReceiveReturnTo = null;
      openShipmentReceivePopup(shId);
    }

  } else if (curBase === '#/lab-repairs') {
    initLabRepairsPage();

  } else if (curBase === '#/lab-requests') {
    initLabRequestsPage();

    // giữ lựa chọn dropdown theo state.ui.rq_selectedKey
    const sel = $('#rq_type');
    if (sel) {
      if (!state.ui.rq_selectedKey && sel.value) {
        state.ui.rq_selectedKey = sel.value;
      } else if (state.ui.rq_selectedKey) {
        sel.value = state.ui.rq_selectedKey;
      }
    }

    // luôn cập nhật max + hint theo tồn kho - draft
    updateRqQtyLimit();

  } else if (curBase === '#/central-shipments') {
    renderCentralShipmentsGroups();

  } else if (curBase === '#/central-shipment-issues') {
    initCentralShipmentIssuesPage();
  }
}


function toggleShipmentGroup(id) {
  state.ui = state.ui || {};
  state.ui.shipGroupOpen = state.ui.shipGroupOpen || {};

  const el = document.getElementById('body-' + id);
  if (!el) return;

  const currentlyOpen = (el.style.display !== 'none');
  const nextOpen = !currentlyOpen;

  el.style.display = nextOpen ? '' : 'none';
  state.ui.shipGroupOpen[id] = nextOpen; // ✅ lưu lại để refresh không tự sổ
}
function changeShipGroupPage(id, delta) {
  state.ui = state.ui || {};
  state.ui.shipGroupPage = state.ui.shipGroupPage || {};

  const cur = state.ui.shipGroupPage[id] || 1;
  state.ui.shipGroupPage[id] = cur + delta;

  // chỉ rerender trang central-shipments (không cần renderPage để khỏi nhấp nháy)
  if (baseRoute(state.route) === '#/central-shipments') {
    renderCentralShipmentsGroups();
  }
}
// Expose cho inline onclick trong Shipments group
window.toggleShipmentGroup = toggleShipmentGroup;
window.changeShipGroupPage = changeShipGroupPage;







// ====== Generator KHÔNG cần phân loại ======

// ID nội bộ kiểu "C-EQ-1", "C-EQ-2", ...
function nextCentralId_NoType() {
  const re = /^C-EQ-(\d+)$/;
  const nums = state.data.items
    .map(i => {
      const m = String(i.id || '').match(re);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(Number.isFinite);

  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `C-EQ-${next}`;
}

// Serial auto kiểu "EQ-1001", "EQ-1002", ...
function nextSerial_NoType() {
  const prefix = 'EQ-';
  const base = 1000;

  const nums = state.data.items
    .filter(i => i.serial && i.serial.startsWith(prefix))
    .map(i => {
      const n = parseInt(i.serial.slice(prefix.length), 10);
      return Number.isFinite(n) ? n : null;
    })
    .filter(Number.isFinite);

  const next = (nums.length ? Math.max(...nums) : base) + 1;
  return `${prefix}${next}`;
}


async function submitRepairFromLab() {
  const sel = $('#rp_item')?.value;

  const descEl = document.getElementById('rp_desc');
  const desc = (descEl?.value || '').trim();

  if (!sel) return toast('Chọn thiết bị');
  if (!desc) return toast('Nhập mô tả lỗi');

  // ✅ Clear NGAY (sau validate) để dù DB/log lỗi vẫn không bị giữ text cũ
  if (descEl) { descEl.value = ''; descEl.blur(); }
  state.ui = state.ui || {};
  state.ui.rp_desc = '';     // ✅ xoá cache restore
  state.ui.rp_editing = false;
  const it = (state.data.items || []).find(x => x && x.id === sel);
  if (!it) return toast('Không tìm thấy thiết bị');

  const repId = 'REP-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const nowTs = Date.now();

  const r = {
    id: repId,
    lab_id: state.labId,
    item_id: it.id,
    serial: it.serial || it.id,
    asset_code: it.asset_code || it.assetCode || '',
    asset_name: it.asset_name || it.name || '',
    description: desc,
    status: 'Đang chờ',
    created_at: now(),
    created_at_ts: nowTs,
    img_url: ''
  };

  try {
    // optimistic update để bảng bên phải lên ngay
    state.data.repairs = state.data.repairs || [];
    state.data.repairs.unshift(r);
    try { localStorage.setItem('ef_repairs', JSON.stringify(state.data.repairs)); } catch {}

    if (window._firebase?.db) {
      const { db, set, ref } = window._firebase;
      await set(ref(db, `${DB_REPAIRS}/${r.id}`), r);
    }

    it.state = 'repair';
    if (window._firebase?.db) {
      const { db, set, ref } = window._firebase;
      await set(ref(db, `${DB_ITEMS}/${it.id}`), it);
    }

    await logActivity({
      type: 'repair_reported',
      item_id: it.id,
      item_serial: it.serial,
      meta: { repair_id: r.id, lab_id: state.labId }
    });

    toast('Đã gửi báo hỏng');
  } catch (e) {
    console.error('submitRepairFromLab failed:', e);
    toast('Gửi báo hỏng lỗi (nhưng mô tả đã được xóa để bạn nhập lại).');
  }

  // sync lại list
  await reloadCoreData();
}



// ===== LAB: gửi thiết bị về Central (cho phiếu approved_send_to_central) =====
async function labSendRepairToCentral(repairId) {
  if (state.role !== 'lab') return toast('Chỉ Lab làm được');

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');
  if (r.status !== 'Yêu cầu gửi về kho') return toast('Phiếu chưa ở trạng thái cần gửi');

  // Shipment LAB -> CENTRAL đã được Central tạo sẵn khi approve
  const sh = (state.data.shipments || []).find(s => s && s.repair_id === repairId && s.to_lab_id === 'CENTRAL');
  if (!sh) return toast('Không tìm thấy shipment gửi về Central cho phiếu này');

  if (sh.status && sh.status !== 'waiting_pickup') {
    return toast(`Shipment đã ở trạng thái: ${sh.status} (không cần bấm gửi nữa)`);
  }

  const ok = await appConfirm('Xác nhận: Lab đã gửi thiết bị về Central?', {
    title: 'Gửi về Central',
    okText: 'Gửi',
    cancelText: 'Huỷ'
  });
  if (!ok) return;

  // update shipment
  sh.status = 'sent';
  sh.sent_at = now();
  await saveData(DB_SHIPMENTS, sh.id, sh);

  // update item state (đảm bảo đúng)
  const it = (state.data.items || []).find(x => x.id === r.item_id);
  if (it) {
    it.state = 'Đang gửi về kho';
    await saveData(DB_ITEMS, it.id, it);
  }

  // update repair status
  r.status = 'Đang gửi về kho';
  r.history = r.history || [];
  r.history.push({
    ts: Date.now(),
    by: state.authUser?.email || state.labId,
    msg: `Lab đã gửi thiết bị về Central (shipment ${sh.id})`
  });
  await saveData(DB_REPAIRS, r.id, r);

  await logCentral({
    type: 'repair_sent_to_central',
    meta: { repair_id: r.id, shipment_id: sh.id, lab_id: r.lab_id }
  });

  toast('Đã đánh dấu gửi về Central');
  await reloadCoreData();
}

// ===== LAB: Done sửa tại chỗ (cho phiếu approved_on_site) =====
// ===== LAB: Done sửa tại chỗ (cho phiếu approved_on_site) =====
async function labMarkRepairDone(repairId) {
  if (state.role !== 'lab') return toast('Chỉ Lab làm được');

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');

  // chỉ cho Done khi sửa tại chỗ
  if (r.status !== 'approved_on_site') {
    return toast(`Không thể Done vì trạng thái hiện tại: ${r.status || '(trống)'}`);
  }

  const ok = (typeof appConfirm === 'function')
    ? await appConfirm('Xác nhận: Thiết bị đã sửa xong tại chỗ?', {
        title: 'Hoàn tất sửa tại chỗ',
        okText: 'Done',
        cancelText: 'Huỷ'
      })
    : confirm('Xác nhận: Thiết bị đã sửa xong tại chỗ?');

  if (!ok) return;

  try {
    // 1) update item -> available@lab
    const it = (state.data.items || []).find(x => x.id === r.item_id);
    if (it) {
      it.state = 'available@lab';
      await saveData(DB_ITEMS, it.id, it);
    }

    // 2) update repair -> completed
    r.status = 'Hoàn tất' ;
    r.completed_at = now();
    r.completed_at_ts = Date.now();
    r.history = r.history || [];
    r.history.push({
      ts: Date.now(),
      by: state.authUser?.email || state.labId,
      msg: 'Lab xác nhận đã sửa xong tại chỗ (Done)'
    });
    await saveData(DB_REPAIRS, r.id, r);

    // 3) reload để UI đổi trạng thái ngay (khỏi F5)
    toast('Đã Done');
    await reloadCoreData();

  } catch (e) {
    console.error('[labMarkRepairDone] save failed:', e);
    toast('❌ Lưu thất bại (khả năng do quyền Firebase). Mở F12 Console để xem lỗi.');
  }
}


/***** LAB ACTIONS *****/
function initLabRequestsPage() {
  const search = document.getElementById('rq_search');
  const sel    = document.getElementById('rq_type');
  const qty    = document.getElementById('rq_qty');

  const hook = (el) => {
    if (!el) return;
    el.addEventListener('focus', () => freezeUi(8000));
    el.addEventListener('mousedown', () => freezeUi(8000)); // bấm để xổ select
    el.addEventListener('keydown', () => freezeUi(8000));
    el.addEventListener('input', () => freezeUi(8000));
  };

  hook(search);
  hook(sel);
  hook(qty);
}

function renderLoansOpen() {
  const host = $('#loansOpen'); if (!host) return;
  const rows = state.data.loans.filter(l => !l.returned_at && l.lab_id === state.labId).map(l => `<tr>
    <td>${l.id}</td><td>${l.student_id}</td><td>${l.serial}</td><td>${l.due_date}</td><td><span class="pill warn">Đang mượn</span></td>
  </tr>`).join('') || `<tr><td colspan="5" class="muted-2">(Chưa có loan)</td></tr>`;
  host.innerHTML = `<table><thead><tr><th>ID</th><th>MSSV</th><th>Serial</th><th>Hạn</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderLoansHistory() {
  const host = $('#loansHistory'); if (!host) return;

  const loans = state.data.loans.slice(-12).reverse();

  const rows = loans.map(l => {
    const st = l.returned_at
      ? `<span class="pill ok">Đã trả</span>`
      : `<span class="pill warn">Đang mượn</span>`;

    return `
      <tr>
        <td>${l.id}</td>
        <td>${l.student_id}</td>
        <td>${l.serial}</td>
        <td>${l.due_date || '-'}</td>
        <td>${st}</td>
        <td>
          <button
            class="btn"
            style="padding:2px 10px;font-size:12px"
            onclick="viewLoanHistory('${l.id}')"
          >
            Xem
          </button>
        </td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="6" class="muted-2">(Chưa có dữ liệu)</td></tr>`;

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>MSSV</th>
          <th>Serial</th>
          <th>Hạn</th>
          <th>Trạng thái</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
function viewLoanHistory(loanId) {
  const box = $('#loanHistoryDetail');
  if (!box) return;

  // Khởi tạo state.ui nếu chưa có
  state.ui = state.ui || {};

  // Nếu đang mở đúng loan này => bấm lần nữa sẽ ẩn đi
  if (state.ui.selectedHistoryLoanId === loanId) {
    box.innerHTML = '';
    state.ui.selectedHistoryLoanId = null;
    return;
  }

  // Lưu lại loan đang xem
  state.ui.selectedHistoryLoanId = loanId;
  const loan = state.data.loans.find(l => l.id === loanId);
  if (!loan) {
    toast('Không tìm thấy bản ghi loan này');
    return;
  }

  // Tìm thông tin thiết bị theo serial
  const item = state.data.items.find(i => i.serial === loan.serial);
  const itemName =
    item?.asset_name ||
    item?.name ||
    item?.display_name ||
    loan.serial;

  const stHtml = loan.returned_at
    ? '<span class="pill ok">Đã trả</span>'
    : '<span class="pill warn">Đang mượn</span>';

  // ---- Tính Đúng hạn / Trễ hạn ----
  let deadlineText = '-';
  let deadlineColor = '#e5e7eb';

  if (!loan.returned_at) {
    deadlineText = 'Chưa trả';
  } else if (loan.due_date) {
    const due = parseDateLoose(loan.due_date);
    const ret = parseDateLoose(loan.returned_at);
    if (due && ret) {
      const dueOnly  = new Date(due.getFullYear(),  due.getMonth(),  due.getDate());
      const retOnly  = new Date(ret.getFullYear(),  ret.getMonth(),  ret.getDate());
      const diffMs   = retOnly.getTime() - dueOnly.getTime(); // >0: trả trễ
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

      if (diffDays <= 0) {
        deadlineText  = 'Đúng hạn';
        deadlineColor = '#22c55e'; // xanh
      } else {
        deadlineText  = `Trễ hạn ${diffDays} ngày`;
        deadlineColor = '#f97373'; // đỏ
      }
    }
  }


  if (!box) {
    // fallback nếu không có box trong DOM
    alert(
      `MSSV: ${loan.student_id}\n` +
      `Thiết bị: ${itemName}\n` +
      `Serial: ${loan.serial}\n` +
      `Ngày mượn: ${loan.created_at || '-'}\n` +
      `Hạn trả: ${loan.due_date || '-'}\n` +
      `Ngày trả: ${loan.returned_at || '-'}\n` +
      `Tình trạng hạn: ${deadlineText}`
    );
    return;
  }

  box.innerHTML = `
    <div
      style="
        padding:12px 14px;
        border-radius:12px;
        background:rgba(15,23,42,0.9);
        border:1px solid rgba(148,163,184,0.35);
        font-size:14px;
      "
    >
      <div style="font-weight:600;margin-bottom:8px">
        Chi tiết mượn trả #${loan.id}
      </div>
      <div class="muted-2" style="line-height:1.6">
        <div><b>MSSV:</b> ${loan.student_id}</div>
        <div><b>Tên thiết bị:</b> ${itemName}</div>
        <div><b>Serial:</b> ${loan.serial}</div>
        <div><b>Ngày mượn:</b> ${loan.created_at || '-'}</div>
        <div><b>Hạn trả:</b> ${loan.due_date || '-'}</div>
        <div><b>Ngày trả:</b> ${loan.returned_at || '-'}</div>
        <div><b>Trạng thái:</b> ${stHtml}</div>
        <div><b>Tình trạng hạn:</b>
          <span style="color:${deadlineColor};font-weight:600">
            ${deadlineText}
          </span>
        </div>
      </div>
    </div>
  `;
}



async function createLoan() {
  if (state.role !== 'lab') { toast('Chỉ Lab Admin mới tạo loan'); return; }
  const mssv = $('#hv_mssv').value.trim(), serial = $('#hv_serial').value.trim();
  const days = Math.max(1, parseInt($('#hv_days').value || '7', 10));
  if (!mssv || !serial) { toast('Điền MSSV và Serial'); return; }
  const item = state.data.items.find(i => i.serial === serial && i.state === 'available@lab' && i.lab_id === state.labId);
  if (!item) { toast('Thiết bị không available@lab này'); return; }
  const due = new Date(Date.now() + days * 24 * 3600 * 1000).toLocaleDateString('vi-VN');
  const loanId = 'L-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const loan = { id: loanId, lab_id: state.labId, student_id: mssv, serial, due_date: due, created_at: now() };
  state.data.loans.push(loan); item.state = 'on_loan'; item.current_holder = mssv;
  await saveData(DB_LOANS, loanId, loan); await saveData(DB_ITEMS, item.id, item);
  await logActivity({
    type: 'loan',
    item_id: item.id,
    item_serial: item.serial,
    meta: { loan_id: loan.id, to: mssv || 'N/A' }
  });
  toast('Đã tạo loan'); renderLoansOpen();
}

async function returnLoan() {
  if (state.role !== 'lab') { toast('Chỉ Lab được trả thiết bị'); return; }
  const serial = $('#rt_serial').value.trim(); if (!serial) { toast('Nhập serial'); return; }
  const item = state.data.items.find(i => i.serial === serial && i.state === 'on_loan'); if (!item) { toast('Không tìm thấy loan đang mở'); return; }
  const loan = state.data.loans.find(l => l.serial === serial && !l.returned_at);
  loan.returned_at = now(); item.state = 'available@lab'; delete item.current_holder;
  await saveData(DB_LOANS, loan.id, loan); await saveData(DB_ITEMS, item.id, item);
  await logActivity({
    type: 'return',
    item_id: item.id,
    item_serial: item.serial,
    meta: { loan_id: loan.id }
  });
  toast('Đã trả'); renderLoansHistory();
}

function clearReturnConfirm() {
  const box = $('#returnConfirmBox');
  if (box) box.innerHTML = '';
  if (state.ui) delete state.ui.rt_confirmLoanId;
}

// Bước 1: bấm "Xác nhận trả" chỉ hiển thị bảng thông tin
function showReturnConfirm() {
  clearReturnConfirm();

  if (state.role !== 'lab') {
    toast('Chỉ Lab được trả thiết bị');
    return;
  }

  const serialInput = $('#rt_serial');
  if (!serialInput) {
    toast('Không tìm thấy ô nhập serial');
    return;
  }

  const serial = serialInput.value.trim();
  if (!serial) {
    toast('Nhập serial thiết bị');
    return;
  }

  // tìm loan đang mở với serial này
  const loans = state.data.loans || [];
  const loan = loans.find(l => l.serial === serial && !l.returned_at);

  if (!loan) {
    toast('Không tìm thấy loan đang mở cho serial này');
    return;
  }

  // tìm thông tin thiết bị
  const items = state.data.items || [];
  const item = items.find(i => i.serial === serial);
  const itemName =
    item?.asset_name ||
    item?.name ||
    item?.display_name ||
    serial;

  const today = new Date().toLocaleDateString('vi-VN');
    // Tính "Đúng hạn" / "Trễ hạn X ngày"
  let statusText = '-';
  if (loan.due_date) {
    const due = parseDateLoose(loan.due_date);
    if (due) {
      const now = new Date();
      // chỉ lấy phần ngày, bỏ giờ phút
      const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());

      const diffMs = todayOnly.getTime() - dueOnly.getTime(); // >0: đã trễ
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

      if (diffDays <= 0) {
        statusText = 'Đúng hạn';
      } else {
        statusText = `Trễ hạn ${diffDays} ngày`;
      }
    }
  
  }
   // Tính màu hiển thị trạng thái
      let statusColor = '#e5e7eb'; // xám mặc định
      if (statusText.startsWith('Đúng hạn')) {
        statusColor = '#22c55e'; // xanh lá
      } else if (statusText.startsWith('Trễ hạn')) {
        statusColor = '#f97373'; // đỏ
      }


  const box = $('#returnConfirmBox');
  if (!box) return;

  box.innerHTML = `
    <div
      style="
        margin-top:4px;
        padding:12px 14px;
        border-radius:12px;
        background:rgba(15,23,42,0.9);
        border:1px solid rgba(148,163,184,0.35);
        font-size:14px;
      "
    >
      <div style="font-weight:600;margin-bottom:8px">Xác nhận thông tin trả thiết bị</div>
      <div class="muted-2" style="line-height:1.6">
        <div><b>MSSV:</b> ${loan.student_id}</div>
        <div><b>Tên thiết bị:</b> ${itemName}</div>
        <div><b>Serial:</b> ${loan.serial}</div>
        <div><b>Ngày mượn:</b> ${loan.created_at || '-'}</div>
        <div><b>Hạn trả:</b> ${loan.due_date || '-'}</div>
        <div><b>Ngày trả:</b> ${today}</div>
        <div><b>Trạng thái:</b>
           <span style="color:${statusColor};font-weight:600">
            ${statusText}
           </span>
        </div>
      </div>
      <div class="toolbar" style="margin-top:10px;justify-content:flex-end;gap:8px">
        <button class="btn" onclick="clearReturnConfirm()">Huỷ</button>
        <button class="btn primary" onclick="handleConfirmReturn()">Xác nhận</button>
      </div>
    </div>
  `;

  // nhớ loan đang confirm để dùng lại nếu cần
  state.ui = state.ui || {};
  state.ui.rt_confirmLoanId = loan.id;
}

// Bước 2: bấm "Xác nhận" trong bảng nhỏ -> thực sự trả thiết bị
async function handleConfirmReturn() {
  try {
    await returnLoan();   // dùng lại logic cũ
  } finally {
    clearReturnConfirm();
  }
}

function parseDateLoose(input) {
  if (!input) return null;

  // number (timestamp ms)
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(input).trim();
  if (!s) return null;

  // ISO / Date() parse được
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;

  // dd/mm/yyyy, HH:MM(:SS)?
  // ví dụ: "15/12/2025, 19:28:30" hoặc "15/12/2025 19:28"
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = +m[1], MM = +m[2], yyyy = +m[3];
    const hh = +(m[4] || 0), mm = +(m[5] || 0), ss = +(m[6] || 0);
    d = new Date(yyyy, MM - 1, dd, hh, mm, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  // ✅ HH:MM(:SS)? dd/mm/yyyy  (format bạn đang lưu: "19:28:30 15/12/2025")
  m = s.replace(',', '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const hh = +m[1], mm = +m[2], ss = +(m[3] || 0);
    const dd = +m[4], MM = +m[5], yyyy = +m[6];
    d = new Date(yyyy, MM - 1, dd, hh, mm, ss);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}






async function receiveShipment(shId) {
  if (state.role !== 'lab') { toast('Chỉ Lab được nhận shipment'); return; }

  const s = state.data.shipments.find(x => x.id === shId);
  if (!s) { toast('Không tìm thấy shipment'); return; }
  if (s.to_lab_id !== state.labId) { toast('Shipment không thuộc lab của bạn'); return; }
  if (s.received_at) { toast('Shipment đã nhận trước đó'); return; }

  // Lấy danh sách item-id trong shipment
  const itemIds = (s.item_ids && s.item_ids.length)
    ? s.item_ids
    : (s.items || []).map(x => x.id).filter(Boolean);

  // Xác định item nhận thực tế (loại trừ item bị đánh dấu thiếu / sai khác)
const metaRecv = s.receive_meta || {};
let missingItemIds = (metaRecv.missing_item_ids && metaRecv.missing_item_ids.length)
  ? metaRecv.missing_item_ids.slice()
  : [];

// fallback: lấy từ UI marks nếu chưa có receive_meta
if (!missingItemIds.length) {
  const marks = (state.ui.shipReceiveMarks && state.ui.shipReceiveMarks[s.id]) ? state.ui.shipReceiveMarks[s.id] : {};
  missingItemIds = Object.keys(marks).filter(k => marks[k] === 'missing');
}
missingItemIds = [...new Set(missingItemIds)].filter(id => itemIds.includes(id));

let extraSerials = (metaRecv.extra_serials && metaRecv.extra_serials.length) ? metaRecv.extra_serials.slice() : [];
if (!extraSerials.length && state.ui.shipReceiveExtras && state.ui.shipReceiveExtras[s.id]) {
  extraSerials = state.ui.shipReceiveExtras[s.id].slice();
}

const receivedItemIds = itemIds.filter(id => !missingItemIds.includes(id));

// Ghi activity: chỉ ghi các item thực nhận
await logActivity({
  type: 'shipment_received',
  shipment_id: s.id,
  item_ids: receivedItemIds,
  meta: {
    qty_total: itemIds.length,
    qty_received: receivedItemIds.length,
    qty_missing: missingItemIds.length,
    extra_serials: extraSerials.length
  }
});

// ✅ Chỉ cập nhật item ĐÃ NHẬN: in_transit -> available@lab
for (const id of receivedItemIds) {
  const idx = state.data.items.findIndex(x => x.id === id);
  if (idx < 0) continue;

  const cur = state.data.items[idx];
  const upd = { ...cur, state: 'available@lab', lab_id: s.to_lab_id, updated_at: now() };
  state.data.items[idx] = upd;

  try { await saveData(DB_ITEMS, id, upd); } catch (e) { console.warn('save item fail', id, e); }
}
// ✅ Các item bị đánh dấu THIẾU: trả về kho Trung tâm để không lẫn lộn trong tồn kho Lab
// (Lab inventory lọc theo lab_id, nên cần xóa lab_id / đưa về available@central)
for (const id of missingItemIds) {
  const idx = state.data.items.findIndex(x => x.id === id);
  if (idx < 0) continue;

  const cur = state.data.items[idx];
  const upd = { ...cur, state: 'available@central', lab_id: null, updated_at: now() };
  state.data.items[idx] = upd;

  try { await saveData(DB_ITEMS, id, upd); } catch (e) { console.warn('save missing item fail', id, e); }
}


  // Nếu đây là shipment trả thiết bị đã sửa về lab (tạo bởi centralReturnRepairedDevice)
  if (s.from_repair_id) {
    const r = (state.data.repairs || []).find(x => x.id === s.from_repair_id);
    if (r) {
      r.status = 'Hoàn tất';   // trạng thái cuối cùng khi lab đã nhận lại
      r.history = r.history || [];
      r.history.push({
        ts: Date.now(),
        by: state.authUser?.email || state.labId,
        msg: 'Lab đã nhận lại thiết bị sau sửa chữa'
      });
      await saveData(DB_REPAIRS, r.id, r);
    }
  }

  // Đánh dấu shipment đã nhận
  s.status = 'received';
  s.received_at = now();
  s.item_ids = itemIds;
  delete s.items;

    // Lưu kết quả kiểm tra (checks) + sai khác (nếu có)
    // => để mở lại shipment vẫn hiện Đúng/Thiếu, không bị về "Chưa kiểm tra"
    const uiMarks =
      (state.ui.shipReceiveMarks && state.ui.shipReceiveMarks[s.id])
        ? state.ui.shipReceiveMarks[s.id]
        : {};

    // Build checks cuối cùng: mặc định OK hết, item nào missing thì missing
    const finalChecks = {};
    for (const id of itemIds) {
      finalChecks[id] = (uiMarks[id] === 'missing' || missingItemIds.includes(id)) ? 'missing' : 'ok';
    }

    s.receive_meta = s.receive_meta || {};
    s.receive_meta.checks = { ...finalChecks };              // itemId -> 'ok' | 'missing'
    s.receive_meta.extra_serials = extraSerials.slice();     // serial ngoài shipment
    s.receive_meta.missing_item_ids = missingItemIds.slice();
    s.receive_meta.received_item_ids = receivedItemIds.slice();
    s.receive_meta.received_qty = receivedItemIds.length;
    s.receive_meta.total_qty = itemIds.length;

    // mismatch_at: chỉ set khi có sai khác
    if (missingItemIds.length || extraSerials.length) {
      s.receive_meta.mismatch_at = s.receive_meta.mismatch_at || Date.now();
    } else {
      // không xóa receive_meta nữa, chỉ bỏ mismatch_at cho gọn
      delete s.receive_meta.mismatch_at;
    }

    s.receive_meta.finalized_at = Date.now();



  try { await saveData(DB_SHIPMENTS, s.id, s); } catch (e) { console.warn('save shipment fail', s.id, e); }

  toast(`Đã nhận shipment ${s.id}`);
  renderPage();
}

async function confirmReceiveShipment(shId) {
  // chặn double click
  state.ui.shipReceiveSubmitting = state.ui.shipReceiveSubmitting || {};
  if (state.ui.shipReceiveSubmitting[shId]) return;
  state.ui.shipReceiveSubmitting[shId] = true;

  // disable nút ngay
  const btn = document.getElementById('btnReceiveShipment_' + shId);
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    btn.textContent = 'Đang nhận...';
  }

  try {
    state.ui.shipReceiveMarks = state.ui.shipReceiveMarks || {};
    state.ui.shipReceiveExtras = state.ui.shipReceiveExtras || {};

    const marks = state.ui.shipReceiveMarks[shId] || {};
    const missingItemIds = Object.keys(marks).filter(k => marks[k] === 'missing');
    const extraSerials = state.ui.shipReceiveExtras[shId] || [];

    const s = (state.index && state.index.shipmentsById && state.index.shipmentsById.get(shId))
      || (state.data.shipments || []).find(x => x.id === shId);
    if (!s) { toast('Không tìm thấy shipment'); return; }

    // lưu mismatch vào shipment
    if (missingItemIds.length || extraSerials.length) {
      s.receive_meta = s.receive_meta || {};
      s.receive_meta.missing_item_ids = missingItemIds;
      s.receive_meta.extra_serials = extraSerials;
      s.receive_meta.mismatch_at = Date.now();

      // ✅ tạo phiếu báo sai khác gửi kho trung tâm + link vào shipment
      await createShipmentIssueAndLink(s, missingItemIds, extraSerials);

      try { await saveData(DB_SHIPMENTS, s.id, s); } catch (e) {
        console.warn('save shipment receive_meta fail', s.id, e);
      }
    }

    // nhận shipment (logic của bạn đang xử lý: ok vào lab, missing trả về central)
    await receiveShipment(shId);

    closeShipmentPopup();
  } catch (e) {
    console.error(e);
    toast('Lỗi nhận hàng. Vui lòng thử lại.');

    // cho phép bấm lại nếu lỗi
    state.ui.shipReceiveSubmitting[shId] = false;
    const btn2 = document.getElementById('btnReceiveShipment_' + shId);
    if (btn2) {
      btn2.disabled = false;
      btn2.style.opacity = '';
      btn2.style.pointerEvents = '';
      btn2.textContent = 'Nhận hàng';
    }
  }
}




// Gọi hàm này sau khi trang #/central-import vừa render
function initCentralImportPage() {
  state.importBatch.step = 1;
  renderImportStep1();
}

// Step 1 UI: chọn file Excel và xem preview rawLines
function renderImportStep1() {
  const host = document.getElementById('importStep');
  if (!host) return;

  host.innerHTML = `
    <div class="card sm-12" style="background:#0f1726;border:1px solid rgba(255,255,255,.08);margin-top:12px">
      <h2 style="margin-top:0">Bước 1 • Chọn file Excel</h2>
      <p class="muted-2" style="font-size:13px">
        File cần có các cột ví dụ: "Số hiệu tài sản", "Tên tài sản", "Quy cách", "Năm sử dụng", "Số lượng".
      </p>

      <input type="file" id="excelFile" accept=".xlsx,.xls" style="margin-bottom:12px;background:#0c121d;color:#e7eefc" />

      <div id="rawPreview" style="max-height:240px;overflow:auto;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px;font-size:13px;color:#c7d1e0;background:#0c121d;">
        (Chưa có dữ liệu)
      </div>

      <div class="toolbar" style="margin-top:12px">
        <button class="btn primary" id="goStep2Btn" disabled>Tiếp tục → Bung số lượng</button>
      </div>
    </div>
  `;

  // gắn event
  const fileInput = document.getElementById('excelFile');
  const btnNext = document.getElementById('goStep2Btn');
  const rawBox = document.getElementById('rawPreview');

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // parse excel thành rows[]
    const rows = await parseExcelFile(file);

    // map rows -> state.importBatch.rawLines
    state.importBatch.rawLines = rows.map((r, idx) => {
      return {
        // tên field ở đây bạn chỉnh theo header thực tế trong file Excel của bạn
        rowIndex: idx + 1,
        assetCode: r["Số hiệu Tài sản"] || r["Số hiệu"] || "",
        name: r["Tên tài sản"] || "",
        spec: r["Quy cách, đặc điểm tài sản"] || r["Quy cách"] || "",
        year: r["Năm sử dụng"] || r["Năm"] || "",
        quantity: Number(r["Số lượng"] || r["SL"] || 1)
      };
    });

    // render preview text đơn giản
    if (!state.importBatch.rawLines.length) {
      rawBox.textContent = "(Không đọc được dòng nào)";
      btnNext.disabled = true;
      return;
    }

    const htmlRows = state.importBatch.rawLines.map(line => {
      return `
        <div style="border-bottom:1px dashed rgba(255,255,255,.1);padding:6px 0">
          <div><b>Hàng ${line.rowIndex}</b></div>
          <div>Mã TS: ${line.assetCode}</div>
          <div>Tên: ${line.name}</div>
          <div>Quy cách: ${line.spec}</div>
          <div>Năm: ${line.year}</div>
          <div>Số lượng: ${line.quantity}</div>
        </div>
      `;
    }).join('');

    rawBox.innerHTML = htmlRows;
    btnNext.disabled = false;
  });

  btnNext.addEventListener('click', () => {
    // sau này ta sẽ viết hàm buildExpandedItemsFromRaw() và renderImportStep2()
    buildExpandedItemsFromRaw();
    renderImportStep2();
  });
}

// đọc file Excel -> rows[] (Promise)
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      const sheet = wb.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      resolve(rows);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Tạm placeholder cho step 2, mình sẽ điền khung luôn
function buildExpandedItemsFromRaw() {
  // TODO:
  // - lặp qua state.importBatch.rawLines
  // - tạo từng item riêng lẻ với id/serial duy nhất (nextCentralId / nextSerial)
  // - generate QR -> item.qr_png
  // Hiện tại chỉ khởi tạo mảng rỗng để tránh lỗi
  state.importBatch.expandedItems = [];
}

function renderImportStep2() {
  const host = document.getElementById('importStep');
  if (!host) return;
  host.innerHTML = `
    <div class="card sm-12" style="background:#0f1726;border:1px solid rgba(255,255,255,.08);margin-top:12px">
      <h2 style="margin-top:0">Bước 2 • Bung số lượng → Thiết bị cụ thể</h2>
      <p class="muted-2" style="font-size:13px">
        TODO: hiển thị danh sách từng thiết bị sẽ tạo, mỗi thiết bị 1 serial riêng, kèm QR preview.
      </p>

      <div class="toolbar" style="margin-top:12px">
        <button class="btn" onclick="renderImportStep1()">← Quay lại</button>
        <button class="btn primary" onclick="/* commitImportBatch(); renderImportStep3(); */" disabled>
          Ghi vào kho (chưa bật)
        </button>
      </div>
    </div>
  `;
}

/***** CENTRAL ACTIONS *****/


async function approveRequest(reqId) {
  if (state.role !== 'central') {
    toast('Chỉ Central được duyệt yêu cầu');
    return;
  }

  const r = state.data.labRequests.find(x => x.id === reqId);
  if (!r) return;

  for (let idx = 0; idx < r.lines.length; idx++) {
    const l = r.lines[idx];

    let want = 0;
    if (Array.isArray(l.item_ids) && l.item_ids.length) {
      want = l.item_ids.length;
      // xác thực từng id còn sẵn
      for (const id of l.item_ids) {
        const it = state.index.itemsById.get(id);
        if (!it || it.state !== 'available@central') {
          toast(`Thiết bị ${serialOf(id)} không sẵn sàng ở Central. Không thể duyệt.`);
          return;
        }
      }
    } else {
      const inp = document.querySelector(`.appr-input[data-req="${reqId}"][data-line="${idx}"]`);
      want = Math.max(0, parseInt(inp?.value || l.qty_requested || '0', 10));

      const avail = centralAvailableByGroup(l.asset_code, l.asset_name);
      if (want === 0) { toast(`Số lượng approve cho ${l.asset_code || ''} - ${l.asset_name || ''} đang là 0.`); return; }
      if (avail < want) { toast(`Kho không đủ ${l.asset_code || ''} - ${l.asset_name || ''}. Cần ${want}, chỉ có ${avail}.`); return; }
      if (want < l.qty_requested) { toast(`${l.asset_code || ''} - ${l.asset_name || ''} chưa đủ để cấp toàn bộ (${l.qty_requested}).`); return; }
    }

    l.qty_approved = want;
  }


  // 3. Cập nhật trạng thái request
  r.status = 'Đã duyệt';
  r.approved_at = now();
  await saveData(DB_REQUESTS, r.id, r);

  // 4. Log activity cho dashboard
  const qtyTotal = r.lines.reduce((s, l) => s + (l.qty_approved || 0), 0);
  await logCentral({
    type: 'request_approved',
    meta: { request_id: r.id, qty_total: qtyTotal }
  });

  toast(`Đã duyệt yêu cầu #${reqId}`);
  renderPage?.();
  refreshDashboardActivityCard?.();
}



async function createShipmentFromRequest(reqId) {
  if (state.role !== 'central') {
    toast('Chỉ Central được tạo shipment');
    return;
  }

  const r = state.data.labRequests.find(x => x.id === reqId);
  if (!r) return;

  const pickedItems = [];

  for (const l of r.lines) {
    if (Array.isArray(l.item_ids) && l.item_ids.length) {
      // pick đúng các id đã chọn
      for (const id of l.item_ids) {
        const it = state.index.itemsById.get(id);
        if (!it || it.state !== 'available@central') {
          toast(`Thiết bị ${serialOf(id)} không sẵn sàng để xuất.`);
          return;
        }
        it.state = 'Đang giao';
        it.lab_id = r.lab_id;
        pickedItems.push(it);
        await saveData(DB_ITEMS, it.id, it);
      }
    } else {
      // fallback: logic cũ theo số lượng / nhóm
      const qty = l.qty_approved || 0;
      if (qty > 0) {
        const picked = pickFromCentralGroup(l.asset_code, l.asset_name, qty, r.lab_id);
        for (const it of picked) {
          pickedItems.push(it);
          await saveData(DB_ITEMS, it.id, it);
        }
      }
    }
  }

  if (!pickedItems.length) { toast('Không có item nào được approve để tạo shipment'); return; }


  // đảm bảo request có mốc duyệt
  if (!r.approved_at) {
    r.approved_at = now();
  }

  // tạo shipment
  const sid = 'SHP-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const item_ids = pickedItems.map(i => i.id);

  const shipment = {
    id: sid,
    from_lab_id: 'CENTRAL',          // 👈 THÊM
    to_lab_id: r.lab_id,
    status: 'Đang giao',   // 👈 chuẩn web 2
    item_ids,
    created_at: now()
  };

  state.data.shipments.push(shipment);
  await saveData(DB_SHIPMENTS, sid, shipment);

  // đánh dấu request đã hoàn tất
  r.status = 'Hoàn tất';
  r.shipment_id = sid;
  r.fulfilled_at = now();
  await saveData(DB_REQUESTS, r.id, r);

  // log activity để Central dashboard thấy
  await logCentral({
    type: 'shipment_created',
    shipment_id: sid,
    to_lab_id: r.lab_id,
    item_ids,
    meta: { qty: item_ids.length }
  });

  toast(`Đã tạo shipment #${sid} → ${r.lab_id}`);

  renderPage?.();
  refreshDashboardActivityCard?.();
  navigate('#/central-shipments');
}




function groupKeyOf(it) {
  // Ưu tiên gom theo "số hiệu tài sản" nếu có,
  // nếu không thì gom theo loại
  if (it.asset_code) return `AC:${it.asset_code}`;
  return `TYPE:${it.type_id}`;
}


// ====== Central: thêm thiết bị chi tiết + QR TEXT ======
async function addCentralItemDetailed() {
  if (state.role !== 'central') {
    toast('Chỉ Central được thêm thiết bị');
    return;
  }

  const val = sel => (document.querySelector(sel)?.value || '').trim();

  // KHÔNG còn type_id
  let serialBase = val('#addd_serial');         // có thể trống
  const qty = Math.max(1, parseInt(val('#addd_qty') || '1', 10));

  const asset_code = val('#addd_assetcode');      // Số hiệu tài sản
  const asset_year = val('#addd_year');           // Năm sử dụng
  const asset_name = val('#addd_name');           // Tên tài sản (rất quan trọng sau này)
  const mfg = val('#addd_mfg');
  const model = val('#addd_model');
  const condition = val('#addd_condition');
  const source = val('#addd_source');
  const specs = val('#addd_specs');
  const notes = val('#addd_notes');

  if (!asset_name) {
    toast('Nhập Tên tài sản');
    return;
  }

  let createdCount = 0;
  let lastItem = null;

  // lặp theo số lượng cần tạo
  for (let i = 0; i < qty; i++) {

    // 1. quyết định serial cho chiếc này
    let serial = serialBase;
    if (qty > 1 && serialBase) {
      // VD user gõ "PC-10401" và qty=3 -> PC-10401-1,2,3
      serial = `${serialBase}-${i + 1}`;
    }
    if (!serial) {
      // nếu không nhập serial -> auto chung hệ EQ-...
      serial = nextSerial_NoType();
    }
    // Nếu trùng serial đã có -> xin lại auto
    if (state.data.items.some(x => x.serial === serial)) {
      serial = nextSerial_NoType();
    }

    // 2. sinh id nội bộ
    const id = nextCentralId_NoType();

    // 3. dựng object item
    const it = {
      id,
      serial,
      // giữ field type_id rỗng để code chỗ khác không crash
      type_id: '',

      state: 'available@central',

      // thông tin quản trị/ghi sổ
      asset_code: asset_code,
      asset_name: asset_name,   // đây là nhãn chính để Lab yêu cầu sau này
      asset_year: asset_year,

      // mô tả kỹ thuật
      name: asset_name,         // để cho trang /item hiển thị đẹp
      mfg,
      model,
      condition,
      source,
      specs,
      notes
    };

    // 4. tạo QR TEXT từ buildItemQrText(it)
    const payload = buildItemQrText(it);
    try {
      if (window.QRCode?.toDataURL) {
        it.qr_png = await QRCode.toDataURL(payload, { margin: 1, scale: 6 });
      } else if (window.QRCode?.toCanvas) {
        const c = document.createElement('canvas');
        await QRCode.toCanvas(c, payload, { margin: 1, scale: 6 });
        it.qr_png = c.toDataURL('image/png');
      } else {
        it.qr_png =
          'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' +
          encodeURIComponent(payload);
      }
    } catch (e) {
      it.qr_png =
        'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' +
        encodeURIComponent(payload);
    }

    // 5. lưu vào state + Firebase
    state.data.items.push(it);
    await saveData(DB_ITEMS, id, it);

    // 6. log activity để hiện ở dashboard
    await logCentral({
      type: 'item_added',
      item_id: it.id,
      item_serial: it.serial,
      // vẫn gửi type_id (rỗng) cho an toàn backward
      type_id: it.type_id
    });

    createdCount++;
    lastItem = it;
  }

  // 7. preview cái cuối cùng vừa nhập
  if (lastItem) {
    const payload = buildItemQrText(lastItem);
    const host = document.getElementById('qrPreviewAdd');
    if (host) {
      host.innerHTML = '';

      const img = new Image();
      img.width = 200;
      img.height = 200;
      img.src = lastItem.qr_png || '';
      img.style.border = '1px solid rgba(255,255,255,.12)';
      img.style.borderRadius = '10px';
      img.style.padding = '8px';
      img.style.background = '#0c121d';

      const meta = document.createElement('div');
      meta.innerHTML = `
        <div><b>${lastItem.serial}</b></div>
        <div class="muted-2" style="white-space:pre-line">${payload}</div>
      `;

      const a = document.createElement('a');
      a.className = 'btn';
      a.download = `QR_\${lastItem.serial}.png`;
      a.textContent = 'Tải QR PNG';
      a.href = lastItem.qr_png || '#';

      host.append(img, meta, a);
    }
  }

  toast(`Đã thêm ${createdCount} thiết bị`);
  refreshDashboardActivityCard?.();
}




/***** Utility: regenerate all item QR as TEXT *****/
async function regenAllItemQrAsText() {
  for (const it of state.data.items) {
    const payload = buildItemQrText(it);
    try {
      if (window.QRCode?.toDataURL) {
        it.qr_png = await QRCode.toDataURL(payload, { margin: 1, scale: 6 });
      } else if (window.QRCode?.toCanvas) {
        const c = document.createElement('canvas');
        await QRCode.toCanvas(c, payload, { margin: 1, scale: 6 });
        it.qr_png = c.toDataURL('image/png');
      } else {
        it.qr_png = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(payload);
      }
      await saveData(DB_ITEMS, it.id, it);
    } catch (e) {
      console.warn('Regen QR fail', it.serial, e);
    }
  }
  toast('Đã chuyển tất cả QR sang TEXT.');
}

// Central: thêm/xoá thiết bị
async function addCentralItem() {
  if (state.role !== 'central') { toast('Chỉ Central được thêm thiết bị'); return; }
  const typeEl = $('#add_type'), serialEl = $('#add_serial');
  const type = typeEl?.value;
  if (!type) { toast('Chọn loại'); return; }

  let serial = (serialEl?.value || '').trim();
  if (!serial) serial = nextSerial(type);
  if (state.data.items.some(i => i.serial === serial)) { toast('Serial đã tồn tại'); return; }

  const id = nextCentralId(type);
  const it = { id, serial, type_id: type, state: 'available@central' };

  state.data.items.push(it);
  await generateItemQR(it);
  await saveData(DB_ITEMS, id, it);

  // ✅ ĐÚNG biến
  await logCentral({
    type: 'item_added',
    item_id: it.id,
    item_serial: it.serial,
    type_id: it.type_id
  });

  toast(`Đã thêm ${serial}`);
  // renderPage() có thể không tồn tại -> dùng render hoặc refresh card
  requestActivityCardRefresh();

}

async function deleteCentralItem(id) {
  if (state.role !== 'central') { toast('Chỉ Central được xoá thiết bị'); return; }
  const it = state.data.items.find(i => i.id === id);
  if (!it) { toast('Không tìm thấy thiết bị'); return; }
  if (it.state !== 'available@central') { toast('Chỉ xoá thiết bị đang available@central'); return; }

  // Giữ snapshot trước khi xoá để log
  const removed = { ...it };

  await deleteData(DB_ITEMS, id);
  state.data.items = state.data.items.filter(i => i.id !== id);

  // ✅ ĐÚNG biến
  await logCentral({
    type: 'item_removed',
    item_id: removed.id,
    item_serial: removed.serial,
    type_id: removed.type_id
  });

  toast(`Đã xoá ${removed.serial}`);
  requestActivityCardRefresh();

}

/***** SEED ITEMS LẦN ĐẦU *****/
/***** SEED ITEMS LẦN ĐẦU *****/
async function seedItemsIfEmpty() {
  const items = await getAll(DB_ITEMS);
  if (items && Object.keys(items).length) return;

  // tạo 3 nhóm item rồi FLATTEN thành 1 mảng
  const defaults = [
    ...Array.from({ length: 18 }, (_, i) => ({
      id: `C-LAP-${i + 1}`,
      serial: `LAP-${1000 + i}`,
      type_id: 'type-LAP',
      state: 'available@central'
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `C-OSC-${i + 1}`,
      serial: `OSC-${2000 + i}`,
      type_id: 'type-OSC',
      state: 'available@central'
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `C-PSU-${i + 1}`,
      serial: `PSU-${3000 + i}`,
      type_id: 'type-PSU',
      state: 'available@central'
    }))
  ];

  for (const it of defaults) {
    await saveData(DB_ITEMS, it.id, it);
  }
}



/***** LOAD SAU LOGIN *****/
/***** LOAD SAU LOGIN *****/
async function afterLogin(u) {
  // Gắn role cố định theo tài khoản đăng nhập
  state.role = u.defaultRole || 'lab';
  state.labId = u.labId || state.labId;

  // Khóa dropdown role + header info
  const rs = $('#roleSelect');
  if (rs) {
    if (state.role === 'lab') {
      rs.innerHTML = `<option value="lab">Lab Admin – ${state.labId}</option>`;
      rs.value = 'lab';
    } else {
      rs.innerHTML = `<option value="central">Central Admin</option>`;
      rs.value = 'central';
    }
    rs.disabled = true;
  }

  $('#profileBox').textContent = `${u.name} • ${u.email}`;
  showApp();

  // Seed labs nếu DB trống
  await seedLabsIfEmpty();
  // ✅ Vá issue cũ để nút "Xem" không bị "Không tìm thấy issue"
  if (state.role === 'central') {
    await backfillShipmentIssueIdsOnce();
  }

  // Load data ban đầu
  await reloadCoreData();

  // Render lần đầu
  state.route = location.hash || '#/dashboard';
  renderNav();
  renderPage();

  __handleItemDeepLink();

    // Bắt đầu auto sync
  startDataSync();

  // ✅ quay lại tab sẽ tự reload ngay (khỏi cần F5)
  hookWakeReload();
}

$('#logoutBtn').addEventListener('click', () => {
  clearSession();
  stopDataSync();
  toast('Đã đăng xuất');
  showAuth();
});


/***** INIT *****/
async function init() {
  bindAuth();
  $('#globalSearch')?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.currentTarget.focus();
    }
  });
  const s = await sessionUser();
  if (s) { setSession(s); afterLogin(s); } else showAuth();
}
init();



/***** Utility: regenerate all item QR as URL *****/
async function regenAllItemQrAsUrl() {
  for (const it of state.data.items) {
    const url = buildItemUrlBySerial(it.serial);
    try {
      if (window.QRCode?.toDataURL) {
        it.qr_png = await QRCode.toDataURL(url, { margin: 1, scale: 6 });
      } else if (window.QRCode?.toCanvas) {
        const c = document.createElement('canvas');
        await QRCode.toCanvas(c, url, { margin: 1, scale: 6 });
        it.qr_png = c.toDataURL('image/png');
      } else {
        it.qr_png = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' + encodeURIComponent(url);
      }
      await saveData(DB_ITEMS, it.id, it);
    } catch (e) {
      console.warn('Regen QR fail', it.serial, e);
    }
  }
  toast('Đã chuyển tất cả QR sang URL.');
}


/***** MODAL: Xem thông tin thiết bị + QR (Central) *****/
function viewCentralItem(id) {
  const it = state.data.items.find(x => x.id === id);
  if (!it) { toast('Không tìm thấy thiết bị'); return; }

  const content = `
    <h1 style="margin-top:0">${it.serial || it.id}</h1>

    <table>
      <tr>
        <th style="width:200px">Số hiệu tài sản</th>
        <td>${it.asset_code || it.assetCode || ''}</td>
      </tr>

      <tr>
        <th>Năm sử dụng</th>
        <td>${it.asset_year || ''}</td>
      </tr>

      <tr>
        <th>Tên tài sản</th>
<td>${it.asset_name || it.name || ''}</td>


</tr>

      <tr>
        <th>Hãng sản xuất</th>
        <td>${it.mfg || ''}</td>
      </tr>

      <tr>
        <th>Model</th>
        <td>${it.model || ''}</td>
      </tr>

      <tr>
        <th>Tình trạng / % hao mòn</th>
        <td>${it.condition || ''}</td>
      </tr>

      <tr>
        <th>Nguồn</th>
        <td>${it.source || ''}</td>
      </tr>

      <tr>
        <th>Thông số</th>
        <td>${(it.specs || '').replaceAll('\n', '<br/>')}</td>
      </tr>

      <tr>
        <th>Ghi chú</th>
        <td>${it.notes || ''}</td>
      </tr>

      <tr>
        <th>Trạng thái kho</th>
        <td>
          ${it.state || ''}
          ${it.lab_id ? (' • Lab: ' + it.lab_id) : ''}
        </td>
      </tr>
    </table>

    <div style="margin-top:16px;display:flex;justify-content:center">
      ${it.qr_png
      ? `<img src="${it.qr_png}"
                  alt="QR"
                  style="
                    width:200px;
                    height:200px;
                    border:1px solid rgba(255,255,255,.1);
                    border-radius:10px;
                    padding:8px;
                    background:#0c121d
                  "/>`
      : '<span class="muted-2">(Chưa có QR)</span>'
    }
    </div>
  `;

  const host = document.getElementById('itemModalContent');
  if (host) host.innerHTML = content;
  const modal = document.getElementById('itemModal');
  if (modal) modal.classList.remove('hidden');
}

function closeItemModal() { document.getElementById('itemModal')?.classList.add('hidden'); }
// Expose cho inline onclick (nếu index.html dùng type="module")
window.viewCentralItem = viewCentralItem;
window.closeItemModal = closeItemModal;


// ===== Modal: click ra ngoài để đóng + mở modal bằng HTML =====
let __itemModalBackdropBound = false;
function ensureItemModalBackdropClose() {
  if (__itemModalBackdropBound) return;
  __itemModalBackdropBound = true;

  const modal = document.getElementById('itemModal');
  if (!modal) return;

  // Click đúng overlay (nền tối) thì đóng
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeItemModal();
  });

  // Nhấn ESC để đóng
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.getElementById('itemModal');
      if (m && !m.classList.contains('hidden')) closeItemModal();
    }
  });
}

function openModalHtml(html) {
  ensureItemModalBackdropClose();
  const modal = document.getElementById('itemModal');
  const host = document.getElementById('itemModalContent');
  if (host) host.innerHTML = html || '';
  if (modal) modal.classList.remove('hidden');
}

// ===== Kho trung tâm: mở bảng thiết bị theo nhóm trên modal =====
function openCentralStockGroupModal(encodedKey, keepPage) {
  ensureItemModalBackdropClose();

  let key = encodedKey || '';
  try { key = decodeURIComponent(key); } catch (e) {}

  state.ui = state.ui || {};

  // Nếu mở group mới thì reset về trang 1
  if (state.ui.centralStockGroup !== key) {
    state.ui.centralStockGroup = key;
    state.ui.centralGroupModalPage = 1;
  } else {
    // Nếu render lại cùng group: giữ trang (khi bấm Next/Prev)
    if (!keepPage) state.ui.centralGroupModalPage = 1;
  }

  const parts = key.split('::');
  const selCode = parts[0] || '';
  const selName = parts.slice(1).join('::') || '';

  const allItems = (state.data.items || []).filter(it => {
    if (!it) return false;
    if (it.state !== 'available@central') return false;
    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || it.model || '(không tên)';
    return (code === selCode && name === selName);
  });

  // ✅ Phân trang 7 thiết bị/trang
  const perPage = 7;
  const totalPages = Math.max(1, Math.ceil(allItems.length / perPage));
  let page = state.ui.centralGroupModalPage || 1;
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  state.ui.centralGroupModalPage = page;

  const start = (page - 1) * perPage;
  const slice = allItems.slice(start, start + perPage);

  const itemRows = slice.map(it => `
    <tr>
      <td>${it.serial || '-'}</td>
      <td>${it.asset_name || it.name || ''}</td>
      <td>${it.id}</td>
      <td class="toolbar">
        <button class="btn" onclick="viewCentralItem('${it.id}')">Xem</button>
        <button class="btn danger" onclick="deleteCentralItem('${it.id}')">Xoá</button>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="4" class="muted-2">(Không có thiết bị phù hợp)</td>
    </tr>
  `;

  const detailTitle = `Thiết bị của nhóm “${selName || '(không tên)'}” (Số hiệu ${selCode || '-'})`;

  const pager = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px">
      <div class="muted-2" style="font-size:12px">
        Trang ${page} / ${totalPages} • Tổng ${allItems.length} thiết bị
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="changeCentralGroupModalPage(-1)" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="changeCentralGroupModalPage(1)" ${page >= totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  `;

  openModalHtml(`
    <div style="padding-right:28px">
      <h2 style="margin:0 0 10px 0">${detailTitle}</h2>

      <table>
        <thead>
          <tr>
            <th>Serial</th>
            <th>Tên tài sản</th>
            <th>ID nội bộ</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      ${pager}

      <div class="muted-2" style="font-size:12px;margin-top:8px">
        Nhấn <b>X</b>, <b>Esc</b> hoặc click ra vùng tối bên ngoài để đóng.
      </div>
    </div>
  `);
}

// ===== Kho trung tâm: phân trang trong modal (7 thiết bị / trang) =====
function changeCentralGroupModalPage(delta) {
  state.ui = state.ui || {};
  const key = state.ui.centralStockGroup || '';
  if (!key) return;

  const parts = key.split('::');
  const selCode = parts[0] || '';
  const selName = parts.slice(1).join('::') || '';

  const all = (state.data.items || []).filter(it => {
    if (!it) return false;
    if (it.state !== 'available@central') return false;
    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || it.model || '(không tên)';
    return (code === selCode && name === selName);
  });

  movePage('centralGroupModalPage', delta, all.length, 7, () => {
    openCentralStockGroupModal(encodeURIComponent(key), true);
  });
}
window.changeCentralGroupModalPage = changeCentralGroupModalPage;


// ===== Trang liệt kê phòng Lab (Central) =====
PAGES['#/labs'] = () => {
  if (state.role !== 'central') {
    return `<div class="card"><h1>Phòng Lab</h1><p class="muted">Chỉ Central xem được.</p></div>`;
  }
  const rows = (state.data.labs || []).map(L => `
    <tr>
      <td>${L.id}</td>
      <td>${L.name || '-'}</td>
      <td>${labAvailableById(L.id)}</td>
      <td><button class="btn" onclick="navigate('#/lab-view?lab=${encodeURIComponent(L.id)}')">Xem kho</button></td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="muted-2">(Chưa có phòng Lab)</td></tr>`;

  return `<div class="card"><h1>Danh sách phòng Lab</h1>
    <table>
      <thead><tr><th>Mã</th><th>Tên</th><th>Thiết bị có sẵn</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
};

// ===== Trang xem kho của 1 Lab (Central) =====
// ===== Trang xem kho của 1 Lab (Central) - hiển thị giống Tồn kho Lab =====
PAGES['#/lab-view'] = () => {
  if (state.role !== 'central') {
    return `<div class="card"><h1>Kho Lab</h1><p class="muted">Chỉ Central xem được.</p></div>`;
  }

  const q = getQuery();
  const labId = q.lab || '';
  const info = (state.data.labs || []).find(x => x.id === labId);

  // lấy list nhóm của lab này (dùng lại helper labStockGroups)
  const groups = labStockGroups(labId);  // 👈 y như bên lab
  state.ui.centralLabInv = state.ui.centralLabInv || {};

  // nếu central chưa chọn nhóm nào cho lab này thì chọn nhóm đầu
  if (!state.ui.centralLabInv[labId] && groups.length) {
    state.ui.centralLabInv[labId] = groups[0].key;
  }

  const selectedKey = state.ui.centralLabInv[labId] || '';
  let selCode = '', selName = '';
  if (selectedKey) {
    const parts = selectedKey.split(':::');
    selCode = parts[0] || '';
    selName = parts.slice(1).join(':::') || '';
  }

  // lọc ra đúng thiết bị thuộc lab + đúng nhóm (mã + tên)
  const list = (state.data.items || []).filter(it => {
    if (!it) return false;
    if (it.lab_id !== labId) return false;
    const code = it.asset_code || it.assetCode || '(không mã)';
    const name = it.asset_name || it.name || '(chưa đặt tên)';
    return code === selCode && name === selName;
  });

  const total = list.length;
  const avail = list.filter(x => x.state === 'available@lab').length;
  const onLoan = list.filter(x => x.state === 'on_loan').length;

  // render dropdown giống hệt bên #/lab-inventory
  const headerHtml = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <h1 style="margin:0">Tồn kho Lab ${info?.name || labId}</h1>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="muted-2" style="white-space:nowrap">Chọn thiết bị</span>
        ${groups.length
      ? `<select
                  onchange="setCentralLabInvGroup('${labId}', this.value)"
                  style="min-width:140px;max-width:500px;background:#0c121d">
                  ${groups.map(g => {
        const sel = (g.key === selectedKey) ? 'selected' : '';
        const safeVal = g.key.replace(/'/g, "\\'");
        return `<option value='${safeVal}' ${sel}>${g.asset_code} - ${g.asset_name}</option>`;
      }).join('')}
               </select>`
      : `<span class="muted-2">(Chưa có thiết bị)</span>`
    }
      </div>
    </div>
  `;

  // bảng chi tiết của nhóm đang chọn
  const rowsHtml = list.length
    ? list.map(it => `
        <tr>
          <td>${it.serial || '-'}</td>
          <td>${it.asset_name || it.name || '-'}</td>
          <td>
            <span class="tag ${it.state === 'available@lab' ? 'ok' : ''}">
              ${it.state || '-'}
            </span>
          </td>
          <td><button class="btn" onclick="viewCentralItem && viewCentralItem('${it.id}')">Xem</button></td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" class="muted-2">(Không có thiết bị thuộc nhóm này)</td></tr>`;

  return `
    <div class="card">
      ${headerHtml}
      <div class="muted-2" style="margin:10px 0 12px">
        Tổng: ${total}    • Thiết bị có sẵn: ${avail}    • Đang mượn: ${onLoan}
      </div>
      <table>
        <thead>
          <tr>
            <th>Serial</th>
            <th>Tên thiết bị</th>
            <th>Trạng thái</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
};


// ===== CENTRAL • BÁO HỎNG (UI mới có popup "Xem") =====
// ===== CENTRAL • BÁO HỎNG (UI mới có popup "Xem") =====
const REPAIRS_PAGE_SIZE = 7;

function setCentralRepairsPage(nextPage) {
  state.ui = state.ui || {};
  state.ui.centralRepairsPage = Math.max(1, nextPage || 1);
  renderPage();
}

function ensureRepairModalDom() {
  ensureRepairModalStyles();

  let modal = document.getElementById('repairModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'repairModal';
    modal.className = 'hidden'; // QUAN TRỌNG: mặc định ẩn

    modal.innerHTML = `
      <div class="modal-body" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2 id="repairModalTitle" style="margin:0"></h2>
          <button class="btn" onclick="closeRepairPopup()" style="min-width:44px">✕</button>
        </div>
        <div id="repairModalContent"></div>
      </div>
    `;
    document.body.appendChild(modal);

    // click ra ngoài để đóng
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeRepairPopup();
    });
  }
  return modal;
}

PAGES['#/central-repairs'] = () => {
  if (state.role !== 'central') {
    return `<div class="card"><h1>Báo hỏng</h1><p class="muted">Chỉ Central xem được.</p></div>`;
  }

  // đảm bảo modal tồn tại nhưng đang ẩn
  ensureRepairModalDom();

  // sort mới nhất lên trước
  const repairsAll = (state.data.repairs || [])
    .slice()
    .sort((a, b) => (b.reported_at || b.created_at_ts || 0) - (a.reported_at || a.created_at_ts || 0));

  // pagination
  state.ui = state.ui || {};
  const total = repairsAll.length;
  const totalPages = Math.max(1, Math.ceil(total / REPAIRS_PAGE_SIZE));
  const page = Math.min(state.ui.centralRepairsPage || 1, totalPages);
  state.ui.centralRepairsPage = page;

  const start = (page - 1) * REPAIRS_PAGE_SIZE;
  const repairs = repairsAll.slice(start, start + REPAIRS_PAGE_SIZE);

  const rows = repairs.map(r => {
    const it = (state.data.items || []).find(x => x.id === r.item_id) || {};
    const name = it.asset_name || it.name || r.title || '';
    const serial = it.serial || r.serial || r.item_id || '';
    const lab = r.lab_id || it.lab_id || '';

    const stRaw = (r.status || 'reported');
    const stText =
      (stRaw === 'reported') ? 'Đang chờ'
      : (stRaw === 'completed') ? 'Hoàn tất'
      : stRaw;

    const pillCls =
      (stText === 'Hoàn tất') ? 'ok'
      : (stText === 'Yêu cầu gửi về kho' || stText === 'Đang gửi về kho') ? 'warn'
      : (stText === 'Đang chờ') ? 'bad'
      : 'warn';

    return `
      <tr>
        <td>${r.id}</td>
        <td>${serial}</td>
        <td>${name}</td>
        <td>${lab}</td>
        <td><span class="pill ${pillCls}">${stText}</span></td>
        <td><button class="btn" onclick="openRepairPopup('${r.id}')">Xem</button></td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" class="muted-2">(Chưa có báo hỏng)</td></tr>`;


  const pagerHtml = total ? `
    <div class="muted-2" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>Trang ${page} / ${totalPages} • Tổng ${total}</div>
      <div style="display:flex;gap:10px">
        <button class="btn" onclick="setCentralRepairsPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>← Trước</button>
        <button class="btn" onclick="setCentralRepairsPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Sau →</button>
      </div>
    </div>
  ` : '';

  return `
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h1 style="margin:0">Xử lý báo hỏng</h1>

      <!-- ✅ Nút xuất báo hỏng góc phải -->
      <div class="toolbar" style="gap:8px">
        <button class="btn primary" onclick="exportRepairReport()">🛠️ Xuất báo hỏng</button>
      </div>
    </div>

    <table style="margin-top:10px">
      <thead>
        <tr>
          <th>ID</th><th>Thiết bị</th><th>Tên thiết bị</th>
          <th>Lab</th><th>Trạng thái</th><th>Hành động</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${pagerHtml}
  </div>
  `;

};

window.setCentralRepairsPage = setCentralRepairsPage;
window.openRepairPopup = openRepairPopup;
window.closeRepairPopup = closeRepairPopup;


function closeRepairPopup() {
  const modal = document.getElementById('repairModal');
  if (modal) modal.classList.add('hidden');
  document.removeEventListener('keydown', __repairEsc);
}

function __repairEsc(e) { if (e.key === 'Escape') closeRepairPopup(); }

function ensureRepairModalStyles() {
  if (document.getElementById('repairModalStyles')) return;

  // SCOPE theo #repairModal để không đè lên modal khác
  const css = `
  /* ===== BASE MODAL (dùng chung) ===== */
.modal{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.60);
  display:flex;
  align-items:center;
  justify-content:center;
  z-index:9999;
}
.modal.hidden{ display:none; }
.modal .modal-body{
  background:#0f1622;
  border-radius:16px;
  box-shadow:0 10px 30px rgba(0,0,0,.45);
  width:min(1100px,95vw);
  max-height:90vh;
  overflow:auto;
  padding:18px 22px;
}
.modal .modal-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:8px;
}

/* modal quét QR luôn cao hơn các modal khác */
#shipScanModal{ z-index:10001; }

  #repairModal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000}
  #repairModal.hidden{display:none}
  #repairModal .modal-body{background:#0f1622;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);width:min(980px,95vw);padding:18px 22px;max-height:85vh;overflow:auto}
  #repairModal .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  #repairModal .grid{display:grid}
  #repairModal .cols-2{grid-template-columns:1fr 1fr}
  #repairModal .muted-2{opacity:.7}
  #repairModal .history-box{border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden}
  #repairModal .history-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(255,255,255,.03);cursor:pointer}
  #repairModal .history-body{padding:10px 12px;display:none}
  #repairModal .history-body.show{display:block}
  #repairModal .toolbar{display:flex;gap:8px}
  #repairModal .btn.danger{background:#7a1f24}
  `;

  const style = document.createElement('style');
  style.id = 'repairModalStyles';
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureShipmentReceiveModalStyles() {
  if (document.getElementById('shipmentModalStyles')) return;

  const css = `
  #shipmentModal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999}
  #shipmentModal.hidden{display:none}
  #shipmentModal .modal-body{background:#0f1622;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.45);width:min(980px,95vw);padding:18px 22px;max-height:88vh;overflow:auto}
  #shipmentModal .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  `;

  const style = document.createElement('style');
  style.id = 'shipmentModalStyles';
  style.textContent = css;
  document.head.appendChild(style);
}


function toggleHistoryBox(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show');
}

function openRepairPopup(repId) {
  ensureRepairModalDom();

  const r = (state.data.repairs || []).find(x => x.id === repId);
  if (!r) { toast && toast('Không tìm thấy báo hỏng'); return; }

  // Lấy tên thiết bị
  let itemName = r.item_name || '';
  if (!itemName) {
    const all = state.data.items || [];
    let found = null;
    if (r.item_id) found = all.find(it => it.id === r.item_id);
    if (!found && r.serial) found = all.find(it => it.serial === r.serial);
    if (found) itemName = found.item_name || found.name || found.asset_name || '';
  }
  if (!itemName) itemName = '(Chưa có tên)';


  // Lịch sử (collapsible)
  const his = Array.isArray(r.history) ? r.history : [];
  const historyId = `his_${r.id}`;
  const historyHead = `<div class="history-head" onclick="toggleHistoryBox('${historyId}')">
      <span>🕓 Lịch sử</span>
      <small>${his.length ? (his.length + ' mục') : 'Nhấn để xem'}</small>
    </div>`;
  const historyBody = `<div id="${historyId}" class="history-body">
      ${his.length
        ? his.map(h => {
            const timeStr = h.time || (h.ts ? new Date(h.ts).toLocaleString('vi-VN') : '');
            const msg = h.msg || h.note || h.action || (h.status ? `Trạng thái: ${h.status}` : '-');
            return `<div style="margin-bottom:8px">
                      <div><b>${msg}</b></div>
                      <div class="muted-2" style="font-size:12px">${timeStr ? timeStr + ' • ' : ''}${h.by || ''}</div>
                    </div>`;
          }).join('')
        : `<div class="muted-2">(Chưa có lịch sử)</div>`}
    </div>`;

    // Nút hành động (tuỳ theo trạng thái)
    // Nút hành động (tuỳ theo trạng thái)
let st = r.status || 'Đang chờ';

// ✅ Nếu đã có shipment inbound (LAB -> CENTRAL) thì suy ra trạng thái từ shipment
const shInbound = (state.data.shipments || []).find(s => s && s.repair_id === r.id && s.to_lab_id === 'CENTRAL');
if ((st === 'reported' || st === 'Đang chờ') && shInbound) {
  if (shInbound.status === 'waiting_pickup') st = 'Yêu cầu gửi về kho';
  else if (shInbound.status === 'sent' || shInbound.status === 'Đang giao') st = 'Đang gửi về kho';
  else if (shInbound.status === 'received') st = 'at_central';
}


    state.ui = state.ui || {};
    const busy = (state.ui.repairBusyId === r.id);

    let actionsHtml = '';

    if (busy) {
      // ✅ Khi đang xử lý: KHÔNG cho bấm gì thêm
      actionsHtml = `<button class="btn" disabled>Đang xử lý...</button>`;
    }
    else if (st === 'reported' || st === 'Đang chờ') {
      actionsHtml = `
        <button class="btn" onclick="centralApproveRepairSendToCentral('${r.id}')">Duyệt: Gửi về Central</button>
        <button class="btn" onclick="centralApproveRepairOnSite('${r.id}')">Duyệt: Cử người xuống</button>
      `;
    }
    else if (st === 'Yêu cầu gửi về kho' || st === 'Đang gửi về kho') {
      actionsHtml = `
        <button class="btn primary" onclick="centralRepairReceive('${r.id}')">Nhận</button>
      `;
    }
    else if (st === 'at_central') {
      actionsHtml = `
        <button class="btn primary" onclick="centralRepairDone('${r.id}')">Done</button>
      `;
    }
    else {
      actionsHtml = `<span class="muted-2">Không có hành động cho trạng thái: <b>${st}</b></span>`;
    }



  // Render modal
  const modal = document.getElementById('repairModal');
  const titleEl = document.getElementById('repairModalTitle');
  const contentEl = document.getElementById('repairModalContent');

  if (titleEl) titleEl.textContent = `Báo hỏng ${r.id}`;
  if (contentEl) {
    contentEl.innerHTML = `
      <div class="grid cols-2" style="gap:18px">
        <div>
          <p><b>ID phiếu:</b> ${r.id}</p>
          <p><b>Thiết bị:</b> ${r.serial || r.item_id || '(không rõ)'}</p>
          <p><b>Tên thiết bị:</b> ${itemName}</p>
          <p><b>Lab báo:</b> ${r.lab_id || '(không rõ)'}</p>
          <p><b>Trạng thái:</b> ${st}</p>


          <h3 style="margin-top:12px">Mô tả lỗi</h3>
          <div class="muted-2">${(r.desc || r.description || '(Không có)').toString().replace(/\n/g, '<br/>')}</div>

        </div>
        <div>
          <h3 style="margin-top:0">Hành động</h3>
          <div class="toolbar" style="flex-wrap:wrap">${actionsHtml}</div>
          
          <h3 style="margin-top:0">Lịch sử</h3>
          <div class="history-box">${historyHead}${historyBody}</div>
        </div>

      </div>
    `;
  }

  if (modal) modal.classList.remove('hidden');
  document.addEventListener('keydown', __repairEsc);
}

async function centralApproveRepairSendToCentral(repairId) {
  if (state.role !== 'central') return toast('Chỉ Central làm được');

  state.ui = state.ui || {};
  if (state.ui.repairBusyId) return;         // đang xử lý cái khác thì thôi
  state.ui.repairBusyId = repairId;
  openRepairPopup(repairId);                 // ✅ refresh popup để hiện "Đang xử lý..."

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) { state.ui.repairBusyId = null; return toast('Không tìm thấy phiếu'); }

  const it = (state.data.items || []).find(x => x.id === r.item_id);
  if (!it) { state.ui.repairBusyId = null; return toast('Không tìm thấy thiết bị của phiếu'); }

  // backup để rollback nếu fail
  const prevStatus = r.status;
  const prevItemState = it.state;
  const prevShipLen = (state.data.shipments || []).length;

  // ✅ optimistic update: đổi UI NGAY
  it.state = 'Đang gửi về kho';
  const sid = 'SHP-IN-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const sh = {
    id: sid,
    from_lab_id: r.lab_id,
    to_lab_id: 'CENTRAL',
    status: 'waiting_pickup',
    item_ids: [it.id],
    repair_id: r.id,
    created_at: now()
  };

  state.data.shipments = state.data.shipments || [];
  state.data.shipments.push(sh);

  r.status = 'Yêu cầu gửi về kho';
  r.history = r.history || [];
  r.history.push({ ts: Date.now(), by: state.authUser?.email || 'central', msg: 'Yêu cầu lab gửi thiết bị về central' });

  // refresh UI + popup ngay (khỏi đợi DB)
  renderPage();
  openRepairPopup(repairId);

  try {
    await saveData(DB_ITEMS, it.id, it);
    await saveData(DB_SHIPMENTS, sid, sh);
    await saveData(DB_REPAIRS, r.id, r);

    await logCentral({
      type: 'repair_approved',
      item_id: it.id,
      item_serial: it.serial,
      meta: { repair_id: r.id, shipment_id: sid, mode: 'send_to_central' }
    });

    toast('Đã yêu cầu lab gửi thiết bị về central');
  } catch (e) {
    console.error('centralApproveRepairSendToCentral failed:', e);

    // rollback local state
    it.state = prevItemState;
    r.status = prevStatus;
    if (state.data.shipments && state.data.shipments.length > prevShipLen) {
      state.data.shipments.splice(prevShipLen);
    }

    toast('Thao tác lỗi, vui lòng thử lại.');
  } finally {
    state.ui.repairBusyId = null;
    renderPage();
    openRepairPopup(repairId); // ✅ đảm bảo popup ra đúng trạng thái cuối cùng
  }
}



async function centralApproveRepairOnSite(repairId) {
  if (state.role !== 'central') return toast('Chỉ Central làm được');

  state.ui = state.ui || {};
  if (state.ui.repairBusyId) return;          // đang xử lý cái khác
  state.ui.repairBusyId = repairId;

  // refresh popup để khóa nút ngay
  try { openRepairPopup(repairId); } catch {}

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) {
    state.ui.repairBusyId = null;
    return toast('Không tìm thấy phiếu');
  }

  // backup để rollback nếu fail
  const prevStatus = r.status;
  const prevHistoryLen = (r.history || []).length;

  // ✅ optimistic update (đổi UI ngay)
  r.status = 'approved_on_site';
  r.history = r.history || [];
  r.history.push({
    ts: Date.now(),
    by: state.authUser?.email || 'central',
    msg: 'Cử người xuống sửa tại chỗ'
  });

  renderPage();
  try { openRepairPopup(repairId); } catch {}

  try {
    await saveData(DB_REPAIRS, r.id, r);

    await logCentral({
      type: 'repair_approved',
      meta: { repair_id: r.id, mode: 'on_site' }
    });

    toast('Đã đánh dấu sửa tại chỗ');
  } catch (e) {
    console.error('centralApproveRepairOnSite failed:', e);

    // rollback
    r.status = prevStatus;
    if (r.history && r.history.length > prevHistoryLen) {
      r.history.splice(prevHistoryLen);
    }

    toast('Thao tác lỗi, vui lòng thử lại.');
  } finally {
    state.ui.repairBusyId = null;
    renderPage();
    try { openRepairPopup(repairId); } catch {}
  }
}



async function centralRejectRepair(repairId) {
  if (state.role !== 'central') return;
  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');

  r.status = 'rejected';
  r.history = r.history || [];
  r.history.push({ ts: Date.now(), by: state.authUser?.email || 'central', msg: 'Từ chối phiếu sửa' });
  await saveData(DB_REPAIRS, r.id, r);

  await logCentral({
    type: 'repair_closed',
    meta: { repair_id: r.id, reason: 'rejected' }
  });

  toast('Đã từ chối');
  renderPage();
}
async function labConfirmSendShipment(shId) {
  const s = state.data.shipments.find(x => x.id === shId);
  if (!s) return toast('Không tìm thấy shipment');

  if (s.from_lab_id !== state.labId) return toast('Shipment này không thuộc lab của bạn');

  // Cập nhật trạng thái shipment
  s.status = 'Đang giao';
  s.sent_at = now();
  await saveData(DB_SHIPMENTS, s.id, s);

  // Nếu shipment này gắn với phiếu sửa thì cập nhật luôn repair.status
  if (s.repair_id) {
    const r = (state.data.repairs || []).find(x => x.id === s.repair_id);
    if (r) {
      r.status = 'Đang gửi về kho';
      r.history = r.history || [];
      r.history.push({
        ts: Date.now(),
        by: state.authUser?.email || state.labId,
        msg: 'Lab đã gửi thiết bị lên central'
      });
      await saveData(DB_REPAIRS, r.id, r);
    }
  }

  toast('Đã đánh dấu đã gửi lên central');
  renderPage();
}

function shipStatusText(st) {
  const k = String(st || '').trim();
  const map = {
    in_transit: 'Đang giao',
    received: 'Đã nhận'
    // muốn thêm status khác thì thêm ở đây
  };
  return map[k] || k;
}


function renderTable(list, kind) {
  if (!Array.isArray(list) || !list.length) {
    return `<div class="muted-2">(Không có shipment)</div>`;
  }
  const rows = list.map(s => {
    const qty = countItems(s);
    const path = `${s.from_lab_id || 'CENTRAL'} → ${s.to_lab_id || 'CENTRAL'}`;
    const action = (kind === 'l2c' && s.to_lab_id === 'CENTRAL' && s.status !== 'received')
      ? `<button class="btn" onclick="centralReceiveInboundShipment('${s.id}')">Nhận hàng</button>`
      : '';
    return `
      <tr>
        <td>${s.id}</td>
        <td>${path}</td>
        <td>${shipStatusText(s.status)}</td>
        <td>${qty} items</td>
        <td>${action}</td>
      </tr>
    `;
  }).join('');
  return `
    <table>
      <thead><tr><th>ID</th><th>Tuyến</th><th>Trạng thái</th><th>Số lượng</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function centralReceiveInboundShipment(shId) {
  if (state.role !== 'central') return;

  const s = state.data.shipments.find(x => x.id === shId);
  if (!s) return toast('Không tìm thấy shipment');

  if (s.to_lab_id !== 'CENTRAL') return toast('Shipment này không phải gửi về central');

  const itemIds = itemsOf(s);

  for (const id of itemIds) {
    const idx = state.data.items.findIndex(x => x.id === id);
    if (idx < 0) continue;

    const it = state.data.items[idx];
    // khi central đã nhận đồ hỏng rồi → cho nó về trạng thái "at_central_repair"
    it.state = 'at_central_repair';
    it.lab_id = '';  // tạm không thuộc lab nào
    await saveData(DB_ITEMS, it.id, it);
    state.data.items[idx] = it;
  }

  // nếu shipment này gắn với phiếu sửa thì cập nhật luôn
  if (s.repair_id) {
    const r = (state.data.repairs || []).find(x => x.id === s.repair_id);
    if (r) {
      r.status = 'at_central';
      r.history = r.history || [];
      r.history.push({ ts: Date.now(), by: state.authUser?.email || 'central', msg: 'Central đã nhận thiết bị hỏng' });
      await saveData(DB_REPAIRS, r.id, r);
    }
  }

  s.status = 'received';
  s.received_at = now();
  await saveData(DB_SHIPMENTS, s.id, s);

  await logCentral({
    type: 'shipment_received',
    shipment_id: s.id,
    meta: { direction: 'lab_to_central', qty: itemIds.length }
  });

  toast('Đã nhận shipment từ Lab');
  renderPage();
}
 // ===== CENTRAL: Nhận thiết bị hỏng về kho (từ phiếu repair) =====
async function centralRepairReceive(repairId) {
  if (state.role !== 'central') return toast('Chỉ Central làm được');

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');

  // tìm shipment LAB -> CENTRAL của phiếu này
  const sh = (state.data.shipments || []).find(s => s && s.repair_id === repairId && s.to_lab_id === 'CENTRAL');
  if (!sh) return toast('Không tìm thấy shipment gửi về Central cho phiếu này');

  // Lab chưa bấm gửi thì chưa cho nhận
  if (sh.status === 'waiting_pickup') {
    return toast('Lab chưa gửi thiết bị (shipment vẫn waiting_pickup)');
  }
  if (sh.status === 'received') {
    return toast('Shipment đã được nhận rồi');
  }

  const ok = await appConfirm(`Xác nhận: Central đã nhận thiết bị của phiếu ${repairId}?`, {
    title: 'Nhận thiết bị',
    okText: 'Nhận',
    cancelText: 'Huỷ'
  });
  if (!ok) return;

  await centralReceiveInboundShipment(sh.id); // hàm sẵn có: set item.at_central_repair + repair.at_central + ship.received

  // refresh lại popup để nút đổi từ "Nhận" -> "Done"
  openRepairPopup(repairId);
}

// ===== CENTRAL: Done sửa xong tại kho trung tâm =====
async function centralRepairDone(repairId) {
  if (state.role !== 'central') return toast('Chỉ Central làm được');

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');

  // chỉ cho Done sau khi đã "Nhận" về kho
  if (r.status !== 'at_central') {
    return toast('Phiếu chưa ở trạng thái at_central (chưa Nhận về kho)');
  }

  const it = (state.data.items || []).find(x => x.id === r.item_id);
  if (!it) return toast('Không tìm thấy thiết bị của phiếu');

  const ok = await appConfirm(`Xác nhận: đã sửa xong thiết bị của phiếu ${repairId}?`, {
    title: 'Hoàn tất sửa chữa',
    okText: 'Done',
    cancelText: 'Huỷ'
  });
  if (!ok) return;

  // thiết bị trở lại trạng thái có sẵn ở kho trung tâm
  it.state = 'available@central';
  await saveData(DB_ITEMS, it.id, it);

  // cập nhật phiếu
  r.status = 'Hoàn tất';
  r.completed_at = now();
  r.completed_at_ts = Date.now();
  r.history = r.history || [];
  r.history.push({ ts: Date.now(), by: state.authUser?.email || 'central', msg: 'Central sửa xong (Done) → thiết bị available@central' });
  await saveData(DB_REPAIRS, r.id, r);

  await logCentral({
    type: 'repair_done_central',
    item_id: it.id,
    item_serial: it.serial,
    meta: { repair_id: r.id }
  });

  toast('Đã Done – thiết bị về trạng thái có sẵn');
  await reloadCoreData();
  openRepairPopup(repairId);
}



/**
 * Central sửa xong → tạo shipment trả về lại Lab
 */
async function centralReturnRepairedDevice(repairId) {
  if (state.role !== 'central') return;

  const r = (state.data.repairs || []).find(x => x.id === repairId);
  if (!r) return toast('Không tìm thấy phiếu');

  const it = (state.data.items || []).find(x => x.id === r.item_id);
  if (!it) return toast('Không tìm thấy thiết bị');

  // tạo shipment chiều CENTRAL -> LAB (giống createShipmentForDamage)
  const sid = 'SHP-REP-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const ship = {
    id: sid,
    to_lab_id: r.lab_id,
    status: 'Đang giao',
    item_ids: [it.id],
    created_at: now(),
    from_repair_id: r.id
  };

  state.data.shipments.push(ship);
  await saveData(DB_SHIPMENTS, sid, ship);

  // item đang ở central → chuyển sang in_transit
  it.state = 'Đang giao';
  await saveData(DB_ITEMS, it.id, it);

  // cập nhật phiếu
  r.status = 'returned_after_repair';
  r.history = r.history || [];
  r.history.push({ ts: Date.now(), by: state.authUser?.email || 'central', msg: 'Gửi lại thiết bị đã sửa về lab' });
  await saveData(DB_REPAIRS, r.id, r);

  await logCentral({
    type: 'repair_shipment_created',
    item_id: it.id,
    item_serial: it.serial,
    meta: { repair_id: r.id, shipment_id: sid }
  });

  toast('Đã tạo shipment trả về lab');
  renderPage();
}




// ====== Trang Import (Central) ======
PAGES['#/central-import'] = () => `
  <div class="cards">
    <div class="card sm-4">
      <h1>Import thiết bị (Excel)</h1>

      <p class="muted">
        File .xlsx/.xls/.csv với các cột:
        <b>Serial</b> (có thể để trống để hệ thống tự sinh),
        <b>Số hiệu tài sản</b>,
        <b>Năm sử dụng</b>,
        <b>Tên tài sản</b>,
        <b>Hãng</b>,
        <b>Model</b>,
        <b>Tình trạng</b>,
        <b>Nguồn</b>,
        <b>Ngày mua</b>,
        <b>Hết BH</b>,
        <b>Thông số</b>,
        <b>Ghi chú</b>,
        <b>Số lượng</b> (SL).
      </p>

      <div class="grid cols-1">
        <div>
          <label>Chọn file</label>
          <input id="imp_file" type="file" accept=".xlsx,.xls,.csv"
                 onchange="handleImportFile(this.files && this.files[0])" />
        </div>

        <div class="toolbar" style="margin-top:8px">
          <button class="btn" onclick="downloadImportTemplate()">Tải template (Excel)</button>
          <button class="btn primary" onclick="startCentralImport(this)">Bắt đầu nhập</button>
        </div>
      </div>
    </div>

    <div class="card sm-8">
      <h2>Xem trước</h2>
      <div id="imp_preview" class="muted-2">(Chưa có dữ liệu)</div>
      <div id="imp_summary" class="muted" style="margin-top:8px"></div>
    </div>
  </div>
`;


let _impRows = [];  // dữ liệu đã chuẩn hoá & validate

function downloadImportTemplate() {
  if (!window.XLSX) { toast('Thiếu thư viện Excel'); return; }

  const headers = [
    'Serial',
    'Số hiệu tài sản',
    'Năm sử dụng',
    'Tên tài sản',
    'Hãng',
    'Model',
    'Tình trạng',
    'Nguồn',
    'Ngày mua',
    'Hết BH',
    'Thông số',
    'Ghi chú',
    'SL'
  ];

  const sample = [
    [
      'EQ-1001',          // Serial (có thể bỏ trống)
      '10401',            // Số hiệu tài sản
      '2019',             // Năm sử dụng
      'Máy tính bộ LCD 22" Asus', // Tên tài sản
      'Dell',             // Hãng
      '5520',             // Model
      'Mới / hao mòn 10%',// Tình trạng
      'DA',               // Nguồn
      '2024-09-01',       // Ngày mua
      '2027-09-01',       // Hết BH
      'Core i7 / 16GB / 512GB SSD', // Thông số
      'Giao cho bộ môn A',          // Ghi chú
      1                   // SL
    ]
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  XLSX.utils.book_append_sheet(wb, ws, 'Import');
  XLSX.writeFile(wb, 'equipflow_import_template.xlsx');
}


// map header -> key chuẩn
function mapHeader(h) {
  const raw = String(h || '').trim();
  const s = raw.toLowerCase();

  // serial / mã duy nhất
  if ([
    'serial', 's/n', 'sn', 'mã', 'ma', 'mã thiết bị', 'ma thiet bi'
  ].includes(s)) return 'serial';

  // số hiệu tài sản (ghi sổ)
  if ([
    'số hiệu tài sản', 'so hieu tai san',
    'mã ts', 'ma ts',
    'asset code', 'asset_code'
  ].includes(s)) return 'asset_code';

  // năm sử dụng
  if ([
    'năm sử dụng', 'nam su dung',
    'năm', 'nam',
    'year'
  ].includes(s)) return 'asset_year';

  // tên tài sản / mô tả
  if ([
    'tên', 'ten',
    'tên tài sản', 'ten tai san',
    'tên/mô tả', 'ten/mo ta',
    'name',
    'mô tả', 'mo ta',
    'description', 'mota'
  ].includes(s)) return 'name';

  // hãng
  if ([
    'hãng', 'hang',
    'mfg', 'manufacturer'
  ].includes(s)) return 'mfg';

  // model
  if (['model', 'mdl'].includes(s)) return 'model';

  // tình trạng (nhiều kiểu header khác nhau)
  // ví dụ: "Tình trạng / % hao mòn", "Tình trạng/ % hao mòn", "Tình trạng % hao mòn"
  // => mình bắt bằng .includes cho chắc
  if (
    s.includes('tình trạng') ||
    s.includes('tinh trang') ||
    s.includes('hao mòn') ||
    s.includes('hao mon')
  ) {
    return 'condition';
  }

  // nguồn
  if ([
    'nguồn', 'nguon',
    'source', 'funding'
  ].includes(s)) return 'source';

  // ngày mua
  if ([
    'ngày mua', 'ngay mua',
    'purchase', 'purchase_date', 'purchased'
  ].includes(s)) return 'purchase_date';

  // hết bh
  if ([
    'hết bh', 'het bh',
    'warranty', 'warranty_end', 'warranty end'
  ].includes(s)) return 'warranty_end';

  // thông số
  if (
    s.includes('thông số') ||
    s.includes('thong so') ||
    s.includes('quy cách') ||
    s.includes('quy cach') ||
    s.includes('đặc điểm') ||
    s.includes('dac diem') ||
    ['spec', 'specs'].includes(s)
  ) {
    return 'specs';
  }

  // ghi chú
  if ([
    'ghi chú', 'ghi chu',
    'notes', 'note'
  ].includes(s)) return 'notes';

  // số lượng
  if ([
    'số lượng', 'so luong',
    'qty', 'sl'
  ].includes(s)) return 'qty';

  return null;
}




// tìm id loại từ tên hiển thị hoặc id
function mapTypeToId(val) {
  const raw = String(val || '').trim();
  if (!raw) return '';
  // nếu đã là id dạng type-... thì giữ nguyên
  if (/^type-\w+/i.test(raw)) return raw;
  // so theo tên (case-insensitive)
  const t = (state.data.itemTypes || []).find(x => (x.name || '').toLowerCase() === raw.toLowerCase());
  return t ? t.id : '';
}

function normalizeRow(rawRow) {
  // map từng cột thủ công thay vì mapHeader() cũ
  const out = {
    asset_code: String(rawRow['Số hiệu tài sản'] || '').trim(), // 1070411
    year: String(rawRow['Năm sử dụng'] || '').trim(),     // 2019
    name: String(rawRow['Tên tài sản'] || '').trim(),     // "Bộ cảm biến y sinh..."
    qty: parseInt(rawRow['Số lượng'] || '1', 10) || 1,    // 23, 2, ...
    mfg: String(rawRow['Hãng sản xuất'] || '').trim(),    // Dell, ...
    model: String(rawRow['Model'] || '').trim(),
    condition: String(rawRow['Tình trạng/% hao mòn'] || '').trim(), // "20"
    source: String(rawRow['Nguồn'] || '').trim(),            // "DA"
    specs: String(rawRow['Thông số'] || '').trim()          // nếu có
  };

  out._errors = [];
  // bạn có thể validate nhẹ
  if (!out.name) out._errors.push('Thiếu Tên tài sản');
  if (!out.asset_code) out._errors.push('Thiếu Số hiệu tài sản');
  out._status = out._errors.length ? 'ERROR' : 'OK';

  return out;
}




function validateImportRows(rows) {
  const existing = new Set(
    (state.data.items || [])
      .map(i => String(i.serial || '').trim())
      .filter(Boolean)
  );

  for (const r of rows) {
    r._errors = [];

    // bắt buộc tên tài sản để hiển thị trong kho
    if (!r.name) {
      r._errors.push('Thiếu Tên tài sản');
    }

    // số lượng phải >= 1
    if (!r.qty || r.qty < 1) {
      r._errors.push('Số lượng không hợp lệ');
    }

    // nếu chỉ nhập 1 chiếc và có serial sẵn thì check trùng
    if (r.qty === 1 && r.serial && existing.has(r.serial)) {
      r._errors.push('Serial đã tồn tại');
    }

    r._status = r._errors.length ? 'ERROR' : 'OK';
  }
}



function renderImportPreview(rows) {
  const host = document.getElementById('imp_preview');
  const sum = document.getElementById('imp_summary');
  if (!host) return;

  if (!rows.length) {
    host.innerHTML = '<p class="muted-2">(Không có dữ liệu)</p>';
    if (sum) sum.textContent = '';
    return;
  }

  const head = `
    <thead>
      <tr>
        <th>#</th>
        <th>Serial</th>
        <th>Số hiệu tài sản</th>
        <th>Tên tài sản</th>
        <th>Hãng</th>
        <th>Model</th>
        <th>Tình trạng</th>
        <th>SL</th>
        <th>Trạng thái</th>
      </tr>
    </thead>`;

  const body = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>

      <td>${r.serial
      ? r.serial
      : '<i class="muted-2">(auto)</i>'}
      </td>

      <td>${r.asset_code || ''}</td>

      <td>${r.name || ''}</td>

      <td>${r.mfg || ''}</td>

      <td>${r.model || ''}</td>

      <td>${r.condition || ''}</td>

      <td style="text-align:center">${r.qty}</td>

      <td>${r._status === 'OK'
      ? '<span class="pill ok">OK</span>'
      : '<span class="pill bad">Lỗi: ' + r._errors.join('; ') + '</span>'
    }</td>
    </tr>`).join('');

  host.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;

  const ok = rows.filter(r => r._status === 'OK').length;
  if (sum) {
    sum.textContent =
      `Tổng dòng: ${rows.length} • Hợp lệ: ${ok} • Lỗi: ${rows.length - ok}`;
  }
}



async function handleImportFile(file) {
  if (!file) return;
  try {
    if (!window.XLSX) { toast('Thiếu thư viện Excel'); return; }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    let raw = XLSX.utils.sheet_to_json(ws, { defval: '' }); // [{Header:Value,...}]
    raw = raw.filter(r => Object.values(r).some(v => String(v).trim() !== ''));
    const rows = raw.map(normalizeRow);
    validateImportRows(rows);
    _impRows = rows;
    renderImportPreview(rows);
  } catch (e) {
    console.error(e);
    toast('Không đọc được file. Vui lòng kiểm tra định dạng.');
  }
}

function inferTypeFromSerial(serialLike) {
  const s = String(serialLike || '').trim();
  // Lấy cụm chữ cái đầu (trước dấu -) làm prefix. VD "EQ-1001" -> "EQ"
  const m = s.match(/^([A-Za-z]+)[-_]?/);
  const prefix = m ? m[1].toUpperCase() : 'GEN'; // fallback GEN nếu không đoán được
  return 'type-' + prefix; // ra kiểu "type-EQ", "type-GEN"
}
async function startCentralImport(btnEl) {
  // btnEl = nút "Bắt đầu nhập" (truyền từ onclick)
  const btn = btnEl || null;

  // chống double-click
  state.ui = state.ui || {};
  if (state.ui._centralImportBusy) return;
  state.ui._centralImportBusy = true;

  // disable + đổi text để thấy đã nhấn
  const oldText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang nhập...';
  }

  // ✅ FIX: tạm dừng auto sync để reloadCoreData không đè state.data.items giữa lúc import
  const _syncWasRunning = !!_dataSyncTimer;
  stopDataSync();

  try {
    if (state.role !== 'central') {
      toast('Chỉ Central được import');
      return;
    }

    const okRows = _impRows.filter(r => r._status === 'OK');
    const expected = okRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

    if (!okRows.length) {
      toast('Không có dòng hợp lệ để nhập');
      return;
    }
    // ✅ mở sớm để tránh popup bị chặn (vì sau đó có await)
    const printWin = window.open('', '_blank');
    if (!printWin) {
      toast('Trình duyệt đang chặn pop-up. Hãy cho phép pop-up để in QR sau khi nhập.');
    }
    const importedItems = []; // ✅ lưu các item vừa import để in QR
      
    let ok = 0, fail = 0;

    for (const r of okRows) {
      for (let idx = 1; idx <= r.qty; idx++) {
        try {
          // 1. xác định serial cuối cùng
          let serialFinal = '';
          if (r.serial) {
            // nếu SL>1 thì tạo serial-1, serial-2,...
            serialFinal = (r.qty > 1)
              ? `${r.serial}-${idx}`
              : r.serial;
          }

          // đoán prefix nội bộ từ serial (hoặc fallback GEN)
          let tmpTypeId = inferTypeFromSerial(serialFinal || r.name || r.asset_code);

          // nếu serial đang trống -> tự sinh bằng prefix đó
          if (!serialFinal) {
            serialFinal = nextSerial(tmpTypeId); // ví dụ "EQ-1002" hoặc "GEN-1"
          }

          // nếu serialFinal đụng cái đã tồn tại thì sinh cái mới
          if (state.data.items.some(i => i.serial === serialFinal)) {
            serialFinal = nextSerial(tmpTypeId);
          }

          // 2. sinh ID nội bộ cho item (C-EQ-1 ...)
          const newId = nextCentralId(tmpTypeId);

          // 3. đóng gói object thiết bị
          const it = {
            id: newId,
            serial: serialFinal,
            type_id: tmpTypeId,          // chỉ dùng nội bộ để sinh ID/serial
            state: 'available@central',

            asset_code: r.asset_code || '',
            asset_year: r.year ?? r.asset_year ?? '',
            asset_name: r.name || '',

            name: r.name || '',
            mfg: r.mfg || '',
            model: r.model || '',
            condition: r.condition || '',
            source: r.source || '',
            specs: r.specs || '',
            purchase_date: r.purchase_date || '',
            warranty_end: r.warranty_end || '',
            notes: r.notes || ''
          };

          // 4. tạo QR TEXT
          const payload = buildItemQrText(it);
          it.qr_png =
            'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=' +
            encodeURIComponent(payload);

          // 5. lưu state + Firebase
          state.data.items.push(it);

          // retry nhẹ để tránh mạng/RTDB chập chờn làm rớt vài item
          try {
            let lastErr = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                await saveData(DB_ITEMS, newId, it);
                lastErr = null;
                break;
              } catch (e) {
                lastErr = e;
                // đợi chút rồi thử lại
                await new Promise(r => setTimeout(r, 250 * attempt));
              }
            }
            if (lastErr) throw lastErr;
          } catch (e) {
            // rollback local nếu ghi DB lỗi (tránh: lúc đầu đủ, vài giây sau thiếu)
            const pos = state.data.items.findIndex(x => x.id === newId);
            if (pos >= 0) state.data.items.splice(pos, 1);
            throw e;
          }

          // 6. ghi activity (log fail thì chỉ warn, không làm hỏng nhập thiết bị)
          try {
            await logCentral({
              type: 'item_added',
              item_id: it.id,
              item_serial: it.serial,
              type_id: it.type_id
            });
          } catch (e) {
            console.warn('logCentral fail', e);
          }

          importedItems.push(it);
          ok++;

        } catch (e) {
          console.warn('import err', e);
          fail++;
        }
      }
    }

    toast(`Import xong: OK ${ok}${fail ? `, lỗi ${fail}` : ''}`);
    refreshDashboardActivityCard?.();
    navigate('#/central-stock');
    if (printWin && importedItems.length) {
      fillPrintWindow(printWin, importedItems);
    }    

  } finally {
    state.ui._centralImportBusy = false;
    
    // ✅ bật lại sync sau khi import xong
    if (_syncWasRunning) startDataSync();

    // nếu vẫn còn ở trang import thì bật lại nút
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = oldText || 'Bắt đầu nhập';
    }
  }
}

function exportInventoryReport() {
  const items = state.data.items || [];
  const rows = items.map(it => ({
    Serial: it.serial || it.id,
    "Số hiệu TS": it.asset_code || '',
    "Tên tài sản": it.asset_name || it.name || '',
    "Lab": it.lab_id || '',
    "Trạng thái": it.state || '',
    "Hãng": it.vendor || '',
    "Model": it.model || '',
    "Nguồn": it.source || '',
    "Ghi chú": it.note || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'TonKho');
  XLSX.writeFile(wb, 'BaoCao_TonKho.xlsx');
}

function exportRepairReport() {
  const reps = state.data.repairs || [];
  const rows = reps.map(r => ({
    "Mã phiếu": r.id,
    "Thiết bị": r.serial || r.item_id,
    "Lab": r.lab_id,
    "Mô tả": r.description || '',
    "Trạng thái": r.status || '',
    "Ảnh": r.img_url || '',
    "Ngày tạo": r.created_at_ts ? new Date(r.created_at_ts).toLocaleString() : ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'BaoHong');
  XLSX.writeFile(wb, 'BaoCao_BaoHong.xlsx');
}
Object.assign(window, {
  openShipmentReceivePopup,
  closeShipmentPopup,
  changeShipReceivePage,
});

function renderQrPrintHtml(items, title = 'In QR - Thiết bị vừa nhập') {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
  );

  const labels = items.map(it => `
    <div class="label">
      <img class="qr" src="${esc(it.qr_png)}" alt="QR">
      <div class="serial">${esc(it.serial || it.id)}</div>
      <div class="meta">${esc(it.asset_code || '')}</div>
      <div class="name">${esc(it.name || it.asset_name || '')}</div>
    </div>
  `).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    body{font-family:system-ui,Arial;margin:0;padding:12px}
    .grid{display:flex;flex-wrap:wrap;gap:10px}
    /* 1 tem QR */
    .label{
      width: 210px;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 10px;
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:6px;
      page-break-inside: avoid;
    }
    .qr{width:170px;height:170px;object-fit:contain}
    .serial{font-weight:800;font-size:16px;line-height:1.1;text-align:center}
    .meta{font-size:12px;opacity:.8;text-align:center}
    .name{font-size:12px;text-align:center;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    @media print{
      body{padding:0}
      .label{border:1px solid #999}
    }
  </style>
</head>
<body>
  <div class="grid">${labels}</div>

  <script>
    // đợi ảnh QR load xong rồi mới print
    (function(){
      const imgs = Array.from(document.images);
      if (!imgs.length) { window.print(); return; }
      let done = 0;
      const tick = () => {
        done++;
        if (done >= imgs.length) setTimeout(() => { window.focus(); window.print(); }, 200);
      };
      imgs.forEach(img => {
        if (img.complete) tick();
        else { img.onload = tick; img.onerror = tick; }
      });
      window.onafterprint = () => setTimeout(()=>window.close(), 200);
    })();
  </script>
</body>
</html>`;
}

function fillPrintWindow(win, items) {
  if (!win) return;
  const html = renderQrPrintHtml(items);
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ===== Central: Print QR labels (select items + print) =====
function _getCentralItemsForPrint() {
  // in QR thường dùng cho thiết bị thuộc central (đang ở kho trung tâm)
  return (state.data.items || []).filter(it => it && (it.state === 'available@central'));
}

function openPrintQrModal() {
  if (state.role !== 'central') return toast('Chỉ Central dùng được');

  state.ui = state.ui || {};
  if (!state.ui.printQrSelected) state.ui.printQrSelected = {}; // {id:true}
  if (typeof state.ui.printQrGroupKey !== 'string') state.ui.printQrGroupKey = '';
  if (typeof state.ui.printQrSearch !== 'string') state.ui.printQrSearch = '';

  renderPrintQrModal();
}
window.openPrintQrModal = openPrintQrModal;

function renderPrintQrModal(opts = {}) {
  state.ui = state.ui || {};
  const selectedMap = state.ui.printQrSelected || {};
  const q = (state.ui.printQrSearch || '').trim().toLowerCase();

  // group options giống central-stock
  const groupsArr = centralStockGroups ? centralStockGroups() : [];
  groupsArr.sort((a, b) => {
    const ac = String(a.asset_code || '').localeCompare(String(b.asset_code || ''), 'vi');
    if (ac !== 0) return ac;
    return String(a.asset_name || '').localeCompare(String(b.asset_name || ''), 'vi');
  });

  const groupOpts = [
    `<option value="">(Tất cả nhóm)</option>`,
    ...groupsArr.map(g => {
      const key = (g.asset_code || '') + '::' + (g.asset_name || '');
      const sel = (state.ui.printQrGroupKey === key) ? 'selected' : '';
      return `<option value="${encodeURIComponent(key)}" ${sel}>${g.asset_code} — ${g.asset_name}</option>`;
    })
  ].join('');

  // filter items
  let items = _getCentralItemsForPrint();

  // filter by group
  const gk = state.ui.printQrGroupKey || '';
  if (gk) {
    const parts = gk.split('::');
    const code = parts[0] || '';
    const name = parts.slice(1).join('::') || '';
    items = items.filter(it =>
      String(it.asset_code || it.assetCode || '') === String(code) &&
      String(it.asset_name || it.name || '') === String(name)
    );
  }

  // filter by search
  if (q) {
    items = items.filter(it => {
      const s = `${it.serial || ''} ${it.id || ''} ${it.asset_code || ''} ${it.asset_name || it.name || ''}`.toLowerCase();
      return s.includes(q);
    });
  }

  // count selected
  const selIds = Object.keys(selectedMap).filter(id => selectedMap[id]);
  const selCount = selIds.length;

  const rows = items.map(it => {
    const checked = selectedMap[it.id] ? 'checked' : '';
    const name = it.asset_name || it.name || '';
    const code = it.asset_code || it.assetCode || '';
    const serial = it.serial || it.id;

    return `
      <tr>
        <td style="width:44px">
          <input type="checkbox" ${checked}
            onchange="togglePrintQrSelect('${it.id}', this.checked)" />
        </td>
        <td style="white-space:nowrap"><b>${serial}</b></td>
        <td style="white-space:nowrap">${code}</td>
        <td>${name}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" class="muted-2">(Không có thiết bị)</td></tr>`;

  const html = `
    <div class="card" style="max-width:980px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <h1 style="margin:0">In QR (Central)</h1>
        <div class="toolbar">
          <button class="btn" onclick="closeItemModal()">Đóng</button>
        </div>
      </div>

      <div class="toolbar" style="margin-top:10px;flex-wrap:wrap;gap:8px;align-items:center">
        <select style="min-width:320px" onchange="setPrintQrGroup(this.value)">
          ${groupOpts}
        </select>

        <input id="printQrSearch" placeholder="Tìm serial / mã TS / tên..." style="min-width:260px"
          value="${escapeHtml(state.ui.printQrSearch || '')}"
          oninput="setPrintQrSearch(this.value)" />

        <button class="btn" onclick="printQrSelectAllVisible()">Chọn tất cả (đang lọc)</button>
        <button class="btn" onclick="printQrClearSelection()">Bỏ chọn</button>

        <button class="btn primary" onclick="printSelectedQrs()">
          🖨️ In (<span id="printQrSelCount">${selCount}</span>)
        </button>

      </div>

      <div class="muted-2" style="font-size:12px;margin-top:6px">
        * In sẽ gồm: QR + <b>Serial</b> + <b>Tên thiết bị</b>.
      </div>

      <div style="margin-top:10px;max-height:420px;overflow:auto;border:1px solid rgba(255,255,255,.06);border-radius:12px">
        <table>
          <thead>
            <tr>
              <th style="width:44px"></th>
              <th>Serial</th>
              <th>Số hiệu TS</th>
              <th>Tên thiết bị</th>
            </tr>
          </thead>
          <tbody id="printQrTbody">${rows}</tbody>
        </table>
      </div>
    </div>
  `;

  openModalHtml(html);
  updatePrintQrModalList();
  // ✅ Giữ focus cho ô tìm kiếm để không bị "out" sau mỗi lần render
  if (opts.focusSearch) {
    setTimeout(() => {
      const el = document.getElementById('printQrSearch');
      if (!el) return;
      el.focus();
      try {
        const n = (el.value || '').length;
        el.setSelectionRange(n, n);
      } catch {}
    }, 0);
  }
}

function _getPrintQrFilteredItems() {
  state.ui = state.ui || {};
  const selectedMap = state.ui.printQrSelected || {};
  const q = (state.ui.printQrSearch || '').trim().toLowerCase();

  let items = _getCentralItemsForPrint();

  // filter by group
  const gk = state.ui.printQrGroupKey || '';
  if (gk) {
    const parts = gk.split('::');
    const code = parts[0] || '';
    const name = parts.slice(1).join('::') || '';
    items = items.filter(it =>
      String(it.asset_code || it.assetCode || '') === String(code) &&
      String(it.asset_name || it.name || '') === String(name)
    );
  }

  // filter by search
  if (q) {
    items = items.filter(it => {
      const s = `${it.serial || ''} ${it.id || ''} ${it.asset_code || ''} ${it.asset_name || it.name || ''}`.toLowerCase();
      return s.includes(q);
    });
  }

  return { items, selectedMap };
}

function updatePrintQrModalList() {
  const tb = document.getElementById('printQrTbody');
  const cntEl = document.getElementById('printQrSelCount');
  if (!tb || !cntEl) return; // modal chưa mở

  const { items, selectedMap } = _getPrintQrFilteredItems();

  const rows = items.map(it => {
    const checked = selectedMap[it.id] ? 'checked' : '';
    const name = it.asset_name || it.name || '';
    const code = it.asset_code || it.assetCode || '';
    const serial = it.serial || it.id;

    return `
      <tr>
        <td style="width:44px">
          <input type="checkbox" ${checked}
            onchange="togglePrintQrSelect('${it.id}', this.checked)" />
        </td>
        <td style="white-space:nowrap"><b>${escapeHtml(serial)}</b></td>
        <td style="white-space:nowrap">${escapeHtml(code)}</td>
        <td>${escapeHtml(name)}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" class="muted-2">(Không có thiết bị)</td></tr>`;

  tb.innerHTML = rows;

  const selCount = Object.keys(selectedMap).filter(id => selectedMap[id]).length;
  cntEl.textContent = String(selCount);
}


function setPrintQrGroup(encodedKey) {
  state.ui = state.ui || {};
  let key = '';
  try { key = decodeURIComponent(encodedKey || ''); } catch {}
  state.ui.printQrGroupKey = key;
  renderPrintQrModal();
}
window.setPrintQrGroup = setPrintQrGroup;

function setPrintQrSearch(v) {
  state.ui = state.ui || {};
  state.ui.printQrSearch = (v || '');
  updatePrintQrModalList(); // ✅ chỉ update list -> không mất chữ nữa
}
window.setPrintQrSearch = setPrintQrSearch;


function togglePrintQrSelect(itemId, checked) {
  state.ui = state.ui || {};
  state.ui.printQrSelected = state.ui.printQrSelected || {};
  state.ui.printQrSelected[itemId] = !!checked;
  updatePrintQrModalList(); // ✅ update số In(x)
}
window.togglePrintQrSelect = togglePrintQrSelect;


function printQrSelectAllVisible() {
  state.ui = state.ui || {};
  state.ui.printQrSelected = state.ui.printQrSelected || {};

  // chọn tất cả theo filter hiện tại: gọi lại render để lấy list filter
  const q = (state.ui.printQrSearch || '').trim().toLowerCase();
  let items = _getCentralItemsForPrint();

  const gk = state.ui.printQrGroupKey || '';
  if (gk) {
    const parts = gk.split('::');
    const code = parts[0] || '';
    const name = parts.slice(1).join('::') || '';
    items = items.filter(it =>
      String(it.asset_code || it.assetCode || '') === String(code) &&
      String(it.asset_name || it.name || '') === String(name)
    );
  }
  if (q) {
    items = items.filter(it => {
      const s = `${it.serial || ''} ${it.id || ''} ${it.asset_code || ''} ${it.asset_name || it.name || ''}`.toLowerCase();
      return s.includes(q);
    });
  }

  for (const it of items) state.ui.printQrSelected[it.id] = true;
  updatePrintQrModalList();
}
window.printQrSelectAllVisible = printQrSelectAllVisible;

function printQrClearSelection() {
  state.ui = state.ui || {};
  state.ui.printQrSelected = {};
  updatePrintQrModalList();
}
window.printQrClearSelection = printQrClearSelection;

// helper nhỏ để tránh lỗi HTML injection ở value=""
function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function printSelectedQrs() {
  if (state.role !== 'central') return toast('Chỉ Central dùng được');

  state.ui = state.ui || {};
  const selectedMap = state.ui.printQrSelected || {};
  const ids = Object.keys(selectedMap).filter(id => selectedMap[id]);

  if (!ids.length) return toast('Chưa chọn thiết bị nào để in');

  const itemsById = new Map((state.data.items || []).map(it => [it.id, it]));
  const selectedItems = ids.map(id => itemsById.get(id)).filter(Boolean);

  // đảm bảo có qr_png
  for (const it of selectedItems) {
    if (!it.qr_png) {
      await generateItemQR(it); // dùng helper sẵn có
      // lưu lại để lần sau không phải tạo lại
      try { await saveData(DB_ITEMS, it.id, it); } catch {}
    }
  }

  const labelsHtml = selectedItems.map(it => {
    const serial = it.serial || it.id;
    const name = it.asset_name || it.name || '';
    const qr = it.qr_png || '';
    return `
      <div class="lbl">
        <img class="qr" src="${qr}" alt="QR"/>
        <div class="serial">${escapeHtml(serial)}</div>
        <div class="name">${escapeHtml(name)}</div>
      </div>
    `;
  }).join('');

  const w = window.open('', '_blank');
  if (!w) return toast('Trình duyệt chặn popup. Hãy cho phép popup để in.');

  w.document.open();
  w.document.write(`
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>Print QR</title>
      <style>
        @media print {
          body { margin: 0; }
        }
        body { font-family: Arial, sans-serif; padding: 12px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .lbl{
          border: 1px solid #ddd;
          border-radius: 10px;
          padding: 10px;
          text-align: center;
          page-break-inside: avoid;
        }
        .qr{
          width: 140px;
          height: 140px;
          object-fit: contain;
        }
        .serial{
          margin-top: 6px;
          font-weight: 700;
          font-size: 14px;
        }
        .name{
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.2;
        }
      </style>
    </head>
    <body>
      <div class="grid">${labelsHtml}</div>
      <script>
        // chờ ảnh load rồi mới print (đỡ bị trắng QR)
        const imgs = Array.from(document.images);
        let left = imgs.length;
        if (!left) { window.print(); }
        imgs.forEach(img => {
          img.onload = img.onerror = () => {
            left--;
            if (left <= 0) window.print();
          }
        });
      </script>
    </body>
    </html>
  `);
  w.document.close();
}
window.printSelectedQrs = printSelectedQrs;
/***** CENTRAL: USERS MANAGEMENT *****/

// cache list để render
async function centralLoadUsers() {
  try {
    state.data._users = await getAllUsers(); // trả về array
    renderPage();
  } catch (e) {
    console.error(e);
    toast('Không tải được danh sách user');
  }
}

async function centralCreateUser() {
  try {
    const name = (document.getElementById('cu_name')?.value || '').trim();
    const email = (document.getElementById('cu_email')?.value || '').trim().toLowerCase();
    const pass = (document.getElementById('cu_pass')?.value || '');
    const role = (document.getElementById('cu_role')?.value || 'lab');
    const labId = (document.getElementById('cu_lab')?.value || '').trim();

    if (!name || !email || !pass) { toast('Vui lòng nhập đủ Họ tên / Email / Mật khẩu'); return; }
    if (pass.length < 8) { toast('Mật khẩu tối thiểu 8 ký tự'); return; }
    if (role === 'lab' && !labId) { toast('User Lab phải có Mã Lab (VD: LAB-E203)'); return; }

    // chặn trùng email
    const existed = await getUserByEmail(email);
    if (existed) { toast('Email đã tồn tại'); return; }

    const passHash = await sha256(pass);
    const u = {
      id: 'u-' + Math.random().toString(36).slice(2, 10),
      name,
      email,
      pass: passHash,
      defaultRole: role,
      ...(role === 'lab' ? { labId } : {}),
      createdAt: Date.now()
    };

    await saveUserToDB(u);
    toast('Đã tạo user');

    // clear form
    document.getElementById('cu_name').value = '';
    document.getElementById('cu_email').value = '';
    document.getElementById('cu_pass').value = '';
    document.getElementById('cu_lab').value = '';

    await centralLoadUsers();
  } catch (e) {
    console.error(e);
    toast('Tạo user thất bại');
  }
}

async function centralDeleteUser(uid) {
  try {
    if (!uid) return;

    // không cho xoá chính mình (nếu có state.user)
    if (state.user && state.user.id === uid) {
      toast('Không thể xoá user đang đăng nhập');
      return;
    }

    if (!confirm('Xoá user này?')) return;

    await deleteData(DB_USERS, uid);
    toast('Đã xoá user');
    await centralLoadUsers();
  } catch (e) {
    console.error(e);
    toast('Xoá user thất bại');
  }
}

// Page render
PAGES['#/central-users'] = () => {
  if (state.role !== 'central') return `<div class="card">Bạn không có quyền.</div>`;

  // lần đầu vào trang thì load
  if (!state.data._users) {
    setTimeout(centralLoadUsers, 0);
    return `<div class="card">Đang tải danh sách user...</div>`;
  }

  const users = state.data._users || [];
  const rows = users.map((u, idx) => {
    const role = u.defaultRole || u.role || '';
    const lab = u.labId || '';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(u.name || '')}</td>
        <td>${escapeHtml(u.email || '')}</td>
        <td>${escapeHtml(role)}</td>
        <td>${escapeHtml(lab)}</td>
        <td style="text-align:right">
          <button class="btn danger" onclick="centralDeleteUser('${u.id}')">Xoá</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="page-head">
      <h1>Quản lý user</h1>
      <div></div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px">
        <div>
          <label>Họ tên</label>
          <input id="cu_name" placeholder="Nguyễn Văn A" />
        </div>
        <div>
          <label>Email</label>
          <input id="cu_email" type="email" placeholder="you@example.com" />
        </div>
        <div>
          <label>Mật khẩu</label>
          <input id="cu_pass" type="password" placeholder=">= 8 ký tự" />
        </div>

        <div>
          <label>Vai trò</label>
          <select id="cu_role" onchange="document.getElementById('cu_lab_wrap').style.display = (this.value==='lab'?'block':'none')">
            <option value="lab">Lab Admin</option>
            <option value="central">Central Admin</option>
          </select>
        </div>

        <div id="cu_lab_wrap">
          <label>Mã Lab (nếu chọn Lab Admin)</label>
          <input id="cu_lab" placeholder="VD: LAB-E203" />
        </div>

        <div style="display:flex; align-items:flex-end; gap:10px">
          <button class="btn primary" onclick="centralCreateUser()">Tạo user</button>
          <button class="btn" onclick="centralLoadUsers()">Tải lại</button>
        </div>
      </div>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Họ tên</th>
            <th>Email</th>
            <th>Vai trò</th>
            <th>Mã Lab</th>
            <th style="text-align:right">Hành động</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" class="muted">Chưa có user</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
};

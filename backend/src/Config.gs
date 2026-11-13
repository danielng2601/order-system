/**
 * ROMS V1.0 - Backend Configuration & Domain Constants
 * All prices are integer VND. Timezone is Asia/Ho_Chi_Minh.
 */

const ROMS_CONFIG = {
  APP_NAME: 'ROMS',
  APP_VERSION: '1.0.0',
  PHASE: 'Phase 0',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  CURRENCY: 'VND',
  TABLE_COUNT: 9,
  SEATS_PER_TABLE: 4,
  TOTAL_SEATS: 36,
  TOPPING_UNIT_PRICE_VND: 15000,
  PRINTER_ENABLED: false,
  LOCK_TIMEOUT_MS: 15000,
  SHEETS: {
    SETTINGS: 'Settings',
    MENU_ITEMS: 'MenuItems',
    MODIFIERS: 'Modifiers',
    TABLES_SEATS: 'TablesSeats',
    ORDERS: 'Orders',
    ORDER_ITEMS: 'OrderItems',
    AUDIT_LOG: 'AuditLog',
    IDEMPOTENCY_KEYS: 'IdempotencyKeys',
  },
  ORDER_TYPES: ['DINE_IN', 'TAKEAWAY'],
  ORDER_STATUSES: ['Draft', 'Confirmed', 'Cancelled'],
  PAYMENT_STATUSES: ['Unpaid', 'Paid'],
};

const SEED_MENU_ITEMS = [
  { item_id: 'MY_VAN_THAN', name: 'Mỳ Vằn Thắn', category: 'Mỳ & Bún', price_vnd: 45000, is_active: true, sort_order: 1 },
  { item_id: 'MY_DAC_BIET', name: 'Mỳ Đặc Biệt', category: 'Mỳ & Bún', price_vnd: 50000, is_active: true, sort_order: 2 },
  { item_id: 'SUI_CAO', name: 'Sủi Cảo', category: 'Mỳ & Bún', price_vnd: 50000, is_active: true, sort_order: 3 },
  { item_id: 'MY_TRON', name: 'Mỳ Trộn', category: 'Mỳ & Bún', price_vnd: 50000, is_active: true, sort_order: 4 },
  { item_id: 'BUN_THANG', name: 'Bún Thang', category: 'Mỳ & Bún', price_vnd: 40000, is_active: true, sort_order: 5 },
  { item_id: 'MY_TRE_EM', name: 'Mỳ Trẻ Em', category: 'Mỳ & Bún', price_vnd: 35000, is_active: true, sort_order: 6 },
  { item_id: 'QUAY', name: 'Quẩy', category: 'Món thêm', price_vnd: 5000, is_active: true, sort_order: 7 },
];

const SEED_MODIFIERS = [
  { modifier_id: 'NO_VEG', name: 'Không rau', price_delta_vnd: 0, is_active: true, sort_order: 1 },
  { modifier_id: 'NO_MEAT', name: 'Không thịt', price_delta_vnd: 0, is_active: true, sort_order: 2 },
  { modifier_id: 'NO_SUI_CAO', name: 'Không sủi cảo', price_delta_vnd: 0, is_active: true, sort_order: 3 },
  { modifier_id: 'NO_FRIED_DUMPLING', name: 'Không sủi rán', price_delta_vnd: 0, is_active: true, sort_order: 4 },
  { modifier_id: 'MORE_NOODLES', name: 'Nhiều mỳ', price_delta_vnd: 0, is_active: true, sort_order: 5 },
  { modifier_id: 'LESS_NOODLES', name: 'Ít mỳ', price_delta_vnd: 0, is_active: true, sort_order: 6 },
];

/**
 * Generates the 9 tables x 4 seats = 36 seats seed list.
 * @return {Array<Object>}
 */
function buildSeedTablesSeats() {
  const rows = [];
  for (let t = 1; t <= ROMS_CONFIG.TABLE_COUNT; t += 1) {
    for (let s = 1; s <= ROMS_CONFIG.SEATS_PER_TABLE; s += 1) {
      rows.push({
        seat_id: 'T' + t + '-S' + s,
        table_number: t,
        seat_number: s,
        label: 'Bàn ' + t + ' - Ghế ' + s,
        is_active: true,
      });
    }
  }
  return rows;
}

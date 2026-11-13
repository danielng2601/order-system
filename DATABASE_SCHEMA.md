# Database Schema — Google Sheets (ROMS V1.0)

Initialized idempotently by `setupDatabase()` in `backend/src/DbSetup.gs`.
All timestamps use `Asia/Ho_Chi_Minh` (`yyyy-MM-dd'T'HH:mm:ss+07:00`). All monetary fields are integer `VND`.

## 1. `Settings`
| Column | Type | Description |
| :--- | :--- | :--- |
| `key` | String (PK) | Setting identifier (`SchemaVersion`, `Timezone`, `Currency`, `PrinterEnabled`, `ToppingPriceVnd`, `TableCount`, `SeatsPerTable`) |
| `value` | String | Setting value |
| `description` | String | Human-readable note |

## 2. `MenuItems`
| Column | Type | Description |
| :--- | :--- | :--- |
| `item_id` | String (PK) | Stable item code (e.g., `MY_VAN_THAN`) |
| `name` | String | Display name |
| `category` | String | Menu group (`Mỳ & Bún`, `Món thêm`) |
| `price_vnd` | Integer | Authoritative unit price in VND |
| `is_active` | Boolean | `TRUE` if available for ordering |
| `sort_order` | Integer | Display order |
| `updated_at` | String | ISO-8601 timestamp (`Asia/Ho_Chi_Minh`) |

**Seeded Menu Items:**
- `MY_VAN_THAN` — Mỳ Vằn Thắn (`45000` VND)
- `MY_DAC_BIET` — Mỳ Đặc Biệt (`50000` VND)
- `SUI_CAO` — Sủi Cảo (`50000` VND)
- `MY_TRON` — Mỳ Trộn (`50000` VND)
- `BUN_THANG` — Bún Thang (`40000` VND)
- `MY_TRE_EM` — Mỳ Trẻ Em (`35000` VND)
- `QUAY` — Quẩy (`5000` VND)

## 3. `Modifiers`
| Column | Type | Description |
| :--- | :--- | :--- |
| `modifier_id` | String (PK) | Stable modifier code (`NO_VEG`, `NO_MEAT`, etc.) |
| `name` | String | Display name (`Không rau`, `Không thịt`, `Không sủi cảo`, `Không sủi rán`, `Nhiều mỳ`, `Ít mỳ`) |
| `price_delta_vnd` | Integer | Price adjustment (`0` by default) |
| `is_active` | Boolean | `TRUE` if active |
| `sort_order` | Integer | Display order |

## 4. `TablesSeats`
| Column | Type | Description |
| :--- | :--- | :--- |
| `seat_id` | String (PK) | `T1-S1` through `T9-S4` (36 rows) |
| `table_number` | Integer | `1` to `9` |
| `seat_number` | Integer | `1` to `4` |
| `label` | String | `Bàn {t} - Ghế {s}` |
| `is_active` | Boolean | `TRUE` if active |

## 5. `Orders`
| Column | Type | Description |
| :--- | :--- | :--- |
| `order_id` | String (PK) | Unique ID (`ORD-YYYYMMDD-HHMMSS-XXXX`) |
| `order_type` | String | `DINE_IN` or `TAKEAWAY` |
| `status` | String | `Draft`, `Confirmed`, or `Cancelled` |
| `payment_status` | String | `Unpaid` or `Paid` |
| `table_numbers_json` | String (JSON) | Array of table numbers involved, e.g. `[1, 2]` or `[]` |
| `subtotal_vnd` | Integer | Sum of `OrderItems.line_total_vnd` |
| `total_vnd` | Integer | Authoritative order total in VND |
| `version` | Integer | Optimistic concurrency version (starts at `1`) |
| `idempotency_key` | String | Client request UUID for duplicate protection |
| `notes` | String | Order-level notes |
| `created_at` | String | Creation timestamp |
| `updated_at` | String | Last update timestamp |
| `paid_at` | String | Payment timestamp (empty if `Unpaid`) |
| `created_by` | String | Actor label (e.g. `staff`) |

## 6. `OrderItems`
| Column | Type | Description |
| :--- | :--- | :--- |
| `order_item_id` | String (PK) | Unique line item ID |
| `order_id` | String (FK) | References `Orders.order_id` |
| `seat_id` | String | Required for `DINE_IN` (`T1-S1`..`T9-S4`); empty for `TAKEAWAY` |
| `table_number` | Integer/Empty | Derived from `seat_id` |
| `seat_number` | Integer/Empty | Derived from `seat_id` |
| `item_id` | String (FK) | References `MenuItems.item_id` |
| `item_name_snapshot` | String | Item name at order time |
| `unit_price_vnd` | Integer | Authoritative item price at order time |
| `quantity` | Integer | Positive integer (`>= 1`) |
| `modifiers_json` | String (JSON) | Array of selected modifier names |
| `topping_units` | Integer | Paid topping count (`>= 0`, `15000` VND/unit) |
| `topping_unit_price_vnd` | Integer | Topping unit price snapshot (`15000`) |
| `line_total_vnd` | Integer | `(unit_price_vnd + topping_units * topping_unit_price_vnd) * quantity` |
| `custom_note` | String | Optional item-level note |
| `created_at` | String | Creation timestamp |
| `updated_at` | String | Last update timestamp |

## 7. `AuditLog`
| Column | Type | Description |
| :--- | :--- | :--- |
| `log_id` | String (PK) | `LOG-XXXXXXXX` |
| `timestamp` | String | Event timestamp (`Asia/Ho_Chi_Minh`) |
| `action` | String | Action name (e.g. `CREATE_ORDER`, `MERGE_ORDER`) |
| `entity_type` | String | `ORDER`, `PAYMENT`, `SYSTEM` |
| `entity_id` | String | Target record ID |
| `actor` | String | Staff/system actor |
| `request_id` | String | Idempotency/request correlation ID |
| `details_json` | String (JSON) | Structured event details |

## 8. `IdempotencyKeys`
| Column | Type | Description |
| :--- | :--- | :--- |
| `idempotency_key` | String (PK) | Client-generated UUID |
| `action` | String | Mutation action name |
| `order_id` | String | Associated `order_id` |
| `response_json` | String (JSON) | Cached response for safe replay on retry |
| `created_at` | String | Timestamp |

// Seeds (or resets + reseeds) the MaliSafi Groceries Ltd demo tenant --
// a fully isolated, richly populated tenant for demos/training/testing,
// built entirely via the service-role client (the same "trusted bulk
// actor" posture ImportService/TenantService's own onboarding bootstrap
// already use, see lib/supabase/service-role.ts's allow-list comment)
// so it can write historical AND future-dated records without touching
// any of the app's live create-a-sale/open-a-day validation rules.
//
// Usage:
//   node scripts/seed-malisafi-demo.mjs           -- seed if not already present
//   node scripts/seed-malisafi-demo.mjs --reset   -- wipe + regenerate this
//                                                     tenant's transactions only
//                                                     (tenant/branches/catalog/
//                                                     login kept, never touched)
//
// Idempotency: the tenant is looked up by its own auth email
// (malisafi.demo@malisafi.app), never re-created if it already exists.
// Plain `node ... ` with no flag exits immediately if the tenant is
// already there, printing what it found -- it will never silently
// duplicate six months of transactions. --reset only ever deletes rows
// scoped to tenant_id = this tenant's own id (see wipeTransactions
// below) -- it can NEVER reach another tenant's data, and it never
// touches products/locations/the login account.
//
// Money note: `stock_movements` has no cost/purchase-price column at
// all (see supabase/migrations/0035_inventory_core_schema.sql -- only
// `quantity`, no monetary field) -- there is nowhere in this schema to
// record "how much a restock cost." Purchase quantities below are
// sized using each product's own `expected_price` (its selling price)
// as the closest available value proxy, to land purchase batches in
// the requested KES range -- not a true cost price, since the app
// doesn't track one.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const RESET = process.argv.includes("--reset");

const DEMO_EMAIL = "malisafi.demo@malisafi.app";
const DEMO_PASSWORD = "JM2022";
const TENANT_NAME = "MaliSafi Groceries Ltd";
const SOURCE_TENANT_ID = "e07849d2-5493-435e-af6a-c6e8187692c8"; // jms-solutions-kinya (jamosammy@gmail.com) -- catalogue source ONLY, never written to.

const PERIOD_START = "2026-05-01";
const PERIOD_END = "2026-10-31";
const TIMEZONE = "Africa/Nairobi"; // UTC+3, no DST -- fixed offset simplifies local-time math below.
const TZ_OFFSET_HOURS = 3;

function todayInNairobi() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}
const TODAY = todayInNairobi();

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function pickWeighted(items, weightOf) {
  const total = items.reduce((sum, it) => sum + weightOf(it), 0);
  let r = rand(0, total);
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
function dateRange(start, end) {
  const dates = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
async function insertBatched(table, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw new Error(`insert ${table} batch ${i}: ${error.message}`);
  }
}

// ============================================================================
// Step 0: idempotency check / --reset target resolution
// ============================================================================
async function findExistingTenant() {
  const {
    data: { users },
  } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const authUser = users.find((u) => u.email === DEMO_EMAIL);
  if (!authUser) return null;

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("profile_id", authUser.id)
    .maybeSingle();
  if (!membership) return null;

  const { data: tenant } = await supabase.from("tenants").select("id, slug, name").eq("id", membership.tenant_id).single();
  return { authUserId: authUser.id, tenant };
}

const existing = await findExistingTenant();

if (existing && !RESET) {
  console.log(`MaliSafi demo tenant already exists (${existing.tenant.slug}, id ${existing.tenant.id}). Nothing to do.`);
  console.log(`Run with --reset to wipe and regenerate its transactions.`);
  process.exit(0);
}

if (!existing && RESET) {
  console.log("--reset given but no MaliSafi demo tenant exists yet -- seeding fresh instead.");
}

// ============================================================================
// Step 1: wipe this tenant's own seeded transactions only (--reset path)
// Mirrors docs/23-data-maintenance-scripts.md's "wipe sales & stock
// history for ONE tenant" script exactly, scoped directly by this
// tenant's own id -- never the platform-owner-join pattern those use,
// since MaliSafi isn't the platform owner's tenant.
// ============================================================================
async function wipeTransactions(tenantId) {
  console.log(`Wiping existing transactions for tenant ${tenantId}...`);
  const tables = [
    "sale_corrections",
    "stock_reconciliations",
    "insights_snapshots",
    "report_jobs",
    "reports",
    "stock_movements",
    "sales",
    "business_days",
    "sale_number_sequences",
  ];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("tenant_id", tenantId);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
  }
  console.log("Wipe complete.");
}

let tenantId, tenantSlug, ownerProfileId, locationDonholm, locationKayole, staffDonholmId, staffKayoleId;

if (existing && RESET) {
  tenantId = existing.tenant.id;
  tenantSlug = existing.tenant.slug;
  ownerProfileId = existing.authUserId;
  await wipeTransactions(tenantId);

  const { data: locs } = await supabase.from("locations").select("id, name").eq("tenant_id", tenantId);
  locationDonholm = locs.find((l) => l.name.includes("Donholm")).id;
  locationKayole = locs.find((l) => l.name.includes("Kayole")).id;

  // Branch-based, not name-based -- robust regardless of whatever a
  // staff member has since been renamed to (names/emails are meant to
  // be editable via the ordinary Users page without breaking --reset).
  // Plain manual join (membership_id -> profile_id), not a PostgREST
  // embedded relationship select -- matches this codebase's own
  // established preference for that over embeds (see lib/tenant/
  // resolve-active-tenant.ts's header comment).
  const { data: memberships } = await supabase.from("tenant_memberships").select("id, profile_id").eq("tenant_id", tenantId);
  const profileIdByMembershipId = new Map((memberships ?? []).map((m) => [m.id, m.profile_id]));
  const { data: assignments } = await supabase
    .from("user_role_assignments")
    .select("location_id, tenant_membership_id")
    .eq("tenant_id", tenantId)
    .not("location_id", "is", null);
  for (const a of assignments ?? []) {
    const profileId = profileIdByMembershipId.get(a.tenant_membership_id);
    if (a.location_id === locationDonholm) staffDonholmId = profileId;
    if (a.location_id === locationKayole) staffKayoleId = profileId;
  }
  if (!staffDonholmId || !staffKayoleId) {
    throw new Error("Could not resolve existing branch staff via user_role_assignments.");
  }
} else {
  // ==========================================================================
  // Step 2: create the tenant, owner, branches, and staff
  // ==========================================================================
  console.log("Creating MaliSafi demo tenant...");

  const { data: ownerUser, error: ownerErr } = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true, // The explicit, secure admin-seeding bypass -- Supabase's own Admin API, not a raw DB write around auth. Applies to only this one seeded account.
    user_metadata: { full_name: "Bright James" },
  });
  if (ownerErr || !ownerUser.user) throw new Error(`createUser owner: ${ownerErr?.message}`);
  ownerProfileId = ownerUser.user.id;

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .insert({
      name: TENANT_NAME,
      slug: "malisafi-groceries-ltd",
      country: "KE",
      timezone: TIMEZONE,
      default_locale: "en",
      currency: "KES",
      billing_owner_profile_id: ownerProfileId,
    })
    .select("id, slug")
    .single();
  if (tenantErr || !tenant) throw new Error(`create tenant: ${tenantErr?.message}`);
  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const { data: ownerMembership, error: memErr } = await supabase
    .from("tenant_memberships")
    .insert({ tenant_id: tenantId, profile_id: ownerProfileId, status: "active", joined_at: new Date().toISOString() })
    .select("id")
    .single();
  if (memErr || !ownerMembership) throw new Error(`owner membership: ${memErr?.message}`);

  // Default roles (Tenant Administrator/Supervisor/Sales User) +
  // role_permissions, same bootstrap TenantService.createTenant's real
  // onboarding path runs -- reproduced directly here via RPC/table
  // reads rather than importing the TS service (this is a plain .mjs
  // script, no Next/TS build pipeline available to it).
  const { data: permissions } = await supabase.from("permissions").select("id, key");
  const permByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const ROLE_GRANTS = {
    "Sales User": ["sales.create", "sales.view_own", "analytics.view_own"],
    Supervisor: [
      "sales.create",
      "sales.view_all",
      "sales.void",
      "sales.correct",
      "analytics.view_own",
      "analytics.view_all",
      "reports.view",
      "inventory.view",
    ],
    "Tenant Administrator": null, // every permission in the catalog
  };

  const roleIdByName = {};
  for (const [name, grantKeys] of Object.entries(ROLE_GRANTS)) {
    const { data: role, error: roleErr } = await supabase
      .from("roles")
      .insert({ tenant_id: tenantId, name, description: null, is_system_default: true })
      .select("id")
      .single();
    if (roleErr || !role) throw new Error(`role ${name}: ${roleErr?.message}`);
    roleIdByName[name] = role.id;

    const grantedKeys = grantKeys ?? permissions.map((p) => p.key);
    const rows = grantedKeys.filter((k) => permByKey.has(k)).map((k) => ({ role_id: role.id, permission_id: permByKey.get(k) }));
    if (rows.length > 0) {
      const { error: rpErr } = await supabase.from("role_permissions").insert(rows);
      if (rpErr) throw new Error(`role_permissions ${name}: ${rpErr.message}`);
    }
  }

  const { error: ownerAssignErr } = await supabase
    .from("user_role_assignments")
    .insert({ tenant_id: tenantId, tenant_membership_id: ownerMembership.id, role_id: roleIdByName["Tenant Administrator"] });
  if (ownerAssignErr) throw new Error(`owner role assignment: ${ownerAssignErr.message}`);

  // Base subscription (TRIAL, matches every other tenant's bootstrap) --
  // this demo tenant doesn't need real billing, just a row so nothing
  // downstream that reads `subscriptions` breaks.
  const { error: subErr } = await supabase.from("subscriptions").insert({
    tenant_id: tenantId,
    status: "TRIAL",
    trial_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (subErr) throw new Error(`subscription: ${subErr.message}`);

  // Branches. Donholm is the "first" location (createTenant's normal
  // onboarding-created one); Kayole is the second branch, created the
  // same way Settings -> Branches does it.
  const { data: donholm, error: donholmErr } = await supabase
    .from("locations")
    .insert({ tenant_id: tenantId, name: "MaliSafi Donholm", address: "Donholm, Nairobi, Kenya", timezone: TIMEZONE })
    .select("id")
    .single();
  if (donholmErr || !donholm) throw new Error(`location Donholm: ${donholmErr?.message}`);
  locationDonholm = donholm.id;

  const { data: kayole, error: kayoleErr } = await supabase
    .from("locations")
    .insert({ tenant_id: tenantId, name: "MaliSafi Kayole", address: "Kayole, Nairobi, Kenya", timezone: TIMEZONE })
    .select("id")
    .single();
  if (kayoleErr || !kayole) throw new Error(`location Kayole: ${kayoleErr?.message}`);
  locationKayole = kayole.id;

  // 8:00 AM - 12:00 Midnight, every day, both branches.
  const hoursRows = (locationId) =>
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      tenant_id: tenantId,
      location_id: locationId,
      day_of_week: dayOfWeek,
      open_time: "08:00",
      close_time: "00:00",
      closed_all_day: false,
    }));
  const { error: hoursErr } = await supabase.from("location_hours").insert([...hoursRows(locationDonholm), ...hoursRows(locationKayole)]);
  if (hoursErr) throw new Error(`location_hours: ${hoursErr.message}`);

  // Two branch staff so Top Sales Person / staff performance reports
  // have real variety instead of always being the owner. One primarily
  // anchored per branch (assigned via user_role_assignments.location_id,
  // the Multi-Branch mechanism).
  async function createStaff(email, fullName, locationId, roleId) {
    const { data: user, error } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !user.user) throw new Error(`createUser ${email}: ${error?.message}`);
    const { data: membership, error: mErr } = await supabase
      .from("tenant_memberships")
      .insert({ tenant_id: tenantId, profile_id: user.user.id, status: "active", joined_at: new Date().toISOString() })
      .select("id")
      .single();
    if (mErr || !membership) throw new Error(`membership ${email}: ${mErr?.message}`);
    const { error: aErr } = await supabase
      .from("user_role_assignments")
      .insert({ tenant_id: tenantId, tenant_membership_id: membership.id, role_id: roleId, location_id: locationId });
    if (aErr) throw new Error(`assignment ${email}: ${aErr.message}`);
    return user.user.id;
  }
  // Donholm -> Libbie Sonia (Supervisor); Kayole -> Shanniz K (Sales User) --
  // named to match real people already familiar from the platform
  // owner's actual tenant, per an explicit rename request.
  staffDonholmId = await createStaff("libbie@malisafi.app", "Libbie Sonia", locationDonholm, roleIdByName["Supervisor"]);
  staffKayoleId = await createStaff("shanniz@malisafi.app", "Shanniz K", locationKayole, roleIdByName["Sales User"]);

  // ==========================================================================
  // Step 3: copy the product catalogue (definitions only -- fresh ids,
  // no relationship back to the source tenant at all).
  // ==========================================================================
  console.log("Copying product catalogue...");
  const { data: sourceProducts, error: spErr } = await supabase
    .from("products")
    .select("sku, name, description, expected_price, show_expected_price, image_url, display_order, status, is_system")
    .eq("tenant_id", SOURCE_TENANT_ID)
    .eq("status", "active")
    .eq("is_system", false);
  if (spErr) throw new Error(`read source products: ${spErr.message}`);

  const productRows = sourceProducts.map((p) => ({
    tenant_id: tenantId,
    sku: p.sku,
    name: p.name,
    description: p.description,
    expected_price: p.expected_price,
    show_expected_price: p.show_expected_price,
    image_url: p.image_url,
    display_order: p.display_order,
    status: "active",
    tracks_inventory: true,
    unit_of_measure: "pcs",
    created_by: ownerProfileId,
  }));
  const { error: prodInsertErr } = await supabase.from("products").insert(productRows);
  if (prodInsertErr) throw new Error(`insert products: ${prodInsertErr.message}`);
  console.log(`Copied ${productRows.length} products.`);

  // Inventory add-on: active, no expiry, so the Stock module is fully
  // usable without going through real billing.
  const { data: plan } = await supabase.from("addon_plans").select("id").eq("addon_key", "inventory").eq("is_active", true).limit(1).single();
  const { error: addonErr } = await supabase.from("tenant_addon_subscriptions").insert({
    tenant_id: tenantId,
    addon_key: "inventory",
    plan_id: plan.id,
    status: "ACTIVE",
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    next_billing_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (addonErr) throw new Error(`addon subscription: ${addonErr.message}`);
  const { error: settingErr } = await supabase
    .from("tenant_settings")
    .upsert({ tenant_id: tenantId, setting_key: "inventory_enabled", value: true, updated_by: ownerProfileId }, { onConflict: "tenant_id,setting_key" });
  if (settingErr) throw new Error(`inventory_enabled setting: ${settingErr.message}`);

  // Demo marker -- lets a future run recognize this tenant belongs to
  // the seeder even if the lookup-by-email path ever needs a second
  // signal.
  const { error: demoFlagErr } = await supabase
    .from("tenant_settings")
    .upsert({ tenant_id: tenantId, setting_key: "is_demo_seed", value: true, updated_by: ownerProfileId }, { onConflict: "tenant_id,setting_key" });
  if (demoFlagErr) throw new Error(`is_demo_seed setting: ${demoFlagErr.message}`);
}

console.log(`Tenant ready: ${tenantSlug} (${tenantId})`);

// ============================================================================
// Step 4: load the (now-independent) product catalogue for generation
// ============================================================================
const { data: products, error: prodReadErr } = await supabase
  .from("products")
  .select("id, name, expected_price, unit_of_measure")
  .eq("tenant_id", tenantId)
  .eq("status", "active");
if (prodReadErr) throw new Error(`read products: ${prodReadErr.message}`);

// ~30% of the catalogue sells 3x as often -- gives Product Performance
// real winners/losers instead of flat demand across the board.
const popular = new Set();
for (const p of products) {
  if (Math.random() < 0.3) popular.add(p.id);
}
function weightOf(p) {
  return popular.has(p.id) ? 3 : 1;
}

const BRANCHES = [
  { id: locationDonholm, name: "Donholm", shareMin: 0.42, shareMax: 0.68 },
  { id: locationKayole, name: "Kayole", shareMin: null, shareMax: null }, // gets the remainder
];

const dates = dateRange(PERIOD_START, PERIOD_END);
console.log(`Generating ${dates.length} days x 2 branches...`);

const saleRows = [];
const stockMovementRows = [];

const runningStock = new Map(); // `${locationId}|${productId}` -> current quantity, tracked in-script for realistic opening/closing continuity

// Opening stock: seed a starting quantity per product per branch, a
// few days before PERIOD_START (occurred_on = the day before) so the
// very first seeded day already has a real opening balance to carry
// forward, per section 8's "opening/closing must flow from one day to
// the next" requirement.
const openingDate = new Date(`${PERIOD_START}T00:00:00Z`);
openingDate.setUTCDate(openingDate.getUTCDate() - 1);
const openingDateStr = openingDate.toISOString().slice(0, 10);

for (const branch of BRANCHES) {
  for (const product of products) {
    const openingQty = randInt(40, 120);
    runningStock.set(`${branch.id}|${product.id}`, openingQty);
    stockMovementRows.push({
      tenant_id: tenantId,
      location_id: branch.id,
      product_id: product.id,
      product_name_snapshot: product.name,
      unit_of_measure_snapshot: product.unit_of_measure ?? "pcs",
      movement_type: "opening_stock",
      quantity: openingQty,
      reason: null,
      recorded_by: ownerProfileId,
      occurred_on: openingDateStr,
    });
  }
}

function nairobiTimestamp(dateStr, hour, minute) {
  // Africa/Nairobi is a fixed UTC+3 offset -- subtract it to get the
  // equivalent UTC instant for a local wall-clock time on that date.
  const utcHour = hour - TZ_OFFSET_HOURS;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCHours(utcHour, minute, randInt(0, 59), 0);
  return d.toISOString();
}

for (const dateStr of dates) {
  const isToday = dateStr === TODAY;
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Every COMPLETE (non-today) day's COMBINED branch total must land
  // strictly within KES 3,500-5,500 -- a hard requirement, not "on
  // average." Weekends skew toward the top of the SAME band for
  // natural variety, never past it (the old weekendBoost multiplier
  // used to push some weekend days over 5,500). The stock-availability
  // top-up and the post-generation nudge pass below are what actually
  // guarantee the band -- this random draw just seeds a starting point.
  const dailyTotalTarget = isWeekend ? randInt(4300, 5500) : randInt(3500, 4700);
  const donholmShare = rand(BRANCHES[0].shareMin, BRANCHES[0].shareMax);
  const branchTargets = {
    [locationDonholm]: dailyTotalTarget * donholmShare,
    [locationKayole]: dailyTotalTarget * (1 - donholmShare),
  };

  const branchDay = {}; // locationId -> { daySales, accumulated, staffForBranch, openHour, closeHour }

  for (const branch of BRANCHES) {
    const target = branchTargets[branch.id];
    const staffForBranch = branch.id === locationDonholm ? staffDonholmId : staffKayoleId;
    const openHour = 8;
    const closeHour = 23; // trade winds down before literal midnight for realistic timestamps

    // Restocking happens FIRST, before the day's sales are generated --
    // a shop can't sell stock it hasn't received yet today. Targets
    // whichever products are currently LOWEST on stock (not a random
    // pick) -- both more realistic (real owners replenish what's
    // selling) and what actually keeps popular products from running
    // structurally negative over a 6-month period. ~45% chance per
    // branch per day; sized (via expected_price as the value proxy --
    // see header comment) so the AVERAGE across all days lands in the
    // requested KES 2,200-3,800/day band once spread over the ~45% of
    // days that actually get a purchase.
    if (Math.random() < 0.45) {
      const purchaseTarget = randInt(2200, 3800) / 0.45;
      let purchased = 0;
      const lowestStockFirst = [...products].sort(
        (a, b) => (runningStock.get(`${branch.id}|${a.id}`) ?? 0) - (runningStock.get(`${branch.id}|${b.id}`) ?? 0)
      );
      const purchaseProducts = lowestStockFirst.slice(0, randInt(4, 10));
      for (const product of purchaseProducts) {
        if (purchased >= purchaseTarget) break;
        const qty = randInt(30, 120);
        purchased += qty * product.expected_price;
        const key = `${branch.id}|${product.id}`;
        runningStock.set(key, (runningStock.get(key) ?? 0) + qty);
        stockMovementRows.push({
          tenant_id: tenantId,
          location_id: branch.id,
          product_id: product.id,
          product_name_snapshot: product.name,
          unit_of_measure_snapshot: product.unit_of_measure ?? "pcs",
          movement_type: "stock_in",
          quantity: qty,
          reason: null,
          recorded_by: ownerProfileId,
          occurred_on: dateStr,
        });
      }
    }

    // Guarantee stock is never the reason a complete day falls short of
    // its target -- this (not the target math) was the actual cause of
    // days landing under KES 3,500 previously. Tops up whichever
    // popular products are running low, on top of the ordinary ~45%
    // restock above, only when needed.
    if (!isToday) {
      const stockValue = products.reduce((sum, p) => sum + (runningStock.get(`${branch.id}|${p.id}`) ?? 0) * p.expected_price, 0);
      if (stockValue < target * 1.8) {
        const topUpProducts = [...products].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, 12);
        for (const product of topUpProducts) {
          const key = `${branch.id}|${product.id}`;
          const qty = randInt(25, 70);
          runningStock.set(key, (runningStock.get(key) ?? 0) + qty);
          stockMovementRows.push({
            tenant_id: tenantId,
            location_id: branch.id,
            product_id: product.id,
            product_name_snapshot: product.name,
            unit_of_measure_snapshot: product.unit_of_measure ?? "pcs",
            movement_type: "stock_in",
            quantity: qty,
            reason: null,
            recorded_by: ownerProfileId,
            occurred_on: dateStr,
          });
        }
      }
    }

    // For "today," if it's the live/open day, only generate a PARTIAL
    // morning's worth of trade (not the full day) -- section 9 wants
    // today to demonstrate real in-progress figures, not a day's worth
    // of sales that couldn't have happened yet by the time this is run.
    const effectiveTarget = isToday ? target * rand(0.25, 0.55) : target;

    let accumulated = 0;
    const daySales = [];
    let attempts = 0;
    // Never sells more than is actually in stock -- picks a different
    // product (retrying a bounded number of times) rather than letting
    // the running balance go negative; if the whole catalogue is
    // genuinely out at this branch, trade for the day just ends early
    // (a real, if unlikely, "sold out" state, still mathematically
    // consistent). Runs until the target is met (not a loose
    // 0.92-1.15x tolerance window) -- the stock top-up above is what
    // makes that safe to do without risking a runaway loop.
    while (accumulated < effectiveTarget && daySales.length < 80 && attempts < 800) {
      attempts += 1;
      const product = pickWeighted(products, weightOf);
      const key = `${branch.id}|${product.id}`;
      const available = runningStock.get(key) ?? 0;
      if (available < 1) continue;

      const qty = Math.min(randInt(1, 5), available);
      const amount = Math.round(product.expected_price * qty);
      daySales.push({ product, qty, amount });
      accumulated += amount;
      runningStock.set(key, available - qty);
    }

    branchDay[branch.id] = { daySales, accumulated, staffForBranch, openHour, closeHour };

    // Occasional shrinkage (damaged/expired produce) -- small, rare,
    // realistic for a grocery business, capped at what's actually on
    // hand so it can never push the running balance negative. Doesn't
    // affect the sales total, so it runs before the band-enforcement
    // nudge below without interfering with it.
    if (Math.random() < 0.08) {
      const product = pick(products);
      const key = `${branch.id}|${product.id}`;
      const current = runningStock.get(key) ?? 0;
      const qty = Math.min(randInt(1, 6), Math.floor(current * 0.1));
      if (qty > 0) {
        runningStock.set(key, current - qty);
        stockMovementRows.push({
          tenant_id: tenantId,
          location_id: branch.id,
          product_id: product.id,
          product_name_snapshot: product.name,
          unit_of_measure_snapshot: product.unit_of_measure ?? "pcs",
          movement_type: pick(["damaged", "expired"]),
          quantity: -qty,
          reason: "Spoilage during routine stock check",
          recorded_by: ownerProfileId,
          occurred_on: dateStr,
        });
      }
    }
  }

  // Hard band enforcement across the day's COMBINED branch total: nudge
  // up (add small stock-aware filler sales) or down (drop the smallest
  // sale rows, restoring their stock) until strictly within
  // [3500, 5500]. "Today" is exempt -- an intentional, smaller,
  // partial/in-progress figure by design.
  if (!isToday) {
    const donholmDay = branchDay[locationDonholm];
    const kayoleDay = branchDay[locationKayole];
    let combined = donholmDay.accumulated + kayoleDay.accumulated;

    function cheapestSaleable(locationId) {
      const candidates = products.filter((p) => (runningStock.get(`${locationId}|${p.id}`) ?? 0) >= 1);
      if (candidates.length === 0) return null;
      return [...candidates].sort((a, b) => a.expected_price - b.expected_price)[0];
    }

    let guard = 0;
    while (combined < 3500 && guard < 200) {
      guard += 1;
      const branch = pick(BRANCHES);
      const day = branchDay[branch.id];
      const product = cheapestSaleable(branch.id);
      if (!product) continue;
      const key = `${branch.id}|${product.id}`;
      const available = runningStock.get(key) ?? 0;
      const qty = Math.min(randInt(1, 3), available);
      const amount = Math.round(product.expected_price * qty);
      if (combined + amount > 5500) continue;
      day.daySales.push({ product, qty, amount });
      day.accumulated += amount;
      runningStock.set(key, available - qty);
      combined += amount;
    }

    guard = 0;
    while (combined > 5500 && guard < 200) {
      guard += 1;
      const branch = donholmDay.daySales.length >= kayoleDay.daySales.length ? BRANCHES[0] : BRANCHES[1];
      const day = branchDay[branch.id];
      if (day.daySales.length === 0) continue;
      let smallestIdx = 0;
      for (let i = 1; i < day.daySales.length; i++) {
        if (day.daySales[i].amount < day.daySales[smallestIdx].amount) smallestIdx = i;
      }
      const [removed] = day.daySales.splice(smallestIdx, 1);
      if (combined - removed.amount < 3500) {
        day.daySales.splice(smallestIdx, 0, removed);
        break;
      }
      const key = `${branch.id}|${removed.product.id}`;
      runningStock.set(key, (runningStock.get(key) ?? 0) + removed.qty);
      day.accumulated -= removed.amount;
      combined -= removed.amount;
    }
  }

  // Commit both branches now that each day's total is finalized:
  // business_days upsert, then the sale/stock_movement rows.
  for (const branch of BRANCHES) {
    const { daySales, accumulated, staffForBranch, openHour, closeHour } = branchDay[branch.id];

    // upsert, not insert: the live pg_cron sweep (run_business_day_sweep,
    // migration 0011) auto-creates a 'scheduled' placeholder row for
    // TODAY the moment a location exists with no row yet for its local
    // date -- entirely possible for it to have already fired for this
    // brand-new tenant's locations by the time this loop reaches
    // today's date, minutes into a run this long. Upserting lets this
    // script's fully-populated row safely replace that placeholder
    // instead of colliding with it.
    const { data: businessDay, error: bdErr } = await supabase
      .from("business_days")
      .upsert(
        {
          tenant_id: tenantId,
          location_id: branch.id,
          business_date: dateStr,
          status: isToday ? "open" : "closed",
          scheduled_open_time: "08:00",
          scheduled_close_time: "00:00",
          opened_at: nairobiTimestamp(dateStr, openHour, 0),
          opened_by: ownerProfileId,
          closed_at: isToday ? null : nairobiTimestamp(dateStr, closeHour, 55),
          closed_by: isToday ? null : ownerProfileId,
          aggregates: isToday ? {} : { grossSales: accumulated, transactionCount: daySales.length },
        },
        { onConflict: "tenant_id,location_id,business_date" }
      )
      .select("id")
      .single();
    if (bdErr || !businessDay) throw new Error(`business_day ${branch.name} ${dateStr}: ${bdErr?.message}`);

    for (const { product, qty, amount } of daySales) {
      const hour = randInt(openHour, closeHour);
      const minute = randInt(0, 59);
      const recordedBy = Math.random() < 0.75 ? staffForBranch : ownerProfileId;

      saleRows.push({
        tenant_id: tenantId,
        location_id: branch.id,
        business_day_id: businessDay.id,
        product_id: product.id,
        product_name_snapshot: product.name,
        expected_price_snapshot: product.expected_price,
        actual_amount: amount,
        quantity: qty,
        recorded_by: recordedBy,
        sale_date: dateStr,
        sale_time: nairobiTimestamp(dateStr, hour, minute),
        status: "open",
        idempotency_key: crypto.randomUUID(),
      });

      stockMovementRows.push({
        tenant_id: tenantId,
        location_id: branch.id,
        product_id: product.id,
        product_name_snapshot: product.name,
        unit_of_measure_snapshot: product.unit_of_measure ?? "pcs",
        movement_type: "stock_out",
        quantity: -qty,
        reason: null,
        recorded_by: recordedBy,
        occurred_on: dateStr,
      });
    }
  }

  if (dates.indexOf(dateStr) % 30 === 0) {
    console.log(`  ...through ${dateStr}`);
  }
}

console.log(`Inserting sales (${saleRows.length} rows) and stock movements (${stockMovementRows.length} rows)...`);
await insertBatched("sales", saleRows);
await insertBatched("stock_movements", stockMovementRows);

// ============================================================================
// Step 5: monthly stock reconciliation per product per branch -- computed
// the SAME way record_stock_reconciliation() does (reading stock_movements
// directly), inserted via service-role since that RPC requires a real
// auth.uid() session this bulk script doesn't have.
// ============================================================================
console.log("Generating monthly stock reconciliations...");
const monthEnds = ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"].filter((d) => d <= TODAY);
const monthStarts = { "2026-05-31": "2026-05-01", "2026-06-30": "2026-06-01", "2026-07-31": "2026-07-01", "2026-08-31": "2026-08-01" };

// Computed directly from the movements this run already generated in
// memory (stockMovementRows, plus the opening_stock rows seeded before
// the main loop) -- no need to round-trip the database for numbers
// this script already knows with certainty; guarantees the
// reconciliation rows agree exactly with what was actually inserted.
const finalReconciliationRows = [];
for (const monthEnd of monthEnds) {
  const monthStart = monthStarts[monthEnd];
  for (const branch of BRANCHES) {
    for (const product of products) {
      const relevant = stockMovementRows.filter((m) => m.location_id === branch.id && m.product_id === product.id && m.occurred_on <= monthEnd);
      const opening = relevant.filter((m) => m.occurred_on < monthStart).reduce((s, m) => s + m.quantity, 0);
      const within = relevant.filter((m) => m.occurred_on >= monthStart);
      const stockIn = within.filter((m) => m.quantity > 0).reduce((s, m) => s + m.quantity, 0);
      const stockOut = within.filter((m) => m.quantity < 0).reduce((s, m) => s - m.quantity, 0);
      finalReconciliationRows.push({
        tenant_id: tenantId,
        location_id: branch.id,
        product_id: product.id,
        reconciliation_date: monthEnd,
        opening_quantity: opening,
        stock_in_quantity: stockIn,
        stock_out_quantity: stockOut,
        // Exact (actual = expected) -- a demo doesn't need manufactured
        // variance noise; the report still shows a real, correctly-
        // computed row per product/branch/month.
        actual_quantity: opening + stockIn - stockOut,
        recorded_by: ownerProfileId,
      });
    }
  }
}
await insertBatched("stock_reconciliations", finalReconciliationRows, 200);
console.log(`Inserted ${finalReconciliationRows.length} reconciliation rows.`);

console.log("\nDone.");
console.log(`Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
console.log(`Tenant: ${tenantSlug}`);
console.log(`Sales generated: ${saleRows.length}`);
console.log(`Stock movements generated: ${stockMovementRows.length}`);

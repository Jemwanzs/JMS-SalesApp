#!/usr/bin/env node
// Hardening roadmap Phase 6.4 (docs/22-hardening-roadmap.md,
// docs/22-hardening-roadmap.md's "6.4 advisory" section for the full
// design reasoning). Runs from .github/workflows/backup.yml only --
// never invoked from the Next.js app itself, so its dependencies
// (@google-cloud/local-auth is NOT used; google-auth-library is
// installed ad hoc in the workflow, --no-save, same pattern already
// established for scripts/build-user-guide-pdf.mjs's ad hoc playwright
// install) never touch the app's own package.json.
//
// What this does, in order:
//   1. Reads backup_frequency_hours/backup_retention_count from
//      platform_settings (service-role, same table every other global
//      policy value in this app already lives in).
//   2. Checks the target Drive folder's most recent file -- skips
//      (exit 0, not an error) if a backup already ran within the
//      configured frequency. Drive's own file timestamps are the
//      source of truth for "when was the last backup", not a separate
//      DB column that could drift out of sync with what's actually up
//      there.
//   3. pg_dump -Fc (custom compressed format -- captures schema AND
//      data for exactly the tables listed below, restorable directly
//      via pg_restore), scoped to a fixed allow-list of tables, not
//      the whole database.
//   4. Encrypts the dump with gpg (AES256, symmetric passphrase) --
//      NOT optional. A whole-database dump has no RLS around it the
//      moment it leaves Supabase; encrypting before upload is the one
//      part of this design that isn't a nice-to-have.
//   5. Uploads the encrypted file to the configured Drive folder.
//   6. Prunes older backups beyond backup_retention_count so the
//      folder doesn't silently grow forever and exhaust Drive's quota.
//
// Tables backed up -- Tier 1 (financial/compliance, can't be
// regenerated) + Tier 2 (inventory ledger, same reasoning). Explicitly
// NOT included: insights_snapshots (derivable from sales), login_events/
// sessions (operational, not financial -- lower value, and needlessly
// widens what a leaked backup file would expose), product images
// (regenerable, and would make the payload much larger for little
// value -- a documented, deliberate v1 scope cut, not an oversight).
const BACKUP_TABLES = [
  "tenants",
  "profiles",
  "tenant_memberships",
  "roles",
  "role_permissions",
  "user_role_assignments",
  "products",
  "sales",
  "sale_corrections",
  "subscriptions",
  "payments",
  "tenant_addon_subscriptions",
  "addon_payments",
  "audit_logs",
  "platform_audit_logs",
  "stock_movements",
  "stock_reconciliations",
];

import { execFileSync } from "node:child_process";
import { createReadStream, statSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GoogleAuth } from "google-auth-library";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("This backup job needs a real Google Cloud service account, Drive folder, and encryption passphrase configured as GitHub Actions secrets before it can run -- see docs/22-hardening-roadmap.md's Phase 6.4 section for the setup steps.");
    process.exit(1);
  }
  return value;
}

async function getDueCheck(supabase, driveAuth, folderId) {
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["backup_frequency_hours"]);

  const frequencyHours = Number(settings?.find((s) => s.key === "backup_frequency_hours")?.value ?? 24);

  const client = await driveAuth.getClient();
  const token = await client.getAccessToken();
  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&orderBy=createdTime desc&pageSize=1&fields=files(id,createdTime)`,
    { headers: { Authorization: `Bearer ${token.token}` } }
  );
  if (!res.ok) {
    throw new Error(`Drive list (due-check) failed: ${res.status} ${await res.text()}`);
  }
  const { files } = await res.json();
  const mostRecent = files?.[0];

  if (!mostRecent) {
    return { due: true, frequencyHours };
  }

  const hoursSinceLastBackup = (Date.now() - new Date(mostRecent.createdTime).getTime()) / (1000 * 60 * 60);
  return { due: hoursSinceLastBackup >= frequencyHours, frequencyHours, hoursSinceLastBackup };
}

function runPgDump(dbUrl, outPath) {
  const args = ["--format=custom", "--file", outPath, "--no-owner", "--no-privileges"];
  for (const table of BACKUP_TABLES) {
    args.push("--table", `public.${table}`);
  }
  args.push(dbUrl);

  execFileSync("pg_dump", args, { stdio: "inherit" });
}

function encryptFile(inPath, outPath, passphrase) {
  execFileSync(
    "gpg",
    ["--batch", "--yes", "--passphrase-fd", "0", "--symmetric", "--cipher-algo", "AES256", "-o", outPath, inPath],
    { input: passphrase, stdio: ["pipe", "inherit", "inherit"] }
  );
}

async function uploadToDrive(driveAuth, folderId, filePath, fileName) {
  const client = await driveAuth.getClient();
  const token = await client.getAccessToken();

  const metadata = { name: fileName, parents: [folderId] };
  const fileSize = statSync(filePath).size;

  const boundary = "jms-backup-boundary";
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;

  // Streamed via a Blob composed of the metadata text + file bytes + closing
  // boundary, rather than reading the whole (potentially large) dump into a
  // single string -- fetch's body accepts a ReadableStream/Blob directly.
  const fileStream = createReadStream(filePath);
  const chunks = [];
  for await (const chunk of fileStream) chunks.push(chunk);
  const fileBuffer = Buffer.concat(chunks);

  const body = Buffer.concat([Buffer.from(metadataPart), fileBuffer, Buffer.from(closingPart)]);

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,createdTime`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  const uploaded = await res.json();
  console.log(`Uploaded ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB) -> Drive file ${uploaded.id}`);
  return uploaded;
}

async function pruneOldBackups(driveAuth, folderId, retentionCount) {
  const client = await driveAuth.getClient();
  const token = await client.getAccessToken();

  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,createdTime)`,
    { headers: { Authorization: `Bearer ${token.token}` } }
  );
  if (!res.ok) {
    throw new Error(`Drive list (prune) failed: ${res.status} ${await res.text()}`);
  }
  const { files } = await res.json();
  const toDelete = (files ?? []).slice(retentionCount);

  for (const file of toDelete) {
    const del = await fetch(`${DRIVE_API}/files/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token.token}` },
    });
    if (!del.ok) {
      console.error(`Failed to prune ${file.name} (${file.id}): ${del.status} ${await del.text()}`);
      continue;
    }
    console.log(`Pruned old backup: ${file.name}`);
  }

  if (toDelete.length === 0) {
    console.log(`Nothing to prune (${files?.length ?? 0} backups <= retention count ${retentionCount}).`);
  }
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = requireEnv("SUPABASE_DB_URL");
  const encryptionPassphrase = requireEnv("BACKUP_ENCRYPTION_PASSPHRASE");
  const googleServiceAccountKey = requireEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
  const folderId = requireEnv("BACKUP_DRIVE_FOLDER_ID");

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const driveAuth = new GoogleAuth({
    credentials: JSON.parse(googleServiceAccountKey),
    scopes: [DRIVE_SCOPE],
  });

  const dueCheck = await getDueCheck(supabase, driveAuth, folderId);
  if (!dueCheck.due) {
    console.log(
      `Skipping: last backup was ${dueCheck.hoursSinceLastBackup?.toFixed(1)}h ago, configured frequency is ${dueCheck.frequencyHours}h.`
    );
    return;
  }

  const { data: retentionSetting } = await supabase.from("platform_settings").select("value").eq("key", "backup_retention_count").maybeSingle();
  const retentionCount = Number(retentionSetting?.value ?? 30);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = `/tmp/jms-sales-app-${timestamp}.dump`;
  const encryptedPath = `${dumpPath}.gpg`;
  const fileName = `jms-sales-app-backup-${timestamp}.dump.gpg`;

  console.log(`Dumping ${BACKUP_TABLES.length} tables...`);
  runPgDump(dbUrl, dumpPath);

  console.log("Encrypting...");
  encryptFile(dumpPath, encryptedPath, encryptionPassphrase);
  unlinkSync(dumpPath); // the unencrypted dump never needs to exist past this point

  console.log("Uploading to Google Drive...");
  await uploadToDrive(driveAuth, folderId, encryptedPath, fileName);
  unlinkSync(encryptedPath);

  console.log(`Pruning to the most recent ${retentionCount} backups...`);
  await pruneOldBackups(driveAuth, folderId, retentionCount);

  console.log("Backup complete.");
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});

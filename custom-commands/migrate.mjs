//MADE WITH AI

import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { resolve, basename, extname, join } from "path";
import * as readline from "readline";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = "packages/db/migrations";
const ROOT_DIR = process.cwd();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function error(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function findMigrationFile(input) {
  if (!input) return null;

  const migrationsAbsDir = join(ROOT_DIR, MIGRATIONS_DIR);
  const fileName = basename(input);

  // Step 1: try exact absolute/relative resolution
  const absolute = resolve(ROOT_DIR, input);
  if (existsSync(absolute)) return absolute;

  // Step 2: try just the filename inside migrations dir
  const inMigrationsDir = join(migrationsAbsDir, fileName);
  if (existsSync(inMigrationsDir)) return inMigrationsDir;

  // Step 3: fuzzy match in migrations dir
  const allFiles = readdirSync(migrationsAbsDir);
  const match = allFiles.find(f => f === fileName);
  if (match) return join(migrationsAbsDir, match);

  return null;
}

function toRelative(absolutePath) {
  return absolutePath.replace(ROOT_DIR + "/", "");
}

function ask(question) {
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

function isYes(answer) {
  return answer === "" || ["y", "yes"].includes(answer.toLowerCase());
}

function isNo(answer) {
  return ["n", "no"].includes(answer.toLowerCase());
}

// ─── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const dbName = args[0];
const isLocal = args.includes("--local");
const isRemote = args.includes("--remote");
const fileArg = args.find(a => a.startsWith("--file="));
const fileInput = fileArg ? fileArg.split("=").slice(1).join("=") : null;

// ─── Validate ────────────────────────────────────────────────────────────────

if (!dbName || dbName.startsWith("--")) {
  error(
    "Missing database name.\n\n" +
    "  Usage: pnpm db:migrate <dbname> --file=<migration> --local|--remote\n\n" +
    "  Examples:\n" +
    "    pnpm db:migrate mantomart --file=0000_empty_gressill.sql --local\n" +
    "    pnpm db:migrate mantomart --file=packages/db/migrations/0000_empty_gressill.sql --remote"
  );
}

if (!isLocal && !isRemote) {
  error("Specify either --local or --remote.");
}

if (isLocal && isRemote) {
  error("Cannot specify both --local and --remote at the same time.");
}

if (!fileInput) {
  error(
    "Missing --file argument.\n\n" +
    "  You can provide:\n" +
    "    --file=0000_empty_gressill.sql\n" +
    "    --file=packages/db/migrations/0000_empty_gressill.sql\n" +
    "    --file=/absolute/path/to/migration.sql"
  );
}

if (extname(fileInput) !== ".sql") {
  error(`File must have a .sql extension. Got: "${fileInput}"`);
}

const resolvedFile = findMigrationFile(fileInput);

if (!resolvedFile) {
  error(
    `Could not find migration file: "${fileInput}"\n\n` +
    `  Looked in: ${MIGRATIONS_DIR}/\n` +
    `  Make sure the file exists. Run "pnpm db:generate" first if needed.`
  );
}

const relativePath = toRelative(resolvedFile);
const env = isLocal ? "--local" : "--remote";
const command = `pnpm --filter api exec wrangler d1 execute ${dbName} ${env} --file=${resolvedFile}`;

// ─── Confirm ─────────────────────────────────────────────────────────────────

console.log(`\n📄 Migration file : ${relativePath}`);
console.log(`🗄️  Database       : ${dbName}`);
console.log(`🌍 Environment    : ${isLocal ? "local" : "remote (production)"}\n`);

const answer = await ask("Is this correct? [Y/n]: ");

if (isNo(answer)) {
  console.log("\n🚫 Aborted.\n");
  process.exit(0);
} else if (!isYes(answer)) {
  error(`Unrecognised answer "${answer}". Please type y, yes, n, no — or just press Enter to confirm.`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log(`\n⚡ Running: ${command}\n`);

try {
  execSync(command, { stdio: "inherit" });
  console.log("\n✅ Migration applied successfully.\n");
} catch (e) {
  error("Migration failed. See output above for details.");
}
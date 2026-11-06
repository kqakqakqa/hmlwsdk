#!/usr/bin/env node
import { build } from "../src/build.js";

/**
 * hmlwsdk 命令行入口
 *
 *   hmlwsdk buildBin <工程目录>
 *   hmlwsdk buildApp <工程目录>
 *   hmlwsdk buildSignedHap <工程目录> --p7b my.p7b --key private-pkcs8.pem
 *   hmlwsdk buildSignedApp <工程目录> --p7b my.p7b --p12 mystore.p12 --p12pwd 123456
 *
 * 四条命令 = 两个停止点（.bin / hap 或 .app）× 有没有签名配置：
 *
 *   buildBin         出 .bin
 *   buildApp         出 .app（顺带出文件树形态的 hap、.bin）
 *   buildSignedHap   出「里面那个 .bin 已签名」的 hap，必须给 --p7b
 *   buildSignedApp   出签名后的 .app，必须给 --p7b
 *
 * buildBin / buildApp 给了 --p7b 也会顺带签名，与 Gradle 的行为一致
 * （没配 signingConfig 就只出 unsigned）。
 *
 * 签名相关参数：
 *   --p7b <file>      必给，HarmonyOS profile
 *   --p12 <file>      PKCS#12 私钥库，配合 --p12pwd
 *   --p12pwd <pwd>    p12 密码
 *   --key <file>      直接给 PEM 私钥（和 --p12 二选一）
 *   --cert <file>     替换内置的华为根+中间证书链
 *
 * 工程目录指模块目录的上一级，例如 apps/devdemo/devdemo（里面有 entry/）。
 */

const argv = process.argv.slice(2);
const flags = {};
const args = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--work") flags.work = argv[++i];
  else if (argv[i] === "--p7b") flags.p7b = argv[++i];
  else if (argv[i] === "--p12") flags.p12 = argv[++i];
  else if (argv[i] === "--p12pwd") flags.p12pwd = argv[++i];
  else if (argv[i] === "--key") flags.key = argv[++i];
  else if (argv[i] === "--cert") flags.cert = argv[++i];
  else args.push(argv[i]);
}

/**
 * 命令名 → build() 的 target
 *
 * needsSigning：命令名承诺了要出签名产物，不给 --p7b 直接报错。
 * 静默退回 unsigned 是坑
 */
const COMMANDS = {
  buildBin: { target: "bin" },
  buildApp: { target: "app" },
  buildSignedHap: { target: "signedHap", needsSigning: true },
  buildSignedApp: { target: "signedApp", needsSigning: true }
};

function printUsage() {
  console.error("usage: hmlwsdk <command> <project-dir> [options]");
  console.error(`commands: ${Object.keys(COMMANDS).join("  ")}`);
  console.error("  buildBin         .bin");
  console.error("  buildApp         .app（含文件树形态的 hap、.bin）");
  console.error("  buildSignedHap   里面那个 .bin 已签名的 hap（要 --p7b）");
  console.error("  buildSignedApp   签名后的 .app（要 --p7b）");
  console.error("example: hmlwsdk buildSignedHap /path/to/apps/devdemo/devdemo --p7b my.p7b --key private-pkcs8.pem");
}

const command = args[0];
const projectDir = args[1];
const spec = COMMANDS[command];

if (!spec) {
  if (command) console.error(`unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

if (spec.needsSigning && !flags.p7b) {
  console.error(`${command} produces a signed artifact, but no --p7b was given (--p7b plus either --p12 + --p12pwd or --key)`);
  process.exit(1);
}

if (!projectDir) {
  console.error("missing project dir. usage: hmlwsdk <command> <project-dir>");
  process.exit(1);
}

// 没给 p7b 就是"不签"，与 Gradle 没配 signingConfig 的行为一致
const signingConfig = flags.p7b
  ? { p7b: flags.p7b, p12: flags.p12, password: flags.p12pwd, keyFile: flags.key, certPath: flags.cert }
  : undefined;

let outputs;
try {
  outputs = await build({ projectDir, target: spec.target, work: flags.work, signingConfig });
} catch (e) {
  console.error(`\nbuild failed: ${e.message}`);
  process.exit(1);
}

console.log("\noutputs:");
for (const [kind, p] of Object.entries(outputs)) {
  if (kind === "target" || kind === "work") continue;
  console.log(`  ${kind.padEnd(10)} ${p}`);
}
console.log(`\nwork dir: ${outputs.work}`);

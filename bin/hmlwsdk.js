#!/usr/bin/env node
import fs from "fs";
import path from "path";

import { runBuild, plan } from "../src/runBuild.js";
import { createTaskContext } from "../src/createTaskContext.js";
import { parseBuildGradle } from "../src/parseBuildGradle.js";

/**
 * hmlwsdk 命令行入口
 *
 *   hmlwsdk buildBin <工程目录>
 *   hmlwsdk buildSignedHap <工程目录> --p7b my.p7b --key private-pkcs8.pem
 *   hmlwsdk --plan buildSignedHap     只列要跑哪些任务，不执行
 *
 * 四条命令：
 *
 *   buildBin          只出 .bin
 *   buildApp          出 .app（顺带把 hap、.bin 都出了，它在依赖链末端）
 *   buildSignedHap    构建 + 签名，出「里面那个 .bin 已签名」的 hap
 *   buildSignedApp    构建 + 签名，出签名的 .app
 *
 * 没有单独的签名命令，也没有 buildHap —— 未签名的 hap 是 buildSignedHap 的中间产物
 * （hap/release/entry-bin-release-lite-unsigned.hap），照样留在 work 目录里。
 *
 * 签名相关参数（buildBin / buildApp 不给就是出 unsigned 包；buildSigned* 必须给）：
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
  if (argv[i] === "--plan") flags.plan = true;
  else if (argv[i] === "--work") flags.work = argv[++i];
  else if (argv[i] === "--p7b") flags.p7b = argv[++i];
  else if (argv[i] === "--p12") flags.p12 = argv[++i];
  else if (argv[i] === "--p12pwd") flags.p12pwd = argv[++i];
  else if (argv[i] === "--key") flags.key = argv[++i];
  else if (argv[i] === "--cert") flags.cert = argv[++i];
  else args.push(argv[i]);
}

/**
 * 四条命令 → 内部任务
 *
 * entry         走依赖图（runBuild）：前置任务自动补齐
 * needsSigning  必须给 --p7b，不给直接报错。命令名承诺了要出签名产物，
 *               静默退回 unsigned 是坑
 */
const COMMANDS = {
  buildBin: { entry: "generateReleaseJsBin" },
  buildApp: { entry: "packageReleaseApp" },

  buildSignedHap: { entry: "signReleaseHap", needsSigning: true },
  buildSignedApp: { entry: "signReleaseApp", needsSigning: true }
};

function printUsage() {
  console.error("usage: hmlwsdk <command> <project-dir> [options]");
  console.error(`commands: ${Object.keys(COMMANDS).join("  ")}`);
  console.error("example: hmlwsdk buildSignedHap /path/to/apps/devdemo/devdemo --p7b my.p7b --key private-pkcs8.pem");
  console.error("         hmlwsdk --plan buildSignedHap");
}

const command = args[0];
const projectDir = args[1];
const spec = COMMANDS[command];

if (!spec) {
  if (command) console.error(`unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

// --plan 只需要命令名，不需要工程目录
if (flags.plan) {
  for (const name of plan(spec.entry)) console.log(name);
  process.exit(0);
}

if (spec.needsSigning && !flags.p7b) {
  console.error(`${command} produces a signed artifact, but no --p7b was given (--p7b plus either --p12 + --p12pwd or --key)`);
  process.exit(1);
}

if (!projectDir) {
  console.error("missing project dir. usage: hmlwsdk <command> <project-dir>");
  process.exit(1);
}

const root = path.resolve(projectDir);
const moduleDir = path.join(root, "entry");
const configPath = path.join(moduleDir, "src", "main", "config.json");

if (!fs.existsSync(configPath)) {
  console.error(`cannot find ${configPath}, make sure the project dir points at the level that contains entry/`);
  process.exit(1);
}

// 版本号从工程自己的 build.gradle 读，不写死 —— 不同工程的值可能不一样
const sdkVersions = parseBuildGradle(moduleDir);

const taskContext = createTaskContext({
  projectDir: root,
  moduleDir,
  work: flags.work ?? path.join(root, "build", "hmlwsdk"),
  srcConfig: JSON.parse(fs.readFileSync(configPath, "utf8")),
  ...sdkVersions,
  // 没给 p7b 就是"不签"，与 Gradle 没配 signingConfig 的行为一致
  signingConfig: flags.p7b
    ? { p7b: flags.p7b, p12: flags.p12, password: flags.p12pwd, keyFile: flags.key, certPath: flags.cert }
    : undefined
});

const r = await runBuild(taskContext, spec.entry);

if (!r.ok) {
  console.error(`\nbuild failed at ${r.failedAt}`);
  process.exit(1);
}

console.log(`\noutput dir: ${taskContext.work}`);

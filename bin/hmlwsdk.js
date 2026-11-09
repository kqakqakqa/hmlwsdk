#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";

import { build } from "../src/build.js";
import { createProject } from "../src/createProject.js";
import { initProject } from "../src/initProject.js";
import { readProjectConfig } from "../src/readProjectConfig.js";

/**
 * hmlwsdk 命令行入口
 *
 *   hmlwsdk create  [新工程目录]   ← 造一个新工程（省略就在 cwd 造）
 *   hmlwsdk init    [工程目录]
 *   hmlwsdk build   [工程目录]
 *
 * init / build 的工程目录可以省略 —— 省略时从 cwd 向上找含 entry/src/main/config.json
 * 的那一层，所以在工程里的任何子目录下都能直接跑。
 *
 * create 的目录参数是**字面目标路径**，不是「从哪儿开始往上找」：它要在那里新建
 * 一个工程，所以不能要求那个目录已经存在。省略时用 cwd，且 cwd 里除了 . 开头的
 * 条目之外必须为空。
 *
 * **签名材料不走参数**，统一从 <工程>/cert/ 读（细节见 src/readSigningConfig.js）：
 *   cert/*.p7b + cert/*.p12 或 *.pem   名字唯一时直接丢进去就完事
 *   cert/signing.config.js             自动发现的结果回写在这里，也可手写
 *
 * build 一次出三份产物，全落在 <工程>/build/ 根：
 *   <bundleName>.app                  未签的 .app，整个应用
 *   <bundleName>-signed.hap           里面那个 .bin 已签名，设备直接装的就是它
 *   <bundleName>-signed.app           签过名的 .app，上架用
 * 后两份要 cert/ 里有 p7b 才出得来 —— 缺材料时不报错，只落第一份并打一行警告。
 * 签过的在扩展名前加 -signed。
 * 未签的 .bin 不落盘，中间产物（未签 hap、pack.info）也只在内存里往后传。
 * 写 .bin 时就直接写成 p7b 的身份：包内 bundleName 用 p7b 里的值、version.code 置 0，
 * 但产物文件名仍用工程的 bundleName；.app 那两份的包内字段保持工程原值。
 */

/** 本文件在 <SDK>/bin 下，往上一级就是 SDK 根 */
const SDK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);

/**
 * 命令名 → 要做的事
 *
 * 没有 target 这一层了：build 一条跑完整条链，能出的产物全出。
 * 早先有 buildBin / buildApp / buildSignedHap / buildSignedApp 四条，
 * 末尾几步打包加起来才十几毫秒，分成四条只是让人多记四个名字。
 */
const COMMANDS = {
  create: {},
  init: {},
  build: {}
};

function printUsage() {
  console.error("usage: hmlwsdk <command> [project-dir]");
  console.error(`commands: ${Object.keys(COMMANDS).join("  ")}`);
  console.error("  create   scaffold a new project from the built-in template (the dir arg is the literal target path, defaults to cwd)");
  console.error("  init     turn a project into one-command builds (creates config / cert / build)");
  console.error("  build    build everything: .app, and the signed hap / app when cert/ has material");
  console.error("");
  console.error("project-dir may be omitted for init / build: it walks up from cwd to the level holding entry/src/main/config.json");
  console.error("project-dir may be omitted for create: it builds in cwd, which must be empty apart from dot entries");
  console.error("example: hmlwsdk create myapp    scaffold a new project into ./myapp");
  console.error("         hmlwsdk init            existing project: run once at the project root");
  console.error("         hmlwsdk build           run any time afterwards, signing material comes from cert/");
}

const command = args[0];
const projectArg = args[1];
const spec = command ? COMMANDS[command] : undefined;

if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(command ? 0 : 1);
}

if (!spec) {
  console.error(`unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

try {
  if (command === "create") {
    createProject({ dir: projectArg, sdkDir: SDK_DIR });
  } else if (command === "init") {
    initProject({ dir: projectArg, sdkDir: SDK_DIR });
  } else {
    const root = readProjectConfig(projectArg);
    const outputs = await build({ projectDir: root });
    printOutputs(outputs);
  }
} catch (e) {
  console.error(`\n${command} failed: ${e.message}`);
  process.exit(1);
}

/**
 * 打印这一轮落盘的产物
 *
 * 一条 build 出 1~3 份，按落盘顺序列出来。`cert/` 里没有 p7b 时只有那份未签 .app ——
 * 少的那两份上面已经打过一行警告，这里不重复解释。
 */
function printOutputs(outputs) {
  console.log("\noutputs:");
  for (const file of outputs.artifacts) console.log(`  ${file}`);
}

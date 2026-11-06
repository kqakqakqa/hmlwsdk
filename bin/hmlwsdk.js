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
 *   hmlwsdk create          [新工程目录]   ← 造一个新工程（省略就在 cwd 造）
 *   hmlwsdk init            [工程目录]
 *   hmlwsdk buildBin        [工程目录]
 *   hmlwsdk buildApp        [工程目录]
 *   hmlwsdk buildSignedHap  [工程目录]
 *   hmlwsdk buildSignedApp  [工程目录]
 *
 * init / build* 的工程目录可以省略 —— 省略时从 cwd 向上找含 entry/src/main/config.json
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
 * 四条 build 命令：
 *   buildBin        出 .bin
 *   buildApp        出 .app（顺带出 .bin 形态的 hap、.bin），cert/ 有材料就签
 *   buildSignedHap  出「里面那个 .bin 已签名」的 hap，要求 cert/ 有材料
 *   buildSignedApp  出签名后的 .app，要求 cert/ 有材料
 *
 * 最终产物落在 <工程>/build/ 根：<bundleName>.app、<bundleName>.hap（单 .bin 形态），
 * 中间产物在 <工程>/build/hmlwsdk/ 下。
 */

/** 本文件在 <SDK>/bin 下，往上一级就是 SDK 根 */
const SDK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);

/**
 * 命令名 → build() 的 target
 *
 * 两个 signed* 承诺出签名产物，cert/ 里没材料时 build() 直接报错（静默退回
 * unsigned 是坑）；另外两条是「有材料就签」。
 */
const COMMANDS = {
  create: {},
  init: {},
  buildBin: { target: "bin" },
  buildApp: { target: "app" },
  buildSignedHap: { target: "signedHap" },
  buildSignedApp: { target: "signedApp" }
};

function printUsage() {
  console.error("usage: hmlwsdk <command> [project-dir]");
  console.error(`commands: ${Object.keys(COMMANDS).join("  ")}`);
  console.error("  create           从内置模板造一个新工程（目录参数是字面目标路径，省略用当前目录）");
  console.error("  init             把工程初始化成一条命令出包（生成 config / cert / build 目录）");
  console.error("  buildBin         .bin");
  console.error("  buildApp         .app（含 .bin 形态的 hap、.bin），cert/ 有材料就签");
  console.error("  buildSignedHap   里面那个 .bin 已签名的 hap（要求 cert/ 有材料）");
  console.error("  buildSignedApp   签名后的 .app（要求 cert/ 有材料）");
  console.error("");
  console.error("init / build* 的 project-dir 省略时从当前目录向上找含 entry/src/main/config.json 的那一层");
  console.error("create 的 project-dir 省略时就在当前目录建，且除 . 开头的条目外必须为空");
  console.error("example: hmlwsdk create myapp    造一个新工程到 ./myapp");
  console.error("         hmlwsdk init            已有工程：在工程根执行一次");
  console.error("         hmlwsdk buildApp        之后随时跑，签名材料从 cert/ 读");
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
    // 先读 hmlwsdk.config.js：拿工程根和该用哪个 node（缺失时这里就会给出人话提示）
    const config = await readProjectConfig(projectArg);
    const outputs = await build({ projectDir: config.root, target: spec.target, node: config.node });
    printOutputs(outputs);
  }
} catch (e) {
  console.error(`\n${command} failed: ${e.message}`);
  process.exit(1);
}

function printOutputs(outputs) {
  console.log("\noutputs:");
  for (const [kind, p] of Object.entries(outputs)) {
    if (kind === "target" || kind === "work") continue;
    console.log(`  ${kind.padEnd(14)} ${p}`);
  }
  console.log(`\nwork dir: ${outputs.work}`);
}

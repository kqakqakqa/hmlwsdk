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
 *   buildApp        出 .app，cert/ 有材料就签
 *   buildSignedHap  出「里面那个 .bin 已签名」的 hap，要求 cert/ 有材料
 *   buildSignedApp  出签名后的 .app，要求 cert/ 有材料
 *
 * 最终产物只有一份，落在 <工程>/build/ 根，名字用 bundleName：
 *   buildBin        build/<bundleName>.bin
 *   buildApp        build/<bundleName>.app
 *   buildSignedHap  build/<bundleName>.hap
 *   buildSignedApp  build/<bundleName>.app
 * 中间产物（.bin、两种 hap、pack.info）不落盘，只在内存里往后传。
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
  console.error("  create           scaffold a new project from the built-in template (the dir arg is the literal target path, defaults to cwd)");
  console.error("  init             turn a project into one-command builds (creates config / cert / build)");
  console.error("  buildBin         .bin");
  console.error("  buildApp         .app, signed when cert/ has material");
  console.error("  buildSignedHap   the hap whose inner .bin is signed (requires material in cert/)");
  console.error("  buildSignedApp   the signed .app (requires material in cert/)");
  console.error("");
  console.error("project-dir may be omitted for init / build*: it walks up from cwd to the level holding entry/src/main/config.json");
  console.error("project-dir may be omitted for create: it builds in cwd, which must be empty apart from dot entries");
  console.error("example: hmlwsdk create myapp    scaffold a new project into ./myapp");
  console.error("         hmlwsdk init            existing project: run once at the project root");
  console.error("         hmlwsdk buildApp        run any time afterwards, signing material comes from cert/");
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

/**
 * 打印那一份产物
 *
 * build() 现在只落一个文件，所以这里就一行 —— 早先它把 outputs 里每条路径都
 * 列出来，六行里有四行是中间产物，看着像生成了六个包。
 */
function printOutputs(outputs) {
  console.log(`\noutputs:\n  ${outputs.artifact}`);
}

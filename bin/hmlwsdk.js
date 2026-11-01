#!/usr/bin/env node
import fs from "fs";
import path from "path";

import { runBuild, plan } from "../src/build.js";
import { createCtx } from "../src/tasks/_util.js";

/**
 * hmlwsdk 命令行入口
 *
 *   node bin/hmlwsdk.js signReleaseApp <工程目录>
 *   node bin/hmlwsdk.js packageReleaseApp <工程目录> --work <中间产物目录>
 *   node bin/hmlwsdk.js --plan signReleaseApp        只列要跑哪些任务，不执行
 *
 * 工程目录指模块目录的上一级，例如 apps/devdemo/devdemo（里面有 entry/）。
 */

const argv = process.argv.slice(2);
const flags = {};
const args = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--plan") flags.plan = true;
  else if (argv[i] === "--work") flags.work = argv[++i];
  else args.push(argv[i]);
}

const target = args[0];
const projectDir = args[1] ?? process.env.HMLW_PROJECT;

if (!target) {
  console.error("用法: hmlwsdk <任务名> <工程目录> [--work 目录] [--plan]");
  console.error("例如: hmlwsdk signReleaseApp E:/repo/hmlw/apps/devdemo/devdemo");
  console.error("      hmlwsdk --plan signReleaseApp");
  process.exit(1);
}

// --plan 只需要任务名，不需要工程目录
if (flags.plan) {
  for (const name of plan(target)) console.log(name);
  process.exit(0);
}

if (!projectDir) {
  console.error("缺少工程目录。可以写在第二个参数，或设环境变量 HMLW_PROJECT。");
  process.exit(1);
}

const root = path.resolve(projectDir);
const moduleDir = path.join(root, "entry");
const configPath = path.join(moduleDir, "src", "main", "config.json");

if (!fs.existsSync(configPath)) {
  console.error(`找不到 ${configPath}，确认工程目录指对了（应该指向含 entry/ 的那一级）。`);
  process.exit(1);
}

const ctx = createCtx({
  projectDir: root,
  moduleDir,
  work: flags.work ?? path.join(root, "build", "hmlwsdk"),
  sample: moduleDir,
  srcConfig: JSON.parse(fs.readFileSync(configPath, "utf8")),
  // 这两个值在 build.gradle 里，本 SDK 还不会解析 Groovy DSL，先按本项目写死
  compileSdkVersion: 6,
  compatibleSdkVersion: 3
});

const r = runBuild(ctx, target);

if (!r.ok) {
  console.error(`\n构建失败，卡在 ${r.failedAt}`);
  process.exit(1);
}

console.log(`\n产物目录：${ctx.work}`);

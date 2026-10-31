/**
 * 18 个任务按依赖顺序登记 —— 这个顺序就是未来 build.js 的执行顺序
 *
 * 顺序依据：doc/gradle-build-report.html 的 01 节（按依赖深度从小到大）。
 * 已移除 7 个空方法任务，它们 run() 里没有一条指令，不在链上。
 *
 * 只做 release 变体。debug 构建已放弃：debug 只出 1 个 .bin 形态的包，
 * 且不压缩，发布用不上。验证基准是 apps/devdemo/devdemo 的 release 产物。
 */

import * as mergeReleaseResources from "./mergeReleaseResources.js";
import * as mergeReleaseProfile from "./mergeReleaseProfile.js";
import * as generateReleaseJsManifest from "./generateReleaseJsManifest.js";
import * as compileReleaseJsWithNode from "./compileReleaseJsWithNode.js";
import * as processReleaseProfile from "./processReleaseProfile.js";
import * as compileReleaseResources from "./compileReleaseResources.js";
import * as generateReleaseBinSource from "./generateReleaseBinSource.js";
import * as processReleaseJavaRes from "./processReleaseJavaRes.js";
import * as processReleaseLibsFile from "./processReleaseLibsFile.js";
import * as generateReleaseJsBin from "./generateReleaseJsBin.js";
import * as signReleaseJsBin from "./signReleaseJsBin.js";
import * as packageReleaseHap from "./packageReleaseHap.js";
import * as signReleaseHap from "./signReleaseHap.js";

import * as validateReleaseDistroFilterTask from "./validateReleaseDistroFilterTask.js";
import * as packageReleaseApp from "./packageReleaseApp.js";
import * as signReleaseApp from "./signReleaseApp.js";

import * as validateUploadState from "./validateUploadState.js";
import * as zipSources from "./zipSources.js";

export const TASKS = [
  // release 链，13 步
  mergeReleaseResources,
  mergeReleaseProfile,
  generateReleaseJsManifest,
  compileReleaseJsWithNode,
  processReleaseProfile,
  compileReleaseResources,
  generateReleaseBinSource,
  processReleaseJavaRes,
  processReleaseLibsFile,
  generateReleaseJsBin,
  signReleaseJsBin,
  packageReleaseHap,
  signReleaseHap,

  // App 链，3 步
  validateReleaseDistroFilterTask,
  packageReleaseApp,
  signReleaseApp,

  // 源码上传链，2 步
  validateUploadState,
  zipSources
];

export function findTask(name) {
  return TASKS.find((t) => t.name === name) ?? null;
}

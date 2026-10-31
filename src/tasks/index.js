/**
 * 31 个任务按依赖顺序登记 —— 这个顺序就是未来 build.js 的执行顺序
 *
 * 顺序依据：doc/gradle-build-report.html 的 01 节（按依赖深度从小到大）。
 * 已移除 7 个空方法任务，它们 run() 里没有一条指令，不在链上。
 */

import * as mergeDebugResources from "./mergeDebugResources.js";
import * as mergeDebugProfile from "./mergeDebugProfile.js";
import * as generateDebugJsManifest from "./generateDebugJsManifest.js";
import * as compileDebugJsWithNode from "./compileDebugJsWithNode.js";
import * as processDebugProfile from "./processDebugProfile.js";
import * as compileDebugResources from "./compileDebugResources.js";
import * as generateDebugBinSource from "./generateDebugBinSource.js";
import * as processDebugJavaRes from "./processDebugJavaRes.js";
import * as processDebugLibsFile from "./processDebugLibsFile.js";
import * as generateDebugJsBin from "./generateDebugJsBin.js";
import * as signDebugJsBin from "./signDebugJsBin.js";
import * as packageDebugHap from "./packageDebugHap.js";
import * as signDebugHap from "./signDebugHap.js";

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
  // debug 链，13 步
  mergeDebugResources,
  mergeDebugProfile,
  generateDebugJsManifest,
  compileDebugJsWithNode,
  processDebugProfile,
  compileDebugResources,
  generateDebugBinSource,
  processDebugJavaRes,
  processDebugLibsFile,
  generateDebugJsBin,
  signDebugJsBin,
  packageDebugHap,
  signDebugHap,

  // release 链，13 步（与 debug 同构）
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

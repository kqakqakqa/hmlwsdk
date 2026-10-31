import * as debugTask from "./processDebugLibsFile.js";

/**
 * processReleaseLibsFile —— 收集 .so（release 变体）
 *
 * 与 debug 同一份实现。三路输入（HAR 库 / libs 目录 / CMake 产出）都扫，
 * 纯 JS 工程里一路都扫不到。
 */

export const name = "processReleaseLibsFile";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

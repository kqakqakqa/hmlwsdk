import * as debugTask from "./generateDebugJsManifest.js";

/**
 * generateReleaseJsManifest —— 给 webpack 准备组件清单（release 变体）
 *
 * 与 debug 同一份实现。manifest.json 的内容不区分变体，
 * 只有落盘路径里的 buildMode 目录名不同（js/release/ 而不是 js/debug/）。
 */

export const name = "generateReleaseJsManifest";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

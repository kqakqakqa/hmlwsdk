import * as debugTask from "./mergeDebugResources.js";

/**
 * mergeReleaseResources —— 生成资源目录清单（release 变体）
 *
 * 实测 release 与 debug 完全同构，实现只有一份：差异只在 ctx.variant，
 * 它决定索引文件写到 merge_res/release/ 而不是 merge_res/debug/。
 * 所以这里直接转发到 debug 那份实现，不复制代码。
 */

export const name = "mergeReleaseResources";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

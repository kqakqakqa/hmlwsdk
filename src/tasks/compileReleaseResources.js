import * as debugTask from "./compileDebugResources.js";

/**
 * compileReleaseResources —— 调 restool 编译资源（release 变体）
 *
 * 与 debug 同一份实现。restool 的参数不区分变体，只有输出目录名不同
 * （res/release/normal/lite 而不是 res/debug/normal/lite）。
 *
 * 未对照：_empty 只有 debug 的 res 产物。
 */

export const name = "compileReleaseResources";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

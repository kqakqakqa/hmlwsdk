import * as debugTask from "./generateDebugJsBin.js";

/**
 * generateReleaseJsBin —— 把 source/lite 压成 .bin（release 变体）
 *
 * 与 debug 同一份实现。序列化格式不区分变体，只有输入目录名和输出文件名不同。
 *
 * 未对照：_empty 没有 release 的 .bin 产物。
 * 另一份可对照的样本是 devdemo，它一次 release 构建同时出了 .bin 形态和文件树形态。
 */

export const name = "generateReleaseJsBin";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

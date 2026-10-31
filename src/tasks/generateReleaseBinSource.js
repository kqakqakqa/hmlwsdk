import * as debugTask from "./generateDebugBinSource.js";

/**
 * generateReleaseBinSource —— 组装 .bin 原料目录（release 变体）
 *
 * 与 debug 同一份实现。同样的最大缺口：config.json 那段能跑，
 * assets 复制那段还是 TODO。
 *
 * 未对照：_empty 没有 release 的 source 产物。
 */

export const name = "generateReleaseBinSource";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

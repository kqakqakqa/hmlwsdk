import * as debugTask from "./signDebugHap.js";

/**
 * signReleaseHap —— 给 hap 签名 + 写 hapInfo.json（release 变体）
 *
 * 与 debug 同一份实现。配了 signingConfigs 就真签，没配则跟 debug 一样不签。
 * hapInfo.json 的汇总逻辑不分变体。
 */

export const name = "signReleaseHap";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

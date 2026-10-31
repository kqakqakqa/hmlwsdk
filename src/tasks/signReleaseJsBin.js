import * as debugTask from "./signDebugJsBin.js";

/**
 * signReleaseJsBin —— 给 .bin 签名（release 变体）
 *
 * 与 debug 同一份实现。签名块的格式与变体无关，只看有没有配证书。
 * 签名格式详见 signDebugJsBin.js 的注释（proBlock / signBlock / CMS / signHead）。
 */

export const name = "signReleaseJsBin";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

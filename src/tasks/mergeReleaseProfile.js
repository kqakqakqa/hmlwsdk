import * as debugTask from "./mergeDebugProfile.js";

/**
 * mergeReleaseProfile —— config.json 第一阶段加工（release 变体）
 *
 * 与 debug 同一份实现。唯一差别：debug 变体会给 deviceConfig.default 加
 * debug:true，release 不会 —— 那个判断在实现里读的是 ctx.variant。
 *
 * 未对照：_empty 只有 debug 产物，release 的 merge_profile 没有样本可比。
 */

export const name = "mergeReleaseProfile";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

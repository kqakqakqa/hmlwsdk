import * as debugTask from "./processDebugProfile.js";

/**
 * processReleaseProfile —— config.json 第二阶段加工（release 变体）
 *
 * 与 debug 同一份实现。实测这步 Gradle 只调键顺序、不增删字段。
 *
 * 未对照：_empty 只有 debug 的 process_profile 产物。
 */

export const name = "processReleaseProfile";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

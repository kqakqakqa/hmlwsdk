import * as debugTask from "./processDebugJavaRes.js";

/**
 * processReleaseJavaRes —— 抽 jar 里的资源（release 变体）
 *
 * 与 debug 同一份实现。liteWearable 纯 JS 工程里两批 jar 都是空的，
 * 所以它每次都只是清空目录、复制 0 个文件。
 */

export const name = "processReleaseJavaRes";
export const produces = debugTask.produces;
export const run = debugTask.run;
export const verify = debugTask.verify;

import fs from "fs";
import path from "path";

import { compileJs } from "../js/aceLoader.js";
import { todo } from "./_util.js";

/**
 * compileReleaseJsWithNode —— node + webpack 编译（release 变体）
 *
 * 与 debug 的差异（依据 Gradle 行为）：
 *   1. webpack 换 mode production，产物被压缩
 *   2. sourcemap 不原地输出，改挪到 _releaseMap/ 目录
 *   3. 其余流程一致
 *
 * 所以这里不能像别的任务那样直接转发 debug 那份 —— buildMode 变了，
 * 产物的字节数也完全不同，没有 release 样本可对照。
 */

export const name = "compileReleaseJsWithNode";
export const produces = "js/release/source/lite/assets/js/<组件>/*.js|*.bc";

export function run(ctx) {
  if (!ctx.paths.jsManifest) todo(name, "缺少 jsManifest，必须先跑 generateReleaseJsManifest");

  const buildDir = path.join(ctx.work, "js", "release", "source", "lite");

  const r = compileJs({
    moduleRoot: path.join(ctx.moduleDir, "src", "main"),
    buildDir,
    manifestPath: ctx.paths.jsManifest,
    buildMode: "release",
    deviceType: "liteWearable",
    hapMode: true
  });

  if (!r.ok) {
    throw new Error(`${name} 失败（webpack 返回 ${r.code}）\n${(r.stdout ?? "").slice(-3000)}`);
  }

  // TODO sourcemap 挪到 _releaseMap/ 这一步没实现，也没验证过 webpack 侧到底输出到哪
  ctx.paths.jsBuild = buildDir;
  return buildDir;
}

export function verify() {
  return {
    ok: false,
    detail: "未对照：release 的 webpack 产物没有样本（_empty 只构建过 debug）"
  };
}

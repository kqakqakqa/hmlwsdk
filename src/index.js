/**
 * hmlwsdk —— 用纯 JS 替代 Gradle 的 liteWearable 出包链
 *
 * 已经用真实产物验证过的部分：
 *
 *   模块              验证方式                                      结果
 *   ─────────────────────────────────────────────────────────────────────
 *   bin 读写          4 个真实 .bin 解析后重建，比对 SHA256            字节级一致
 *   zip 读写          hap 打包后与 Gradle 产物对比                    条目内容一致
 *   config 加工       源码 → 加工 → 回填资源号                        三阶段内容一致
 *   资源编译          纯 JS 重写，对比 restool 1.022 的产物            index / R.txt 字节一致；
 *                                                                    png 像素一致（压缩改用
 *                                                                    node:zlib，字节差几 B）
 *   JS 编译           node + ace-loader 独立跑通                      COMPILE RESULT:SUCCESS
 *   .bin 签名         与 gradle 产物逐段对比                          proBlock/signBlock/
 *                                                                    econtent 头完全一致
 *   .app 签名         产出的包交给 hapsigntoolv2 的 verify             Verify success
 *
 * 资源编译（resources.index / R.txt / 图片压缩）不调 restool.exe，
 * 实现在 compileResources.js，格式来源见各模块注释。
 *
 * 图片转 .bin 不由本 SDK 负责 —— ace-loader 的 lite-image2bin.js 在 webpack 阶段
 * 顺手就做了，本 SDK 只负责删掉它留下的 xxx.png.bin 双后缀副本。
 */

// 整条链
export { build, TARGETS } from "./build.js";

// 工程与配置
export { readProject, readSdkVersions, readGradleVersions, BUILD_CONFIG_NAME } from "./readProject.js";
export { findProjectRoot, readProjectConfig, CONFIG_NAME } from "./readProjectConfig.js";
export { readSigningConfig, CERT_DIR, SIGNING_CONFIG_NAME } from "./readSigningConfig.js";
export { initProject, DEFAULT_SDK_DIR } from "./initProject.js";

// 容器格式
export {
  readBin,
  writeBin,
  isSignedBin,
  stripSignature,
  SIGN_HEAD_ASCII
} from "./readWriteBin.js";
export { readZip, writeZip, crc32 } from "./readWriteZip.js";
export { collectFiles, entryPath } from "./collectFiles.js";

// 打包
export { packBinHap, packTreeHap } from "./packHap.js";
export { packApp } from "./packApp.js";
export { signApp } from "./signApp.js";

// 配置
export { mergeProfile, stringifyConfig, stringifyConfigMinified } from "./processConfig.js";
export { parseRTable, fillResourceIds } from "./parseResourceTable.js";

// 资源
export { compileResources } from "./compileResources.js";
export { compressPng, isSupportedPng } from "./compressPng.js";

// JS
export { compileJs } from "./compileJs.js";
export { runWebpack } from "./runWebpack.js";

// 工具
export { resolveTools, resolveNode } from "./findTools.js";

// 签名
export { prepareSigning, signBin, signZip, parseP7b, parseP12, loadPrivateKey, slicedSha256 } from "./sign/index.js";

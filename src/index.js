/**
 * hmlwsdk —— 用纯 JS 替代 Gradle 的 liteWearable 出包链
 *
 * 已经用真实产物验证过的部分：
 *
 *   模块              验证方式                                      结果
 *   ─────────────────────────────────────────────────────────────────────
 *   bin 读写          4 个真实 .bin 解析后重建，比对 SHA256            字节级一致
 *   hap 打包/解包     两种形态（单 .bin / 文件树）往返               内容一致
 *   config 加工       源码 → merge → process → 回填资源号            三阶段内容一致
 *   资源编译          restool 对比 gradle 产物                        R.txt 字节一致
 *                                                                    index 仅版本号不同
 *   JS 编译           node + ace-loader 独立跑通                      COMPILE RESULT:SUCCESS
 *   .bin 签名         与 gradle 产物逐段对比                          proBlock/signBlock/
 *                                                                    econtent 头完全一致
 *   .app 签名         产出的包交给 hapsigntoolv2 的 verify             Verify success
 *
 * 还没做的：
 *   图片转 .bin       ace-loader 的 ImageCoverterPlugin 负责，目前靠它自带的
 */

export { findSdkRoot, resolveTools, resolveNode } from "./sdk.js";

export {
  readBin,
  writeBin,
  binToTree,
  isSignedBin,
  stripSignature,
  attachSignHeadTail,
  SIGN_HEAD_ASCII
} from "./bin/index.js";

export { packHap, unpackHap, hapForm } from "./hap/index.js";

export { readZip, writeZip, crc32 } from "./zip/index.js";

export { mergeProfile, processProfile, stringifyConfig } from "./config/profile.js";

export { parseRTable, fillResourceIds } from "./resources/rtable.js";

export { compileResources } from "./resources/restool.js";

export { compileJs } from "./js/aceLoader.js";

export { prepareSigning, signBin, signZip, parseP7b, loadPrivateKey, slicedSha256 } from "./sign/index.js";

import fs from "fs";

import { readZip, writeZip } from "./readWriteZip.js";
import { isSignedBin } from "./readWriteBin.js";
import { prepareSigning, signBin } from "./sign/index.js";
import { todo } from "./createTaskContext.js";

/**
 * signReleaseHap —— 出「里面那个 .bin 已经签好名」的 hap
 *
 * 与 Gradle 的差别是**故意的**：Gradle 的 signReleaseHap 除了保证 .bin 已签，
 * 还会往 hap 这个 zip 里插一个 "HAP Sig Block 42"（格式见 sign/zip.js，.app 用的
 * 是同一套）。实测 apps/_3rd/随机事件 的 debug 产物：
 *
 *   entry-bin-debug-lite-unsigned.hap   6906826 B   里面是 entry-debug-signed.bin
 *                                                   （6906662 B，已签）
 *   entry-bin-debug-lite-signed.hap     6913411 B   同一个 .bin，字节完全相同
 *
 * 差的 6585 B 全是那个 zip 签名块。本 SDK 不插它 —— 设备验的是 .bin 自己的签名块，
 * hap 只是装着 bin 的 zip。所以这里产出的 hap 与 Gradle 的 unsigned 那份逐条目相同，
 * 只是文件名换成 -signed。
 *
 * 输入取 paths.hap，也就是依赖链上一环 packageReleaseHap 产出的 .bin 形态 hap。
 * 里面那个 .bin 已带签名就直接复用，不重签 —— 构建链上 signReleaseJsBin 刚签过，
 * 复用的结果是本任务产出的 hap 里那份 .bin 与 bin/release/entry-release-signed.bin
 * 逐字节相同（实测），也就没有「签两遍、两份签名值不一样」的困扰。
 * 里面的 .bin 还没签（构建时没给 --p7b）才现签，没给 signingConfig 就报错。
 */

export const name = "signReleaseHap";
export const produces = "hap/release/entry-bin-release-lite-signed.hap";

export function run(taskContext) {
  const hapPath = taskContext.paths.hap;
  if (!hapPath) todo(name, "missing the .bin-form hap, run packageReleaseHap first");
  if (!fs.existsSync(hapPath)) todo(name, `hap not found: ${hapPath}`);

  // .bin 形态的 hap 里只有一条，就是那个 .bin（实测的两份 Gradle 产物都没有目录条目）
  const entries = readZip(fs.readFileSync(hapPath));
  const binEntry = entries.find((e) => e.name.endsWith(".bin"));
  if (!binEntry) todo(name, `${hapPath} has no .bin entry, this is not a .bin-form hap`);

  let binName = binEntry.name;
  let binBuf = binEntry.content;

  if (!isSignedBin(binBuf)) {
    if (!taskContext.signingConfig) todo(name, "the .bin inside the hap is not signed yet, pass --p7b to sign it");

    const signing = prepareSigning(taskContext.signingConfig);
    binBuf = signBin({
      unsignedBin: binBuf,
      p7b: signing.p7b,
      keyPem: signing.keyPem,
      certPems: signing.certPems,
      signTime: signing.signTime
    });

    // 签过的 .bin 在 hap 里的名字不带 -unsigned（实测 Gradle 是 entry-debug-signed.bin）
    binName = binName.replace(/-unsigned\.bin$/, "-signed.bin");
  }

  const out = hapPath.replace("-unsigned", "-signed");
  if (out === hapPath) todo(name, `${hapPath} has no "-unsigned" in its name, cannot derive the signed file name`);

  // stored 不压缩，与 Gradle 的 hap 一致（实测 method 全是 0）
  fs.writeFileSync(out, writeZip([{ name: binName, content: binBuf }], { compress: false }));

  taskContext.paths.signedHap = out;
  return out;
}

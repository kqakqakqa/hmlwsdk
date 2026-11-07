import fs from "fs";
import path from "path";

import { writeZip } from "./readWriteZip.js";

/**
 * 打 .app —— 把文件树形态的 hap 和 pack.info 装进一个 zip
 *
 * 实测产物（devdemo release，同一份源码）：
 *   build/outputs/app/release/
 *     devdemo-release-unsigned.app   188260 B
 *     pack.info                        1142 B   ← 同时打进 .app
 *     appInfo.json                      203 B   ← 中间文件，不进 .app
 *
 * .app 内部只有两个条目，都是 deflate 压缩（method=8）：
 *   entry-release-lite.hap   2304041 B   ← 注意去掉了 "-unsigned"
 *   pack.info                   1142 B
 *
 * 上面那个 hap 名是 Gradle 的产物名。本 SDK 传进来的是 `<bundleName>-<moduleName>.hap`，
 * pack.info 的 packages[].name 由它去后缀得来，所以两者始终一致。
 *
 * 过滤规则（PackageApp.getHapPathFiles）：
 *   非 .hap 的跳过；文件名含 "-bin-" 且 deviceType 含 liteWearable 的也跳过。
 *   所以 .bin 形态的 hap 进不了 .app，只有文件树形态进得去。
 *   实测印证：.app 里那份 hap 的字节数与 entry-release-lite-unsigned.hap 完全相同。
 */

/**
 * @param {object} opts
 * @param {string} opts.outDir       work/app
 * @param {string} opts.treeHapPath  文件树形态的 hap（.bin 形态的进不了 .app）
 * @param {object} opts.config       最终版 config
 * @returns {{appBuf:Buffer, appPath:string, packInfoPath:string}}
 */
export function packApp(opts) {
  const { outDir, hapBuf, hapName, config } = opts;

  fs.mkdirSync(outDir, { recursive: true });

  // pack.info 的 packages[].name —— 填的是 hap 文件名去掉 .hap（Gradle 实测是
  // entry-release-lite，也是这条规则）。
  // 轻量穿戴这套里只有两个名字：module 固定 entry（见 buildPackInfo 的 distro.moduleName），
  // bundle 就是 config 的 bundleName。这个字段两者都不是，它是 hap 自己的名字 ——
  // 只是因为我们的 hap 拿 bundleName 打，两者才恰好相同。
  const hapBaseName = hapName.replace(/\.hap$/, "");

  // pack.info：summary（来自 config）+ packages（来自 hap 文件名）
  const packInfoText = JSON.stringify(buildPackInfo(config, hapBaseName), null, 4);
  const packInfoPath = path.join(outDir, "pack.info");
  fs.writeFileSync(packInfoPath, packInfoText);

  // .app 本体：两个条目，都 deflate 压缩
  const appBuf = writeZip(
    [
      { name: hapName, content: hapBuf },
      { name: "pack.info", content: Buffer.from(packInfoText) }
    ],
    { compress: true }
  );

  // work/pack 下这份是副产物（真正交付的那份由 build.js 的 publish 写），
  // 沿用 hap 的名字 stem，不留 release / unsigned 这类变体词。
  const appPath = path.join(outDir, `${hapBaseName}.app`);
  fs.writeFileSync(appPath, appBuf);

  // appBuf 也返回：签名直接用它，不用把刚写下去的文件再读回来
  return { appBuf, appPath, packInfoPath };
}

/**
 * 从 config 拼出 pack.info
 *
 * 字段顺序照抄实测产物：deviceType → abilities → distro → apiVersion。
 * abilities 只保留 name 和 label，icon / type / homeAbility / iconId / labelId 都丢掉。
 *
 * @param {string} hapBaseName  packages[].name —— hap 文件名去掉 .hap
 */
function buildPackInfo(config, hapBaseName) {
  const m = config.module ?? {};
  const distro = m.distro ?? {};

  return {
    summary: {
      app: {
        bundleName: config.app.bundleName,
        version: config.app.version
      },
      modules: [
        {
          deviceType: m.deviceType ?? ["liteWearable"],
          abilities: (m.abilities ?? []).map((ab) => ({ name: ab.name, label: ab.label })),
          // 重新构造，不能直接引用 config 里的对象 —— 键序是固定的：
          //   distro     moduleType → deliveryWithInstall → moduleName
          //   apiVersion compatible → releaseType → target
          distro: {
            moduleType: distro.moduleType ?? "entry",
            deliveryWithInstall: distro.deliveryWithInstall ?? true,
            moduleName: distro.moduleName ?? "entry"
          },
          apiVersion: {
            compatible: config.app.apiVersion.compatible,
            releaseType: config.app.apiVersion.releaseType,
            target: config.app.apiVersion.target
          }
        }
      ]
    },
    packages: [
      {
        deviceType: m.deviceType ?? ["liteWearable"],
        moduleType: distro.moduleType ?? "entry",
        deliveryWithInstall: distro.deliveryWithInstall ?? true,
        name: hapBaseName
      }
    ]
  };
}

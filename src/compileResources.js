import fs from "fs";
import path from "path";

import { scanResourceFiles, listCopyOnlyFiles } from "./scanResourceFiles.js";
import { parseElementJson, composeStrings } from "./parseElementJson.js";
import { writeResourceIndex } from "./writeResourceIndex.js";
import { writeResourceTable } from "./writeResourceTable.js";
import { copyResourceFiles } from "./copyResourceFiles.js";

/**
 * 编译模块资源 —— 替代 restool.exe
 *
 * 产出（都在 outDir 下）：
 *   resources.index                      资源索引，见 writeResourceIndex.js
 *   R.txt                                资源 id 文本表，见 writeResourceTable.js
 *   resources/<限定>/media/…             图片（可压缩）+ 4 个空 .key
 *   resources/<限定>/profile/…           profile json 原样复制
 *   resources/rawfile/…                  rawfile 整棵复制
 *
 * 不产出 config.json。早先这里会写一份「回填过资源 id」的 config，理由是
 * 「让 res 目录结构跟构建产物对上」—— 但那份文件没有任何读者（真正打进包的那份
 * 由 assembleAssets 从 R.txt 重新回填后写到 source/config.json），已经删掉。
 *
 * 不产出 ResourceTable.java —— 那是给 Java 编译链用的，liteWearable 走 JS，
 * Gradle 的 lite 产物目录里也没有这个文件。
 *
 * ## id 分配
 *
 * 从 0x01000000 起，按「限定目录 → 资源簇 → (resType, 名称)」的顺序发号。
 * 为什么是这个顺序：restool 给每个 (限定目录, 资源簇) 组合建一个 compiler，
 * compiler 内部把资源按 (resType, 名称) 排进 map，编译完再统一发号。所以
 * element 里的资源先拿号、media 和 profile 后拿。
 *
 * 实测（probe 工程，element + media + profile 各有一点资源）：
 *   integer aa_int    0x1000000      ← element 内部按 resType 升序（integer=8 最前）
 *   integer zz_int    0x1000001
 *   string  aaa_first 0x1000002      ← string=9
 *   …
 *   float   zz_float  0x100000e      ← float=18
 *   media   icon      0x100000f      ← media 簇，只按名字排
 *   profile probe_profile 0x1000011  ← profile 簇最后
 *
 * 同一个资源名出现在多个限定目录（base / dark / zh_CN）时**共用一个 id**，
 * 在 index 里是每个限定目录各一条记录 —— 实测 probe2 的 appName 三条记录同 id
 * 0x1000000。
 */

/** app 资源的 id 起点。restool 的 IdWorker::Init 默认值就是它 */
const RES_ID_START = 0x01000000;

/**
 * @param {object} opts
 * @param {string} opts.moduleRoot 模块根目录（src/main）
 * @param {string} opts.outDir 输出目录，不存在会自动建
 * @param {string} [opts.rTxtPath] R.txt 写到哪，默认 outDir/R.txt。
 *   调 build.js 时会指到资源输出目录之外 —— R.txt 只用来回填 config 的资源 id，
 *   不进包，混在产物树里会被打进 .bin
 * @param {string} [opts.moduleName] 模块名，也就是 index 里资源路径的第一段，默认 entry
 * @param {boolean} [opts.compressImage] 是否压缩图片（原来的 -z），默认 true
 * @param {boolean} [opts.force] 输出目录下已有 resources 时是否覆盖，默认 true
 * @returns {{indexFile:string, rTxtFile:string, stats:object}}
 */
export function compileResources(opts) {
  const outDir = opts.outDir;
  const moduleName = opts.moduleName ?? "entry";
  fs.mkdirSync(outDir, { recursive: true });

  const outResources = path.join(outDir, "resources");
  if (fs.existsSync(outResources) && opts.force !== false) {
    fs.rmSync(outResources, { recursive: true, force: true });
  }

  const scanned = scanResourceFiles(opts.moduleRoot);

  // ── 第一遍：收集资源项并按 restool 的顺序发 id ──
  const idTable = new Map(); // "resType:name" → { id, resType, typeName, name }
  const byLimitKey = new Map();
  let nextId = RES_ID_START;

  for (const config of scanned) {
    const bucket = [];
    byLimitKey.set(config.limitKey, bucket);

    for (const cluster of config.clusters) {
      const items = collectClusterItems(config, cluster, moduleName);
      items.sort(byResTypeThenName);
      assertNoDuplicate(config.limitKey, cluster.cluster, items);

      for (const item of items) {
        const key = item.resType + ":" + item.name;
        if (!idTable.has(key)) {
          idTable.set(key, { id: nextId++, resType: item.resType, typeName: item.typeName, name: item.name });
        }
        item.id = idTable.get(key).id;
        bucket.push(item);
      }
    }
  }

  // ── 第二遍：写 resources.index ──
  const indexConfigs = scanned.map((config) => ({
    keyParams: config.keyParams,
    // 组内按 id 升序，和 restool 的 map<int64_t, ...> 遍历顺序一致
    items: byLimitKey.get(config.limitKey).sort((a, b) => a.id - b.id)
  }));

  const indexFile = path.join(outDir, "resources.index");
  fs.writeFileSync(indexFile, writeResourceIndex(indexConfigs));

  // ── R.txt：同 id 的多份记录只写一行（跨限定目录视为同一个资源） ──
  // 默认写在 outDir 里；build.js 会把它指到外面去，因为它不进包
  const rTxtFile = opts.rTxtPath ?? path.join(outDir, "R.txt");
  fs.mkdirSync(path.dirname(rTxtFile), { recursive: true });
  fs.writeFileSync(rTxtFile, writeResourceTable([...idTable.values()]), "utf8");

  // ── 文件型资源落盘 ──
  const stats = copyResourceFiles({
    outDir,
    configs: scanned,
    copyOnly: listCopyOnlyFiles(opts.moduleRoot),
    compressImage: opts.compressImage !== false
  });

  return { indexFile, rTxtFile, stats };
}

/**
 * 收集一个 (限定目录, 资源簇) 下的资源项
 * 每条都带 resType / typeName / name / data，data 就是写进 index 的那串字节
 */
function collectClusterItems(config, cluster, moduleName) {
  if (cluster.cluster === "element") {
    return cluster.files.flatMap((filePath) => {
      const items = parseElementJson(filePath);
      // element 里的资源名由 json 决定，配置组信息要补上
      return items.map((item) => ({ ...item, limitKey: config.limitKey }));
    });
  }

  // media / profile：一个文件一个资源，名字去掉扩展名，路径写进 index
  return cluster.files.map((filePath) => {
    const filename = path.basename(filePath);
    const name = stripExtension(filename);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `${cluster.cluster} file name "${filename}" is not a valid resource name once the extension is dropped` +
          ` (letters, digits and underscores only, cannot start with a digit)`
      );
    }
    // 记录里存的是「模块名/资源簇/文件名」这样的相对路径，设备端按它去找资源
    const pathText = `${moduleName}/resources/${config.limitKey}/${cluster.cluster}/${filename}`;
    return {
      resType: cluster.dirType,
      typeName: cluster.cluster,
      name,
      data: composeStrings([pathText, name], true),
      limitKey: config.limitKey
    };
  });
}

function stripExtension(filename) {
  const i = filename.lastIndexOf(".");
  return i <= 0 ? filename : filename.slice(0, i);
}

/** id 分配顺序里「类型在前、名字在后」，都用字节序比较，跟 C++ 的 std::string 一致 */
function byResTypeThenName(a, b) {
  if (a.resType !== b.resType) return a.resType - b.resType;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

function assertNoDuplicate(limitKey, clusterName, items) {
  const seen = new Set();
  for (const item of items) {
    const key = item.resType + ":" + item.name;
    if (seen.has(key)) {
      throw new Error(`duplicate resource "${item.name}" in ${limitKey}/${clusterName} (one resource per name and type in a config group)`);
    }
    seen.add(key);
  }
}

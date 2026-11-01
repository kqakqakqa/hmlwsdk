import fs from "fs";
import path from "path";

/**
 * 扫描模块的 resources 目录，整理出「有哪些配置组、每组下面有哪些资源文件」
 *
 * 对应 restool 的 ResourceDirectory::ScanResources + FileManager。
 *
 * 目录形状（实测所有真实工程都是这个形状，只有 base 一层）：
 *
 *   resources/
 *     base/                    ← 目录名就是 limitKey，base 表示无任何限定
 *       element/               ← 资源簇，里面是 *.json
 *       media/                 ← 资源簇，里面是图片
 *       profile/               ← 资源簇，里面是会被原样复制的 json
 *     zh_CN/                   ← 带限定的配置组，目录名用 - 连接多个限定
 *       element/
 *     rawfile/                 ← 原样复制，不进 resources.index
 *
 * 只有 element / media / profile 三个簇会被编译，别的名字直接报错 —— 这是
 * restool 的行为（g_fileClusterMap），不是我们简化。
 *
 * 目录遍历顺序会影响 id 分配顺序，这里统一按名字排序。restool 在 Windows 上
 * 用的是 FindFirstFile，拿到的是 NTFS 的名字序，实测和字典序一致（probe 工程
 * 里 element/media/profile 的 id 就是按这个顺序排的）。
 */

/** resources 下一层会被整棵复制、不参与编译的目录 */
const COPY_ONLY_DIRS = new Set(["rawfile", "resfile"]);

/** 资源簇目录名 → ResType。element 是容器，具体类型看 json 的根键 */
export const CLUSTER_TYPES = {
  element: 0,
  media: 19,
  profile: 20
};

/**
 * restool 的默认忽略规则（ResourceUtil::DEFAULT_IGNORE_FILE_REGEX）
 * 文件名先转小写再匹配，所以这里都写小写。规则对文件和目录都生效。
 */
const IGNORE_PATTERNS = [
  /\.git$/,
  /\.svn$/,
  /\.scc$/,
  /^\.ds_store$/,
  /^desktop\.ini$/,
  /^picasa\.ini$/,
  /^\..+$/,
  /^cvs$/,
  /^thumbs\.db$/,
  /.+~$/
];

const KEY_TYPE = {
  LANGUAGE: 0,
  REGION: 1,
  RESOLUTION: 2,
  ORIENTATION: 3,
  DEVICETYPE: 4,
  SCRIPT: 5,
  NIGHTMODE: 6,
  MCC: 7,
  MNC: 8,
  INPUTDEVICE: 10
};

const DEVICE = { phone: 0, tablet: 1, car: 2, tv: 4, wearable: 6, "2in1": 7 };
const ORIENTATION = { vertical: 0, horizontal: 1 };
const NIGHT_MODE = { dark: 0, light: 1 };
const INPUT_DEVICE = { pointingdevice: 0 };
const RESOLUTION = { sdpi: 120, mdpi: 160, ldpi: 240, xldpi: 320, xxldpi: 480, xxxldpi: 640 };

/**
 * @param {string} moduleRoot 模块根目录（src/main），resources 在它下面
 * @returns {Array<{limitKey:string, keyParams:Array<{keyType:number,value:number}>,
 *                  clusters:Array<{cluster:string, dirType:number, dirPath:string, files:string[]}>}>}
 */
export function scanResourceFiles(moduleRoot) {
  const resourcesDir = path.join(moduleRoot, "resources");
  if (!fs.existsSync(resourcesDir)) return [];

  const configs = [];
  for (const entry of listDir(resourcesDir)) {
    if (COPY_ONLY_DIRS.has(entry.name)) continue;
    if (!entry.isDirectory) {
      throw new Error(`resources 下只能放目录，实际是文件: ${entry.name}`);
    }

    const limitKey = entry.name;
    const keyParams = parseLimitKey(limitKey);
    if (keyParams === null) {
      throw new Error(`无法识别的限定目录名: ${limitKey}`);
    }

    const clusters = [];
    for (const clusterDir of listDir(path.join(resourcesDir, limitKey))) {
      if (!clusterDir.isDirectory) {
        throw new Error(`${limitKey} 下只能放资源簇目录，实际是文件: ${clusterDir.name}`);
      }
      const dirType = CLUSTER_TYPES[clusterDir.name];
      if (dirType === undefined) {
        throw new Error(
          `无法识别的资源簇目录: ${limitKey}/${clusterDir.name}（只认 ${Object.keys(CLUSTER_TYPES).join(" / ")}）`
        );
      }

      const dirPath = path.join(resourcesDir, limitKey, clusterDir.name);
      const files = [];
      for (const f of listDir(dirPath)) {
        if (isIgnored(f.name)) continue;
        // restool 对资源簇里的子目录直接报 "not a file"，不递归
        if (f.isDirectory) {
          throw new Error(`${limitKey}/${clusterDir.name} 下不能再有子目录，实际有: ${f.name}`);
        }
        files.push(path.join(dirPath, f.name));
      }
      files.sort();

      clusters.push({ cluster: clusterDir.name, dirType, dirPath, files });
    }

    // 簇的遍历顺序就是 id 分配顺序，按名字排（element < media < profile）
    clusters.sort((a, b) => (a.cluster < b.cluster ? -1 : a.cluster > b.cluster ? 1 : 0));
    configs.push({ limitKey, keyParams, clusters });
  }

  configs.sort((a, b) => (a.limitKey < b.limitKey ? -1 : a.limitKey > b.limitKey ? 1 : 0));
  return configs;
}

/** rawfile / resfile 的复制清单：{ 相对路径 → 绝对路径 }，保持目录层级 */
export function listCopyOnlyFiles(moduleRoot) {
  const resourcesDir = path.join(moduleRoot, "resources");
  const out = [];
  for (const name of COPY_ONLY_DIRS) {
    const dir = path.join(resourcesDir, name);
    if (!fs.existsSync(dir)) continue;
    walk(dir, name, out);
  }
  return out;
}

function walk(dir, rel, out) {
  for (const entry of listDir(dir)) {
    if (isIgnored(entry.name)) continue;
    const relChild = rel + "/" + entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory) walk(abs, relChild, out);
    else out.push({ relPath: relChild, filePath: abs });
  }
}

function listDir(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function isIgnored(name) {
  const lower = name.toLowerCase();
  return IGNORE_PATTERNS.some((re) => re.test(lower));
}

/**
 * 目录名 → 限定参数列表，对应 restool 的 KeyParser::Parse
 *
 * 规则（源码 key_parser.cpp）：名字按 "-" 切段，每段依次尝试
 * mccmnc → 语言/地区 → 方向 → 机型 → 明暗 → 输入设备 → 分辨率，
 * 匹配过的解析器下标不回退。所以段的顺序是固定的，"dark-zh_CN" 这种倒着写会报错。
 *
 * @returns {Array<{keyType:number,value:number}>|null} null 表示目录名不合法
 */
export function parseLimitKey(limitKey) {
  if (limitKey === "base") return [];

  const out = [];
  const parsers = [parseMccMnc, parseLocale, parseOrientation, parseDevice, parseNightMode, parseInputDevice, parseResolution];

  let next = 0;
  for (const part of limitKey.split("-")) {
    let matched = false;
    for (let i = next; i < parsers.length; i++) {
      if (parsers[i](part, out)) {
        matched = true;
        next = i;
        break;
      }
    }
    if (!matched) return null;
  }
  return out;
}

function parseMccMnc(part, out) {
  const pieces = part.split("_");
  if (pieces.length > 2) return false;
  const types = [KEY_TYPE.MCC, KEY_TYPE.MNC];
  const patterns = [/^mcc(\d{3})$/, /^mnc(\d{2,3})$/];

  for (let i = 0; i < pieces.length; i++) {
    const m = pieces[i].match(patterns[i]);
    if (!m) return false;
    out.push({ keyType: types[i], value: parseInt(m[1], 10) });
  }
  return true;
}

function parseLocale(part, out) {
  const pieces = part.split("_");
  if (pieces.length > 3) return false;

  // 源码里 founctionModels 是 map<string, vector>，按 key 字典序遍历，
  // 所以顺序是 all(语言_脚本_地区) → language region → language script
  const models = [
    [parseLanguage, parseScript, parseRegion],
    [parseLanguage, parseRegion],
    [parseLanguage, parseScript]
  ];

  for (const model of models) {
    const tmp = [];
    let ok = true;
    for (let i = 0; i < pieces.length; i++) {
      if (!model[i](pieces[i], tmp)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      out.push(...tmp);
      return true;
    }
  }
  return false;
}

function parseLanguage(part, out) {
  // "car" 这种机型名也是 3 个小写字母，源码先排除机型再认语言
  if (DEVICE[part] !== undefined) return false;
  if (!/^[a-z]{2,3}$/.test(part)) return false;
  out.push(pushLocaleValue(part, KEY_TYPE.LANGUAGE));
  return true;
}

function parseScript(part, out) {
  if (part.length !== 4 || !/^[A-Z][a-z]{3}$/.test(part)) return false;
  out.push(pushLocaleValue(part, KEY_TYPE.SCRIPT));
  return true;
}

function parseRegion(part, out) {
  if (part.length < 2 || part.length > 3) return false;
  if (!/^[0-9]{3}$/.test(part) && !/^[A-Z]{2,3}$/.test(part)) return false;
  out.push(pushLocaleValue(part, KEY_TYPE.REGION));
  return true;
}

/** 语言/脚本/地区是把字符串按字节大端塞进 u32，实测 zh_CN → 0x7A68 / 0x434E */
function pushLocaleValue(text, keyType) {
  let value = 0;
  for (const ch of Buffer.from(text, "latin1")) value = ((value << 8) | ch) >>> 0;
  return { keyType, value };
}

function parseOrientation(part, out) {
  if (ORIENTATION[part] === undefined) return false;
  out.push({ keyType: KEY_TYPE.ORIENTATION, value: ORIENTATION[part] });
  return true;
}

function parseDevice(part, out) {
  if (DEVICE[part] === undefined) return false;
  out.push({ keyType: KEY_TYPE.DEVICETYPE, value: DEVICE[part] });
  return true;
}

function parseNightMode(part, out) {
  if (NIGHT_MODE[part] === undefined) return false;
  out.push({ keyType: KEY_TYPE.NIGHTMODE, value: NIGHT_MODE[part] });
  return true;
}

function parseInputDevice(part, out) {
  if (INPUT_DEVICE[part] === undefined) return false;
  out.push({ keyType: KEY_TYPE.INPUTDEVICE, value: INPUT_DEVICE[part] });
  return true;
}

function parseResolution(part, out) {
  if (RESOLUTION[part] === undefined) return false;
  out.push({ keyType: KEY_TYPE.RESOLUTION, value: RESOLUTION[part] });
  return true;
}

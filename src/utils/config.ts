import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenCodeConfig } from "../types";

/**
 * Menghapus komentar `//` dan `/* *\/` dari string JSONC secara presisi.
 */
export function stripComments(content: string): string {
  let result = "";
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1] || "";

    // Handle block comment end
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }

    // Handle line comment end
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    // Handle strings (ignore comment characters inside strings)
    if (inString) {
      result += char;
      // Handle escaped characters inside string
      if (char === "\\") {
        if (nextChar) {
          result += nextChar;
          i++;
        }
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    // Detect comment start or string start
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      result += char;
    } else if (char === "/" && nextChar === "/") {
      inLineComment = true;
      i++; // skip next '/'
    } else if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++; // skip next '*'
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Resolver path config opencode (cek variabel lingkungan OPENCODE_CONFIG_DIR,
 * ~/.opencode/opencode.jsonc, ~/.config/opencode/opencode.jsonc,
 * $CWD/opencode.jsonc, .opencode/opencode.jsonc).
 */
export function findOpenCodeConfigPath(projectPath?: string): string | null {
  const homeDir = os.homedir();
  const cwd = projectPath || process.cwd();

  const pathsToCheck: string[] = [];

  // 1. OPENCODE_CONFIG_DIR
  if (process.env.OPENCODE_CONFIG_DIR) {
    pathsToCheck.push(path.join(process.env.OPENCODE_CONFIG_DIR, "opencode.jsonc"));
    pathsToCheck.push(path.join(process.env.OPENCODE_CONFIG_DIR, "opencode.json"));
  }

  // 2. ~/.opencode/opencode.jsonc (atau .json)
  pathsToCheck.push(path.join(homeDir, ".opencode", "opencode.jsonc"));
  pathsToCheck.push(path.join(homeDir, ".opencode", "opencode.json"));

  // 3. ~/.config/opencode/opencode.jsonc (atau .json)
  pathsToCheck.push(path.join(homeDir, ".config", "opencode", "opencode.jsonc"));
  pathsToCheck.push(path.join(homeDir, ".config", "opencode", "opencode.json"));

  // 4. $CWD/opencode.jsonc (atau .json)
  pathsToCheck.push(path.join(cwd, "opencode.jsonc"));
  pathsToCheck.push(path.join(cwd, "opencode.json"));

  // 5. $CWD/.opencode/opencode.jsonc (atau .json)
  pathsToCheck.push(path.join(cwd, ".opencode", "opencode.jsonc"));
  pathsToCheck.push(path.join(cwd, ".opencode", "opencode.json"));

  for (const configPath of pathsToCheck) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Membaca & parse JSONC secara aman (gunakan stripComments sebelum JSON.parse).
 */
export function readOpenCodeConfig(configPath: string): OpenCodeConfig | null {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const rawContent = fs.readFileSync(configPath, "utf8");
    const stripped = stripComments(rawContent);
    return JSON.parse(stripped) as OpenCodeConfig;
  } catch (error) {
    return null;
  }
}

/**
 * Menulis kembali file config ke filesystem secara aman.
 */
export function writeOpenCodeConfig(configPath: string, config: OpenCodeConfig): boolean {
  try {
    const parentDir = path.dirname(configPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, content, "utf8");
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Mengubah value field secara immutable (return new copy).
 * fieldPath menggunakan notasi titik seperti "compaction.enabled" atau "agents.0.name"
 */
export function updateConfigField<T extends Record<string, any>>(
  config: T,
  fieldPath: string,
  value: unknown
): T {
  const parts = fieldPath.split(".");
  
  const setImmutable = (obj: any, pathParts: string[], val: unknown): any => {
    if (pathParts.length === 0) {
      return val;
    }
    
    const [currentKey, ...restOfParts] = pathParts;
    
    // Check if current level is an array index or object key
    if (Array.isArray(obj)) {
      const index = parseInt(currentKey, 10);
      const newArray = [...obj];
      if (isNaN(index)) {
        // Not a number, treat as property of the array object if necessary,
        // but typically it should be an index.
        return obj;
      }
      newArray[index] = setImmutable(newArray[index], restOfParts, val);
      return newArray;
    } else {
      const newObj = { ...obj };
      newObj[currentKey] = setImmutable(newObj[currentKey] || {}, restOfParts, val);
      return newObj;
    }
  };

  return setImmutable(config, parts, value);
}

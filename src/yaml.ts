/**
 * Minimal YAML parser — handles the subset needed for agentfile config.
 * Supports: strings, numbers, booleans, null, simple objects, arrays, nested objects.
 * Does NOT support: anchors, aliases, multi-line strings, flow sequences in complex cases.
 *
 * Also includes a YAML serializer for writing managed.yaml and snapshots.
 */

export function parseYaml(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return parseObject(lines, 0, 0).value as Record<string, unknown>;
}

interface ParseResult {
  value: unknown;
  nextLine: number;
}

function getIndent(line: string): number {
  const match = line.match(/^( *)/);
  return match ? match[1].length : 0;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function parseScalar(raw: string): string | number | boolean | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10);
  }

  // JSON inline (for arrays like ["a", "b"])
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function parseObject(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    if (isBlankOrComment(lines[i])) {
      i++;
      continue;
    }

    const indent = getIndent(lines[i]);
    if (indent < baseIndent) break;
    if (indent > baseIndent) break; // Shouldn't happen at this level

    const line = lines[i].trim();

    // Key-value line
    const kvMatch = line.match(/^([^:]+?):\s*(.*)/);
    if (!kvMatch) {
      i++;
      continue;
    }

    const key = kvMatch[1].trim();
    const rest = kvMatch[2].trim();

    if (rest === '' || rest === '|') {
      // Check if next non-blank line is indented more (nested object or array)
      let nextContentLine = i + 1;
      while (nextContentLine < lines.length && isBlankOrComment(lines[nextContentLine])) {
        nextContentLine++;
      }

      if (nextContentLine < lines.length) {
        const nextIndent = getIndent(lines[nextContentLine]);
        if (nextIndent > indent) {
          const nextTrimmed = lines[nextContentLine].trim();
          if (nextTrimmed.startsWith('- ')) {
            // Array
            const result = parseArray(lines, nextContentLine, nextIndent);
            obj[key] = result.value;
            i = result.nextLine;
          } else if (rest === '|') {
            // Multi-line string
            const result = parseBlockScalar(lines, nextContentLine, nextIndent);
            obj[key] = result.value;
            i = result.nextLine;
          } else {
            // Nested object
            const result = parseObject(lines, nextContentLine, nextIndent);
            obj[key] = result.value;
            i = result.nextLine;
          }
        } else {
          obj[key] = null;
          i++;
        }
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: obj, nextLine: i };
}

function parseArray(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = startLine;

  while (i < lines.length) {
    if (isBlankOrComment(lines[i])) {
      i++;
      continue;
    }

    const indent = getIndent(lines[i]);
    if (indent < baseIndent) break;

    const line = lines[i].trim();
    if (!line.startsWith('- ')) break;

    const itemContent = line.slice(2).trim();

    // Check if item is a key-value (object in array)
    const kvMatch = itemContent.match(/^([^:]+?):\s*(.*)/);
    if (kvMatch) {
      // Object item — collect all sub-keys at deeper indent
      const itemObj: Record<string, unknown> = {};
      const firstKey = kvMatch[1].trim();
      const firstVal = kvMatch[2].trim();
      itemObj[firstKey] = parseScalar(firstVal);

      const subIndent = indent + 2; // after "- "
      i++;

      while (i < lines.length) {
        if (isBlankOrComment(lines[i])) {
          i++;
          continue;
        }
        const si = getIndent(lines[i]);
        if (si < subIndent) break;
        if (si === subIndent || si >= subIndent) {
          const subLine = lines[i].trim();
          const subKv = subLine.match(/^([^:]+?):\s*(.*)/);
          if (subKv) {
            const subKey = subKv[1].trim();
            const subRest = subKv[2].trim();
            if (subRest === '' || subRest === '|') {
              // Check for nested content
              let nextContentLine = i + 1;
              while (nextContentLine < lines.length && isBlankOrComment(lines[nextContentLine])) {
                nextContentLine++;
              }
              if (nextContentLine < lines.length && getIndent(lines[nextContentLine]) > si) {
                if (subRest === '|') {
                  const result = parseBlockScalar(lines, nextContentLine, getIndent(lines[nextContentLine]));
                  itemObj[subKey] = result.value;
                  i = result.nextLine;
                } else {
                  const nextTrimmed = lines[nextContentLine].trim();
                  if (nextTrimmed.startsWith('- ')) {
                    const result = parseArray(lines, nextContentLine, getIndent(lines[nextContentLine]));
                    itemObj[subKey] = result.value;
                    i = result.nextLine;
                  } else {
                    const result = parseObject(lines, nextContentLine, getIndent(lines[nextContentLine]));
                    itemObj[subKey] = result.value;
                    i = result.nextLine;
                  }
                }
              } else {
                itemObj[subKey] = null;
                i++;
              }
            } else {
              itemObj[subKey] = parseScalar(subRest);
              i++;
            }
          } else {
            i++;
          }
        } else {
          break;
        }
      }

      arr.push(itemObj);
    } else {
      // Simple scalar item
      arr.push(parseScalar(itemContent));
      i++;
    }
  }

  return { value: arr, nextLine: i };
}

function parseBlockScalar(lines: string[], startLine: number, baseIndent: number): ParseResult {
  const parts: string[] = [];
  let i = startLine;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      parts.push('');
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < baseIndent) break;
    parts.push(line.slice(baseIndent));
    i++;
  }

  // Remove trailing empty lines
  while (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }

  return { value: parts.join('\n'), nextLine: i };
}

/**
 * Serialize a JavaScript object to YAML string.
 */
export function toYaml(obj: unknown, indent: number = 0): string {
  const pad = ' '.repeat(indent);

  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj.toString();
  if (typeof obj === 'number') return obj.toString();
  if (typeof obj === 'string') {
    if (obj.includes('\n')) {
      const lines = obj.split('\n');
      return '|\n' + lines.map(l => pad + '  ' + l).join('\n');
    }
    if (obj === '' || obj.includes(':') || obj.includes('#') || obj.includes('"') ||
        obj.startsWith(' ') || obj.endsWith(' ') || /^[\d.]+$/.test(obj) ||
        obj === 'true' || obj === 'false' || obj === 'null') {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    // Check if simple array (all scalars)
    const allScalar = obj.every(item =>
      item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    );
    if (allScalar) {
      return JSON.stringify(obj);
    }
    // Complex array
    const lines: string[] = [];
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0];
          const firstValStr = toYaml(firstVal, indent + 2);
          lines.push(`${pad}- ${firstKey}: ${firstValStr}`);
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i];
            const valStr = toYaml(v, indent + 2);
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              lines.push(`${pad}  ${k}:`);
              const nested = toYaml(v, indent + 4);
              lines.push(nested);
            } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
              lines.push(`${pad}  ${k}:`);
              const nested = toYaml(v, indent + 4);
              lines.push(nested);
            } else {
              lines.push(`${pad}  ${k}: ${valStr}`);
            }
          }
        }
      } else {
        lines.push(`${pad}- ${toYaml(item, indent + 2)}`);
      }
    }
    return lines.join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines: string[] = [];
    for (const [key, val] of entries) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        lines.push(`${pad}${key}:`);
        lines.push(toYaml(val, indent + 2));
      } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        lines.push(`${pad}${key}:`);
        lines.push(toYaml(val, indent + 2));
      } else {
        lines.push(`${pad}${key}: ${toYaml(val, indent + 2)}`);
      }
    }
    return lines.join('\n');
  }

  return String(obj);
}

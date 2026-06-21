import { stripComments } from './comments'
import { parseStructure } from './structure'
import { foldFile } from './block'
import { transform } from './transform'
import type { ProjectFile } from './ast'

/** parser 总入口：pass 0（去注释）→ pass 1（结构）→ pass 2（折叠）→ pass 3（行内）。 */
export function parse(text: string, path: string): ProjectFile {
  const stripped = stripComments(text, path)
  const skeleton = parseStructure(stripped, path)
  const rawFile = foldFile(skeleton)
  return transform(rawFile)
}

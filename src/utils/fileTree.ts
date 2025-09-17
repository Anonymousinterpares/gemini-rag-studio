import { AppFile, FileTree } from '../types'

export const buildFileTree = (files: AppFile[]): FileTree => {
  console.log('[DEBUG] buildFileTree received files:', files);
  const tree: FileTree = {}
  files.forEach((file) => {
    const parts = file.path.split('/').filter((p) => p)
    let currentLevel = tree
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        currentLevel[part] = file
      } else {
        if (
          !currentLevel[part] ||
          (currentLevel[part] as AppFile).content !== undefined
        ) {
          currentLevel[part] = {}
        }
        currentLevel = currentLevel[part] as FileTree
      }
    })
  })
  console.log('[DEBUG] buildFileTree generated tree:', tree);
  return tree
}
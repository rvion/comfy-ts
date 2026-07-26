import { pythonModuleToPrefix } from 'src/sdk-generator/_pythonModuleToNamespace.ts'

export const toQualifiedNodeKey = (pythonModule: string, nameInComfy: string): string => {
   return `${pythonModuleToPrefix(pythonModule)}${nameInComfy}`
}

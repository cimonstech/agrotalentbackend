import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full)
    else if (ent.name.endsWith('.js')) {
      const tsPath = full.slice(0, -3) + '.ts'
      fs.copyFileSync(full, tsPath)
      fs.unlinkSync(full)
    }
  }
}

walk(srcDir)
console.log('Converted .js to .ts under src/')

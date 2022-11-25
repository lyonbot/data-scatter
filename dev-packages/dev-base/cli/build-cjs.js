const fs = require('fs-extra');
const path = require('path');
const esbuild = require('esbuild');

async function main() {
  let [, executable, inputFile, outputFile] = process.argv

  if (!inputFile || !outputFile) {
    console.error(`Usage: ${executable} inputDir outputDir`)
    process.exit(1)
  }

  inputFile = path.join(process.cwd(), inputFile)
  outputFile = path.join(process.cwd(), outputFile)
  const packageJSON = await fs.readJson(path.join(process.cwd(), 'package.json'))

  await fs.emptyDir(path.dirname(outputFile))
  await esbuild.build({
    outfile: outputFile,
    bundle: true,
    minify: true,
    platform: 'node',
    external: Object.keys(packageJSON.dependencies || {}),
    entryPoints: [inputFile]
  })

  // for (const fileName of glob.sync('**/*.js', { cwd: inputDir })) {
  //   const inputPath = path.join(inputDir, fileName)
  //   const outputPath = path.join(outputDir, fileName)

  //   const out = await swc.transformFile(inputPath, { swcrc: false })
  //   console.log(out)
  //   break
  // }

}
main().catch(err => { console.error(err); process.exit(1); })

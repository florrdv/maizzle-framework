const path = require('path')
const fs = require('fs-extra')
const glob = require('glob-promise')
const {get, isEmpty} = require('lodash')
const {merge} = require('../../utils/helpers')

const Config = require('../config')
const Tailwind = require('../tailwindcss')
const Plaintext = require('../plaintext')

const render = require('./to-string')

module.exports = async (env, config) => {
  process.env.NODE_ENV = env || 'local'

  if (isEmpty(config)) {
    config = await Config.getMerged(env).catch(error => {
      throw error
    })
  }

  const buildTemplates = get(config, 'build.templates')
  const templatesConfig = Array.isArray(buildTemplates) ? buildTemplates : [buildTemplates]

  const parsed = []
  let files = []
  const compiled = {}

  const css = (typeof get(config, 'build.tailwind.compiled') === 'string')
    ? config.build.tailwind.compiled
    : await Tailwind.compile({config})

  // Parse each template config object
  for await (const templateConfig of templatesConfig) {
    if (!templateConfig) {
      const configFileName = env === 'local' ? 'config.js' : `config.${env}.js`
      throw new Error(`No template sources defined in \`build.templates\`, check your ${configFileName} file`)
    }

    const outputDir = get(templateConfig, 'destination.path', `build_${env}`)

    await fs.remove(outputDir)

    /**
     * Get all files in the template config's source directory
     * Supports `source` defined as:
     * - string
     * - array of strings
     * - function that returns either of the above
     *
     *  */
    const templateSource = []
    const templateTypeErrorMessage = 'Invalid template source: expected string or array of strings, got '

    if (typeof templateConfig.source === 'function') {
      const sources = templateConfig.source(config)

      if (Array.isArray(sources)) {
        templateSource.push(...sources)
      } else if (typeof sources === 'string') {
        templateSource.push(sources)
      } else {
        throw new TypeError(templateTypeErrorMessage + typeof sources)
      }
    } else {
      if (Array.isArray(templateConfig.source)) {
        templateSource.push(...templateConfig.source)
      } else if (typeof templateConfig.source === 'string') {
        templateSource.push(templateConfig.source)
      } else {
        throw new TypeError(templateTypeErrorMessage + typeof templateConfig.source)
      }
    }

    // Create a pipe-delimited list of allowed extensions
    // We only compile these, the rest are copied as-is
    const extensions = Array.isArray(templateConfig.filetypes)
      ? templateConfig.filetypes.join('|')
      : templateConfig.filetypes || get(templateConfig, 'filetypes', 'html')

    // List of files that won't be copied to the output directory
    const omitted = Array.isArray(templateConfig.omit)
      ? templateConfig.omit
      : [get(templateConfig, 'omit', '')]

    // Parse each template source
    for await (const source of templateSource) {
      /**
       * Copy single-file sources correctly
       * If `src` is a file, `dest` cannot be a directory
       * https://github.com/jprichardson/node-fs-extra/issues/323
       */

      const isFile = fs.statSync(source).isFile
      const allSourceFiles = isFile ? [source] : await glob(`${path.basename(source)}/**/*.+(${extensions})`)

      const skipped = Array.isArray(templateConfig.skip) ?
        templateConfig.skip :
        [get(templateConfig, 'skip', '')]

      const templates = allSourceFiles.filter(template => {
        return !skipped.includes(template.replace(`${outputDir}/`, ''))
      })

      if (templates.length === 0) {
        console.warn(`Error: no files with the .${extensions} extension found in ${templateConfig.source}`)
        return
      }

      if (config.events && typeof config.events.beforeCreate === 'function') {
        await config.events.beforeCreate(config)
      }

      for await (const file of templates) {
        config.build.current = {
          path: path.parse(file)
        }

        const html = await fs.readFile(file, 'utf8')

        try {
          const rendered = await render(html, {
            useFileConfig: true,
            maizzle: {
              ...config,
              env
            },
            tailwind: {
              compiled: css
            },
            ...config.events
          })

          const destination = get(rendered, 'config.permalink', file)

          /**
           * Generate plaintext
           *
           * We do this first so that we can remove the <plaintext>
           * tags from the markup before outputting the file.
           */

          // Check if plaintext: true globally, fallback to template's front matter
          const plaintextConfig = get(templateConfig, 'plaintext', get(rendered.config, 'plaintext', false))
          const plaintextPath = get(plaintextConfig, 'destination.path', destination)

          if (Boolean(plaintextConfig) || !isEmpty(plaintextConfig)) {
            await Plaintext
              .generate(
                rendered.html,
                plaintextPath,
                merge(plaintextConfig, {filepath: file})
              )
              .then(async ({html, plaintext, destination}) => {
                rendered.html = html
                await fs.outputFile(destination, plaintext)
              })
          }

          /**
           * Output file
           */
          const parts = path.parse(destination)

          // Keep track of handled files
          compiled[parts.name] = rendered.html
          files.push(file)
          parsed.push(file)
        } catch (error) {
          switch (config.build.fail) {
            case 'silent':
              break
            case 'verbose':
              console.error(error)
              break
            default:
              throw error
          }
        }
      }

      const assets = {source: '', destination: 'assets', ...get(templateConfig, 'assets')}

      if (Array.isArray(assets.source)) {
        for await (const source of assets.source) {
          if (fs.existsSync(source)) {
            await fs
              .copy(source, path.join(templateConfig.destination.path, assets.destination))
              .catch(error => console.warn(error.message))
          }
        }
      } else {
        if (fs.existsSync(assets.source)) {
          await fs
            .copy(assets.source, path.join(templateConfig.destination.path, assets.destination))
            .catch(error => console.warn(error.message))
        }
      }

      await glob(path.join(templateConfig.destination.path, '/**/*.*'))
        .then(contents => {
          files = [...new Set([...files, ...contents])]
        })
    }
  }

  if (config.events && typeof config.events.afterBuild === 'function') {
    await config.events.afterBuild(files, config)
  }

  return {
    compiled,
    files,
    parsed,
    css
  }
}

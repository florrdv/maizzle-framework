const ora = require('ora')
const {get} = require('lodash')
const Output = require('../generators/output')
const {clearConsole} = require('../utils/helpers')

const build = async (env = 'local', config = {}) => {
  const start = new Date()
  const spinner = ora('Building emails...').start()

  try {
    console.log(Output)
    const { parsed, compiled } = await Output.compile(env, spinner, config)
    const elapsedSeconds = (Date.now() - start) / 1000

    if (get(config, 'build.command') === 'serve') {
      if (get(config, 'build.console.clear')) {
        clearConsole()
      }

      spinner.succeed(`Re-built ${parsed.length} templates in ${elapsedSeconds}s`)
    } else {
      spinner.succeed(`Built ${parsed.length} templates in ${elapsedSeconds}s`)
    }

    return { compiled }
  } catch (error) {
    spinner.fail(error.message)
    throw error
  }
}

module.exports = build

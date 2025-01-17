const {mergeWith} = require('lodash')

module.exports = {
  requireUncached: module => {
    try {
      delete require.cache[require.resolve(module)]
      return require(module)
    } catch {
      throw new Error(`could not load ${module}`)
    }
  },
  // https://github.com/lukeed/console-clear
  clearConsole: () => process.stdout.write('\x1B[H\x1B[2J'),
  toStyleString: (object = {}) => Object.entries(object).map(([k, v]) => `${k}: ${v}`).join('; '),
  merge: (...objects) => {
    if (objects.length < 2) {
      return objects[0]
    }

    let merged = {}

    for (const object of objects) {
      merged = mergeWith(merged, object, (existingValue, newValue) => {
        if (Array.isArray(existingValue) && Array.isArray(newValue)) {
          return [...existingValue, ...newValue]
        }

        return undefined
      })
    }

    return merged
  }
}

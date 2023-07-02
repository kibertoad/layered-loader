const systemInformation = require('systeminformation')

async function getSpecs() {
  const cpuInfo = await systemInformation.cpu()

  return {
    cpu: {
      brand: cpuInfo.brand,
      speed: `${cpuInfo.speed} GHz`,
    },
  }
}

module.exports = {
  getSpecs,
}

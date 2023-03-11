import systemInformation from 'systeminformation'

export async function getSpecs() {
  const cpuInfo = await systemInformation.cpu()

  return {
    cpu: {
      brand: cpuInfo.brand,
      speed: `${cpuInfo.speed} GHz`,
    },
  }
}

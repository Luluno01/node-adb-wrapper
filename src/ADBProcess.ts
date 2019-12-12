import * as assert from 'assert'
import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
const execFile = promisify(_execFile)


export const binaryName = 'adb'

export namespace RegExps {
  export const versionInfo = /^Android Debug Bridge version (?<adbVersion>[\d\w\-\.]+)\r?\nVersion (?<version>[\d\w\-\.]+)\r?\nInstalled as (?<installedAs>[\s\S]*?)\r?\n$/
  export const devices = /^List of devices attached\r?\n(?<deviceList>[\s\S]*)/
}

export class ADBProcess {

  /**
   * Execute raw ADB command
   * @param args Command line arguments
   */
  public async execRaw(args: string[]) {
    return await execFile(binaryName, args)
  }

  /**
   * Execute raw ADB command using device with given serial
   * @param args Command line arguments
   * @param serial Device serial number
   */
  public async execRawWithSerial(args: string[], serial: string) {
    return await execFile(binaryName, [ '-s', serial, ...args ])
  }

  /**
   * Execute raw ADB command using device with given serial (if given)
   * @param args Command line arguments
   * @param serial Device serial number, optional
   */
  public async execRawAuto(args: string[], serial?: string) {
    if(serial) {
      return await this.execRawWithSerial(args, serial)
    } else {
      return await this.execRaw(args)
    }
  }

  /**
   * Get ADB version(s)
   */
  public async getVersion() {
    const { stdout } = await this.execRaw([ '--version' ])
    const match = stdout.match(RegExps.versionInfo)
    assert(match, 'Cannot get ADB version, please check your ADB installation')
    return match.groups as {
      adbVersion: string
      version: string
      installedAs: string
    }
  }

  /**
   * Get device list
   */
  public async getDevices() {
    const { stdout } = await this.execRaw([ 'devices' ])
    const match = stdout.match(RegExps.devices)
    assert(match, 'Cannot get devices, please check your ADB installation')
    const deviceList = match.groups.deviceList.trim()
    return deviceList ? deviceList.split(/[\r\n]+/).map(line => {
      const [ serial, type ] = line.split(/\s+/)
      return { serial, type }
    }) : []
  }

  /**
   * Run remote shell command
   * @param serial Device serial number, optional
   */
  public async shell(command: string, serial?: string) {
    assert(!command.match(/^\s*$/), 'Shell command must not be empty')
    return (await this.execRawAuto([ 'shell', command ], serial)).stdout
  }

  /**
   * Restart adbd with root permissions
   * 
   * Note that this method does not guarantee the operation is successfully
   * event if it does not reject
   * @param serial Device serial number, optional
   */
  public async root(serial?: string) {
    return (await this.execRawAuto([ 'root' ], serial)).stdout
  }

  /**
   * Execute shell command `whoami` and return the result
   * @param serial Device serial number, optional
   */
  public async whoami(serial?: string) {
    return (await this.shell('whoami', serial)).trim()
  }
}

export default ADBProcess

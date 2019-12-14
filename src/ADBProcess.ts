import * as assert from 'assert'
import { execFile as _execFile } from 'child_process'
import { promisify } from 'util'
import LogcatParser, { LogcatProcess } from './Logcat'
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
      const [ serial, state ] = line.split(/\s+/)
      return { serial, state }
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
   * Push a single package to the device and install it
   * @param packagePath Path to the APK file to be installed
   * @param extraOpts Extra installation options
   * @param serial Device serial number, optional
   */
  public async install(packagePath: string, extraOpts?: string[], serial?: string) {
    let args = [ 'install' ]
    if(extraOpts) args = args.concat(extraOpts)
    args.push(packagePath)
    return (await this.execRawAuto(args, serial)).stdout
  }

  /**
   * Push multiple APKs to the device for a single package and install them
   * @param packagePaths Paths to APK files to be installed
   * @param extraOpts Extra installation options
   * @param serial Device serial number, optional
   */
  public async installMultiple(packagePaths: string[], extraOpts?: string[], serial?: string) {
    let args = [ 'install-multiple' ]
    if(extraOpts) args = args.concat(extraOpts)
    args = args.concat(packagePaths)
    return (await this.execRawAuto(args, serial)).stdout
  }

  /**
   * Push one or more packages to the device and install them atomically
   * @param packagePaths Paths to APK files to be installed
   * @param extraOpts Extra installation options
   * @param serial Device serial number, optional
   */
  public async installMultiPackage(packagePaths: string[], extraOpts?: string[], serial?: string) {
    let args = [ 'install-multi-package' ]
    if(extraOpts) args = args.concat(extraOpts)
    args = args.concat(packagePaths)
    return (await this.execRawAuto(args, serial)).stdout
  }

  /**
   * Remove this app package from the device
   * @param pkg Package to be uninstalled
   * @param keepDataAndCache Keep the data and cache directories
   * @param serial Device serial number, optional
   */
  public async uninstall(pkg: string, keepDataAndCache?: boolean, serial?: string) {
    const args = [ 'uninstall ']
    if(keepDataAndCache) args.push('-k')
    args.push(pkg)
    return (await this.execRawAuto(args, serial)).stdout
  }

  /**
   * Remount partitions read-write
   * 
   * If a reboot is required and `reboot` is `true`, the device will
   * automatically reboot
   * 
   * Note that even if `reboot` is `false`, the device could still reboot
   * @param reboot Reboot the device if required
   * @param serial Device serial number, optional
   */
  public async remount(reboot?: boolean, serial?: string) {
    const args = [ 'reboot' ]
    if(reboot) args.push('-R')
    return (await this.execRawAuto(args, serial)).stdout
  }

  /**
   * Reboot the device; defaults to booting system image but supports
   * bootloader and recovery too
   * 
   * Mode `sideload` reboots into recovery and automatically starts sideload
   * mode; `sideload-auto-reboot` is the same but reboots after sideloading
   * @param mode Target system to reboot
   * @param serial Device serial number, optional
   */
  public async reboot(mode?: 'bootloader' | 'recovery' | 'sideload' | 'sideload-auto-reboot', serial?: string) {
    const args = [ 'reboot' ]
    if(mode) args.push(mode)
    return (await this.execRawAuto(args, serial)).stdout
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
   * Restart adbd without root permissions
   * @param serial Device serial number, optional
   */
  public async unroot(serial?: string) {
    return (await this.execRawAuto([ 'unroot' ], serial)).stdout
  }

  /**
   * Execute shell command `whoami` and return the result
   * @param serial Device serial number, optional
   */
  public async whoami(serial?: string) {
    return (await this.shell('whoami', serial)).trim()
  }

  /**
   * Reset connection
   * 
   * @param target Reconnect target
   * 
   * If `target` is undefined:
   * 
   * > kick connection from host side to force reconnect
   * 
   * If `target` is `device`:
   * 
   * > kick connection from device side to force reconnect
   * 
   * If `target` is `offline`:
   * 
   * > reset offline/unauthorized devices to force reconnect
   * 
   * @param serial Device serial number, optional
   */
  public async reconnect(target?: 'device' | 'offline', serial?: string) {
    const args = [ 'reconnect' ]
    if(target) args.push(target)
    return await this.execRawAuto(args, serial)
  }
}

export default ADBProcess

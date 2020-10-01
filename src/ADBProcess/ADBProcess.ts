import BasicADBProcess from './BasicADBProcess'
import sleep from 'unlib.js/build/Time/sleep'


/**
 * @event reconnecting `waitForDevice` is calling `reconnect`
 * @event waiting-for-device `ensureDevice` is calling `waitForDevice`
 * @event kill-server `ensureDevice` is calling `killServer`
 * @event ensuring-device `ensureDevice` is doing its job
 * @event device-online `ensureDevice` detects the device is online
 */
export class ADBProcess extends BasicADBProcess {
  /**
   * Get current state of a device
   * @param serial Device serial number, optional
   */
  public async getDeviceState(serial?: string) {
    const devices = await this.getDevices()
    return serial ? devices.find(({ serial: _serial }) => serial == _serial)?.state : devices[0]?.state
  }

  /**
   * Wait for a device to be in "device" state
   * @param attempts Maximum number of attempts
   * @param transport USB, local, or any (defaults to any)
   * @param serial Device serial number, optional
   */
  public async waitForDevice(attempts: number = 3, transport?: 'usb' | 'local' | 'any', serial?: string) {
    let _attempts = attempts
    while (_attempts--) {
      try {
        await this.waitFor('device', transport, 60 * 1000, serial)
        return
      } catch (err) {
        let state = await this.getDeviceState(serial)
        if (state == 'device') return
        if (_attempts) {
          if (state == 'offline') {
            this.emit('reconnecting', 'offline', serial)
            await this.reconnect('offline', serial)
            await sleep(500)
            if (await this.getDeviceState(serial) == 'device') return
          } else {
            this.emit('reconnecting', undefined, serial)
            await this.reconnect(undefined, serial)
            await sleep(500)
          }
        }
      }
    }
    throw new Error(`Failed to wait for device after ${attempts} attempt(s)`)
  }

  /**
   * Do the `waitForDevice`-`killServer` loop until the device is online or the maximum number of attempts is reached
   * @param attempts Maximum number of attempts
   * @param waitAttempts Maximum number of attempts to be passed to `waitForDevice`
   * @param transport USB, local, or any (defaults to any)
   * @param serial Device serial number, optional
   */
  public async ensureDevice(attempts: number = 2, waitAttempts: number = 3, transport?: 'usb' | 'local' | 'any', serial?: string) {
    this.emit('ensuring-device', attempts, waitAttempts, transport, serial)
    let _attempts = attempts
    while (_attempts--) {
      try {
        this.emit('waiting-for-device', waitAttempts, transport, serial)
        await this.waitForDevice(waitAttempts, transport, serial)
        this.emit('device-online', _attempts, waitAttempts, transport, serial)
        return
      } catch (err) {
        if (_attempts) {
          this.emit('kill-server')
          await this.killServer()
          await sleep(500)
        }
      }
    }
    throw new Error(`Failed to ensure that device is online after ${attempts} attempt(s)`)
  }

  /**
   * Call `root` and make sure the device is online before returning
   * @param attempts Maximum number of attempts
   * @param ensureAttempts Maximum number of attempts to be passed to `ensureDevice`
   * @param waitAttempts Maximum number of attempts to be passed to `waitForDevice`
   * @param transport USB, local, or any (defaults to any)
   * @param serial Device serial number, optional
   */
  public async safeRoot(attempts: number = 3, ensureAttempts: number = 2, waitAttempts: number = 3, transport?: 'usb' | 'local' | 'any', serial?: string) {
    let _attempts = attempts
    while (_attempts) {
      try {
        await this.root(serial)
        await sleep(500)
        await this.ensureDevice(ensureAttempts, waitAttempts, transport, serial)
        return
      } catch (err) {
        if (_attempts) {
          await this.killServer()
          await this.ensureDevice(ensureAttempts, waitAttempts, transport, serial)
        }
      }
    }
    throw new Error(`Failed to restart adbd with root permissions after ${attempts} attempt(s)`)
  }
}

export default ADBProcess

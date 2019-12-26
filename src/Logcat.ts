import * as assert from 'assert'
import { execFile as _execFile, spawn } from 'child_process'
import { promisify } from 'util'
const execFile = promisify(_execFile)
import EventBarrier from 'unlib.js/build/Sync/EventBarrier'
import * as log4js from 'log4js'
const logger = log4js.getLogger('logcat')
import { EventEmitter } from 'events'
import { Readable, Transform } from 'stream'
import LineFeedTransform from './LineFeedTransform'


export const binaryName = 'adb'

/**
 * Logcat process wrapper
 */
export class LogcatProcess extends EventBarrier {
  protected options: string[]
  protected filterspecs: string[]
  public proc: ReturnType<typeof spawn> | null
  public err?: Error
  public get output() {
    return this.proc?.stdout
  }

  /**
   * Constructor of `Logcat`
   * 
   * @see `adb logcat --help`
   * @param options Logcat options
   * @param filterspecs Filters
   */
  constructor(options: string[] = [], filterspecs: string[] = []) {
    super()
    this.options = options
    this.filterspecs = filterspecs
  }

  /**
   * Spawn raw ADB process
   * @param args Command line arguments
   */
  public spawnRaw(args: string[]) {
    return spawn(binaryName, [ 'logcat', '-B',  ...args ])
  }

  /**
   * Spawn raw ADB process using device with given serial
   * @param args Command line arguments
   * @param serial Device serial number
   */
  public spawnRawWithSerial(args: string[], serial: string) {
    return spawn(binaryName, [ '-s', serial, 'logcat', '-B', ...args ])
  }

  /**
   * Spawn raw ADB process using device with given serial (if given)
   * @param args Command line arguments
   * @param serial Device serial number, optional
   */
  public spawnRawAuto(args: string[], serial?: string) {
    if(serial) {
      return this.spawnRawWithSerial(args, serial)
    } else {
      return this.spawnRaw(args)
    }
  }

  /**
   * Clear (flush) the entire log and exit
   */
  public async clear() {
    return (await execFile('adb', [ 'logcat', '-c' ])).stdout
  }

  /**
   * Start logcat
   */
  public start(serial?: string) {
    assert(!this.proc, 'Cannot start logcat on the same instance twice')
    const proc = this.proc = this.spawnRawAuto(this.options.concat(this.filterspecs), serial)
    delete this.err
    proc
      .on('error', err => {
        // Spawn error or kill error
        logger.warn('Logcat process has an error:', err)
        this.err = err
        this._destroy()
      })
      .once('exit', () => {
        this.notify('exit')
        this._destroy(true)
      })
  }

  protected _destroy(exited?: boolean) {
    const { proc, err } = this
    if(proc) {
      proc.stdin.end()
      if(!exited && !proc.killed) proc.kill()
      if(err) this.abort('exit', err)
      this.proc = null
    }
  }

  /**
   * Kill and destroy logcat process
   */
  public async destroy() {
    const { proc } = this
    if(proc) {
      proc.kill()
      try {
        await this.waitFor('exit')
      } catch(err) {}
    }
  }
}

/**
 * Log priority
 */
export enum Priority {
  ASSERT = 7,
  DEBUG = 3,
  ERROR = 6,
  INFO = 4,
  VERBOSE = 2,
  WARN = 5
}

/**
 * Priority name lookup table
 */
export const priorityNameMap = new Map([
  [ 7, 'assert' ],
  [ 3, 'debug' ],
  [ 6, 'error' ],
  [ 4, 'info' ],
  [ 2, 'verbose' ],
  [ 5, 'warn' ]
])

/**
 * Get the name of a priority
 * @param priority Log priority
 */
export function priorityToString(priority: Priority) {
  return priorityNameMap.get(priority)
}

/**
 * Log entry
 */
export interface LogEntry {
  /**
   * Generating process's pid
   */
  pid: number
  /**
   * Generating process's tid
   */
  tid: number
  /**
   * Seconds since Epoch
   */
  sec: number
  /**
   * Nanoseconds
   */
  nsec: number
  /**
   * Seconds + nanoseconds => Date object
   */
  time: Date
  /**
   * Undefined for v1, or effective UID of logger for v2, or log id of the payload for v3
   */
  id?: number
  /**
   * Log priority
   */
  priority: Priority
  /**
   * Log tag
   */
  tag: string
  /**
   * Log message
   */
  msg: string
}

export class InsufficientBytesError extends Error {
  public name = 'InsufficientBytesError'
}

class InputStreamEndedError extends Error {
  public name = 'InputStreamEndedError'
}

export class StreamDetachedError extends Error {
  public name = 'StreamDetachedError'
}

/**
 * Logcat parser
 */
export class LogcatParser extends EventEmitter {
  protected input?: Readable
  protected transform?: Transform
  private eventBarrier = new EventBarrier
  private bytesToRead = 0
  private cursor = 0
  private buffer!: Buffer
  private get bytesAvailable() {
    return this.buffer.length - this.cursor
  }
  private _onData = (data: Buffer) => this.onData(data)
  private _onEnd = () => this.onEnd()
  private end = false
  /**
   * Constructor of `LogcatParser`
   * @param input Input readable stream
   * @param fixLineFeeds Fix line feeds
   * 
   * > 0A(line feed) is being replaced by 0D0A(CR and LF) , when above command
   * > is issued in Linux shell. \
   * > 0A(line feed) is being replaced by 0D0D0A , when above command is
   * > issued in windows command prompt.
   * 
   * See [this question](https://stackoverflow.com/questions/6410488/how-to-avoid-carriage-return-line-feed-pair)
   */
  constructor(input: Readable, fixLineFeeds: boolean = true) {
    super()
    this.attachStream(input, fixLineFeeds)
  }

  /**
   * Attach new input readable stream (current stream will be replaced)
   * @param input Input readable stream
   * @param fixLineFeeds Fix line feeds
   */
  public attachStream(input: Readable, fixLineFeeds: boolean = true) {
    this.clearBuffer()
    this.end = false
    this.detach()
    this.input = input
    if(fixLineFeeds) {
      const transform = this.transform = new LineFeedTransform
      input.pipe(transform)
        .on('data', this._onData)
        .on('end', this._onEnd)
    } else {
      input
        .on('data', this._onData)
        .on('end', this._onEnd)
    }
  }

  /**
   * Detach current input stream
   */
  public detach() {
    this.eventBarrier.abort('readable', new StreamDetachedError)
    if(this.transform) {
      this.input!.unpipe(
        this.transform
          .off('data', this._onData)
          .off('end', this._onEnd)
      )
    } else {
      this.input
        ?.off('data', this._onData)
        .off('end', this._onEnd)
    }
  }

  /**
   * Clear internal buffer
   */
  private clearBuffer() {
    this.bytesToRead = 0
    this.cursor = 0
    this.buffer = Buffer.from('')
  }

  /**
   * Roll internal buffer
   */
  private rollBuffer() {
    this.buffer = this.buffer.slice(this.cursor)
    this.cursor = 0
  }

  /**
   * On input data handler
   * @param data Incoming data chunk
   */
  private onData(data: Buffer) {
    this.buffer = Buffer.concat([ this.buffer, data ])
    const { bytesToRead } = this
    if(this.bytesAvailable >= bytesToRead) {
      this.bytesToRead = 0
      this.eventBarrier.notify('readable', bytesToRead)
    }
  }

  /**
   * On input stream ends handler
   */
  private onEnd() {
    this.end = true
    this.eventBarrier.abort('readable', new InputStreamEndedError)
  }

  /**
   * The actual `read` method
   * @param size Size of data to read
   */
  protected _read(size: number) {
    const end = this.cursor + size
    const data = this.buffer.slice(this.cursor, end)
    this.cursor = end
    return data
  }

  /**
   * Read data asynchronously
   * @param size Size of data to read in bytes
   */
  protected async read(size: number) {
    if(this.bytesAvailable < size) {
      if(this.end) throw new InsufficientBytesError
      this.bytesToRead = size
      try {
        await this.eventBarrier.waitFor('readable')
      } catch(err) {
        if(err instanceof InputStreamEndedError) {
          throw new InsufficientBytesError
        }
        throw err
      }
    }
    return this._read(size)
  }

  protected async readUInt16() {
    return (await this.read(2)).readUInt16LE(0)
  }

  protected async readInt16() {
    return (await this.read(2)).readInt16LE(0)
  }

  protected async readUInt32() {
    return (await this.read(4)).readUInt32LE(0)
  }

  protected async readInt32() {
    return (await this.read(4)).readInt32LE(0)
  }

  /**
   * Iterate through log entries
   * 
   * Example usage:
   * 
   * ```ts
   * const parser = new LogcatParser(someInputStream)
   * for await(const entry of parser.asIterator()) console.log(entry)
   * ```
   * 
   * Or
   * 
   * ```ts
   * const parser = new LogcatParser(someInputStream)
   * parser.on('entry', entry => console.log(entry))
   * for await(const _ of parser.asIterator()) {}
   * ```
   * @param noError Suppress error
   * @param tryRecover Try to recover when encounter invalid header size
   */
  public async *asIterator(noError: boolean = false, tryRecover: boolean = false) {
    // TODO: test unexpected disconnection
    try {
      // Break when input ends AND no bytes available for reading
      // Error cases: stream replaced, invalid header size, or corrupted log entry
      while(!this.end || this.bytesAvailable) {
        /**
         * Length of the payload
         */
        let len: number
        try {
          len = await this.readUInt16()
        } catch(err) {
          if(err instanceof InsufficientBytesError && this.bytesAvailable == 0) break
          throw err
        }
        /**
         * Padding for v1, or header size for v2 and v3
         */
        const headerSize = await this.readUInt16()
        if(headerSize != 24 && headerSize != 0) {
          if(tryRecover) {
            this.clearBuffer()
            break
          }
          throw new Error(`Invalid header size ${headerSize}`)
        }
        /**
         * Generating process's pid
         */
        const pid = await this.readInt32()
        /**
         * Generating process's pid
         */
        const tid = await this.readInt32()
        /**
         * Seconds since Epoch
         */
        const sec = await this.readInt32()
        /**
         * Nanoseconds
         */
        const nsec = await this.readInt32()
        /**
         * Seconds + nanoseconds => Date object
         */
        const time = new Date(sec * 1000 + nsec / 1000000)
        /**
         * Void for v1, or effective UID of logger for v2, or log id of the payload for v3
         */
        let id: number | undefined
        if(headerSize == 24) {
          // v2 or v3
          id = await this.readUInt32()
        }
        let payload = await this.read(len)
        let priorityIndex = 0
        let priority: Priority = payload[priorityIndex++]
        // Sometimes there will be some `0`s before `priority` (byte alignment? bug?)
        while(priority == 0) {
          priority = payload[priorityIndex++]
          if(priorityIndex >= len) {
            // `payload` is full of paddings
            payload = Buffer.concat([ payload, await this.read(len) ])
          }
        }
        if(priorityIndex > 1) {
          // There are some padding zeros
          payload = Buffer.concat([ payload, await this.read(priorityIndex - 1) ])
        }
        this.rollBuffer()
        let separatorIndex: number = payload.indexOf(0, priorityIndex)
        if(separatorIndex < 0) {
          separatorIndex = payload.length
        }
        const tag = payload.slice(priorityIndex, separatorIndex).toString()
        const msg = payload.slice(separatorIndex + 1, payload[payload.length - 1] == 0 ? payload.length - 1 : payload.length).toString()
        const logEntry: LogEntry = {
          pid,
          tid,
          sec,
          nsec,
          time,
          priority,
          tag,
          msg
        }
        if(id) logEntry.id = id
        this.emit('entry', logEntry)
        yield logEntry
      }
    } catch(err) {
      if(!noError) throw err
    }
    this.clearBuffer()
  }
}

export default LogcatParser

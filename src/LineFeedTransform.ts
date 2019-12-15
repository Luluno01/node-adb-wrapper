import { Transform, TransformCallback } from 'stream'
import { range } from 'unlib.js/build/Generators'
import * as os from 'os'


/**
 * Original line feed
 */
export const originalLineFeed = Buffer.from([ 0x0D ])
/**
 * Replaced line feed sequence
 */
export const replacedLineFeed = os.platform() == 'win32' ? Buffer.from([ 0x0D, 0x0D, 0x0A ]) : Buffer.from([ 0x0D, 0x0A ])
/**
 * Regular expression of replaced line feed sequence
 */
export const replacedLineFeedRegExp = os.platform() == 'win32' ? /\r\r\n/g : /\r\n/g

function indexOfSubpattern(target: Buffer, pattern: Buffer) {
  let index = target.length - pattern.length + 1  // Start searching here
  if(index < 0) index = 0
  while(index < target.length) {
    let matched = true
    for(const j of range(index, target.length)) {
      if(target[j] != pattern[j - index]) {
        matched = false
        break
      }
    }
    if(matched) return index
    else index++
  }
  return -1
}

/**
 * ADB shell line feed fixer
 * 
 * > 0A(line feed) is being replaced by 0D0A(CR and LF) , when above command
 * > is issued in Linux shell. \
 * > 0A(line feed) is being replaced by 0D0D0A , when above command is
 * > issued in windows command prompt.
 * 
 * See [this question](https://stackoverflow.com/questions/6410488/how-to-avoid-carriage-return-line-feed-pair)
 */
export class LineFeedTransform extends Transform {
  private lastSuspiciousBytes: Buffer | null = null

  public _flush(callback: TransformCallback) {
    // If there is a trailing part of replaced line feed pattern, flush it
    if(this.lastSuspiciousBytes) {
      this.push(this.lastSuspiciousBytes)
      this.lastSuspiciousBytes = null
    }
    callback()
  }

  public _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    if(this.lastSuspiciousBytes) {
      chunk = Buffer.concat([ this.lastSuspiciousBytes, chunk ])
      this.lastSuspiciousBytes = null
    }
    let lastSegmentStart = 0
    let replacedLineFeedIndex = 0
    while((replacedLineFeedIndex = chunk.indexOf(replacedLineFeed, lastSegmentStart)) != -1) {
      // Find a full pattern
      this.push(chunk.slice(lastSegmentStart, replacedLineFeedIndex))
      this.push(originalLineFeed)
      lastSegmentStart = replacedLineFeedIndex + replacedLineFeed.length
    }
    if(lastSegmentStart < chunk.length) {
      // Check the last segment of chunk
      const lastSuspiciousBytesIndex = indexOfSubpattern(chunk, replacedLineFeed)
      if(lastSuspiciousBytesIndex != -1) {
        this.push(chunk.slice(lastSegmentStart, lastSuspiciousBytesIndex))
        this.lastSuspiciousBytes = chunk.slice(lastSuspiciousBytesIndex)
      } else {
        this.push(chunk.slice(lastSegmentStart))
      }
    }
    callback()
  }
}

export default LineFeedTransform
